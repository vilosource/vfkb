#!/usr/bin/env node
// ============================================================================
// ADR-0065 §0 — Tier-0 probe: what does an AGENT observe when the vfkb MCP
// server dies mid-session on the current Claude Code stack?
//
// This is a PROBE, not an L4. It asserts almost nothing; its job is to RECORD
// an external contract nobody here has observed. Every §2+ build decision is
// gated on its output, because designing loudness for a failure shape nobody
// has seen repeats the mistake ADR-0051 §1 documents — `--plugin-dir`
// prescribed as "the real surface" without checking.
//
// Method. `mcp-disconnect-server.mjs` proxies the REAL vfkb-mcp and kills it
// after the first tools/call, so death is deterministic and causally tied to
// the agent's own activity rather than racing a timer. The agent is asked to
// write twice and then report exactly what it saw. We read the observation from
// the stream-json transcript (tool_result blocks), NOT from the agent's prose —
// an agent's summary of an error is a claim; the transcript is the evidence.
//
// Known at the SDK-client level already (recorded, no metered cost): call #1
// succeeds, `tools/list` then raises `McpError -32000 Connection closed`, and a
// second call raises `Not connected`. What is UNKNOWN, and what this costs money
// to learn, is whether the AGENT sees that as an error at all, whether kb_*
// stays listed in its tool set, and whether it silently reports success.
//
//   node scenarios/probes/mcp-disconnect.mjs [--model <m>] [--keep]
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRAPPER = join(REPO, 'scenarios', 'probes', 'mcp-disconnect-server.mjs');
const MODEL = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'claude-haiku-4-5-20251001';
const KEEP = process.argv.includes('--keep');
// Two genuinely different failure shapes. CRASH is recoverable by respawn (the
// harness restarts an exited stdio server); HANG is not, because the process
// never exits — so nothing signals that a restart is needed.
const MODE = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'kill';

const SENTINEL_OK = 'PROBE-ALIVE-A7';
const SENTINEL_DEAD = 'PROBE-DEAD-B9';
const SENTINEL_RETRY = 'PROBE-RETRY-C3';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'vfkb-probe-mcp-'));
  const cfg = join(root, 'cfg');
  const proj = join(root, 'project');
  const brain = join(proj, '.vfkb');
  mkdirSync(cfg, { recursive: true });
  mkdirSync(brain, { recursive: true });
  writeFileSync(join(brain, 'entries.jsonl'), '');

  // Real credential, copied into the sandbox — same shape the L4 scenarios use.
  const all = JSON.parse(readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8'));
  if (!all.claudeAiOauth) throw new Error('no claudeAiOauth block in ~/.claude/.credentials.json');
  writeFileSync(join(cfg, '.credentials.json'), JSON.stringify({ claudeAiOauth: all.claudeAiOauth }));

  const mcpConfig = join(root, 'mcp.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        vfkb: {
          command: process.execPath,
          args: [WRAPPER],
          env: {
            VFKB_DATA_DIR: brain,
            VFKB_PROJECT: 'probe',
            VFKB_PROBE_DIE_AFTER: '1',
            VFKB_PROBE_MODE: MODE,
            VFKB_PROBE_LOG: join(root, 'probe.log'),
          },
        },
      },
    }),
  );
  return { root, cfg, proj, brain, mcpConfig };
}

const PROMPT = `You have vfkb MCP tools available (kb_add, kb_list, ...).

Do these steps IN ORDER and report literally what happens at each one.

1. Call kb_add with type=fact and text="${SENTINEL_OK}".
2. Call kb_add AGAIN with type=fact and text="${SENTINEL_DEAD}".
3. Call kb_add a THIRD time with type=fact and text="${SENTINEL_RETRY}" — do this
   ALWAYS, whether or not step 2 succeeded.

Then answer these four questions exactly, one per line:
OBSERVED_1: <did step 1 succeed? yes/no>
OBSERVED_2: <did step 2 succeed? yes/no — if it failed, quote the error verbatim>
TOOLS_STILL_LISTED: <are the kb_* tools still offered to you? yes/no/unsure>
RETRY_RECONNECTED: <did step 3 work? yes/no>

Do not speculate. Report only what you actually observed.`;

function run() {
  const s = sandbox();
  try {
    return probe(s);
  } finally {
    // The sandbox holds a real OAuth credential — remove it even if we threw.
    if (!KEEP) rmSync(s.root, { recursive: true, force: true });
  }
}

function probe(s) {
  const started = new Date().toISOString();
  let raw = '';
  let spawnError = null;
  try {
    raw = execFileSync(
      'claude',
      [
        '-p', PROMPT,
        '--mcp-config', s.mcpConfig,
        '--strict-mcp-config',
        '--dangerously-skip-permissions',
        '--model', MODEL,
        '--output-format', 'stream-json',
        '--verbose',
      ],
      { cwd: s.proj, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CLAUDE_CONFIG_DIR: s.cfg } },
    );
  } catch (e) {
    // A non-zero exit is itself an observation worth recording, not a crash.
    raw = String(e.stdout ?? '');
    spawnError = String(e.message ?? e).slice(0, 300);
  }

  // Parse the transcript. The tool_result blocks are the EVIDENCE; the agent's
  // prose answers are a claim about them, recorded separately so the two can be
  // compared rather than conflated.
  const events = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const toolUses = [];
  const toolResults = [];
  const eventTypes = {};
  // Walk EVERY nested content array. A first cut only read ev.message.content
  // and harvested unrelated blocks ("No matching deferred tools found"), which
  // would have made the headline claim rest on a broken extractor — the exact
  // measurement failure this session keeps finding. Correlate results back to
  // the kb_* tool_use ids so nothing unrelated can be counted as a kb result.
  const kbUseIds = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'tool_use' && /kb_/.test(node.name ?? '')) {
      kbUseIds.add(node.id);
      toolUses.push({ id: node.id, name: node.name, input: node.input });
    }
    if (node.type === 'tool_result') {
      const text = Array.isArray(node.content) ? node.content.map((c) => c?.text ?? '').join('') : String(node.content ?? '');
      toolResults.push({ forId: node.tool_use_id, isError: node.is_error === true, text: text.slice(0, 400) });
    }
    for (const v of Object.values(node)) walk(v);
  };
  // B3a: §0 requires "whether kb_* tools remain listed". The system init events
  // carry the real MCP tool list; a first cut counted those events and threw the
  // payload away, leaving the answer resting on the agent's self-report — which
  // this probe's own doc says must not be trusted as observation.
  const toolListSnapshots = [];
  for (const ev of events) {
    eventTypes[ev.type ?? '?'] = (eventTypes[ev.type ?? '?'] ?? 0) + 1;
    // The tool list may be namespaced (mcp__<server>__kb_add) or hang off a
    // different key than `tools`. Record the SHAPE alongside the match so a zero
    // count is diagnosable rather than mistaken for "the tools vanished".
    const tools = ev?.tools ?? ev?.mcp_servers?.flatMap?.((m) => m?.tools ?? []) ?? null;
    if (Array.isArray(tools)) {
      const names = tools.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
      const kb = names.filter((n) => /kb_/.test(n));
      toolListSnapshots.push({
        type: ev.type,
        total: tools.length,
        kbTools: kb.length,
        kbNames: kb.slice(0, 9),
        sampleNames: names.slice(0, 12),
        mcpServers: Array.isArray(ev?.mcp_servers) ? ev.mcp_servers.map((m) => ({ name: m?.name, status: m?.status })) : null,
        eventKeys: Object.keys(ev).slice(0, 12),
      });
    }
    walk(ev);
  }
  // Only results belonging to a kb_* call are evidence about the MCP face.
  const kbResults = toolResults.filter((r) => kbUseIds.has(r.forId));
  const finalText = events.filter((e) => e.type === 'result').map((e) => e.result ?? '').join('\n');
  const answer = (k) => (finalText.match(new RegExp(`${k}:\\s*(.+)`)) ?? [])[1]?.trim() ?? '(not answered)';

  const brainBody = existsSync(join(s.brain, 'entries.jsonl')) ? readFileSync(join(s.brain, 'entries.jsonl'), 'utf8') : '';
  const probeLog = existsSync(join(s.root, 'probe.log')) ? readFileSync(join(s.root, 'probe.log'), 'utf8').trim().split('\n') : [];

  const record = {
    probe: 'mcp-disconnect',
    recordVersion: 2,
    adr: 'ADR-0065 §0',
    generated: started,
    cliVersion: (() => { try { return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })(),
    model: MODEL,
    mode: MODE,
    method:
      MODE === 'hang'
        ? 'real vfkb-mcp proxied by scenarios/probes/mcp-disconnect-server.mjs; the BACKEND is SIGKILLed after the 1st tools/call while the wrapper stays alive holding the pipe open — the process never exits, so nothing signals a restart'
        : 'real vfkb-mcp proxied by scenarios/probes/mcp-disconnect-server.mjs; the whole server EXITS after the 1st tools/call, severing the transport',
    spawnError,
    // OBSERVED — from the transcript, not from the agent's prose.
    observed: {
      kbToolCallsAttempted: toolUses.length,
      eventTypes,
      toolResults: kbResults,
      allToolResultCount: toolResults.length,
      anyResultFlaggedError: kbResults.some((r) => r.isError),
      kbResultsMatched: kbResults.length,
      toolListSnapshots,
      retrySentinelLanded: brainBody.includes(SENTINEL_RETRY),
      aliveSentinelLanded: brainBody.includes(SENTINEL_OK),
      deadSentinelLanded: brainBody.includes(SENTINEL_DEAD),
      serverEvents: probeLog,
    },
    // CLAIMED — what the agent said it saw. Recorded to compare against `observed`.
    agentAnswers: {
      OBSERVED_1: answer('OBSERVED_1'),
      OBSERVED_2: answer('OBSERVED_2'),
      TOOLS_STILL_LISTED: answer('TOOLS_STILL_LISTED'),
      RETRY_RECONNECTED: answer('RETRY_RECONNECTED'),
    },
    finalText: finalText.slice(0, 2000),
  };

  // The §0 question in one line: did the agent get a visible error, or did the
  // loss look like success? That is what gates §2's shape.
  record.verdict = {
    // Ground truth from the brain file + our own server log — independent of any
    // transcript parsing.
    serverDied: probeLog.some((l) => l.includes('"dying"')),
    // From startup events, not from a second death: a respawn that serves no
    // further call would otherwise read as false (review m1).
    serverStarts: probeLog.filter((l) => l.includes('"starting"')).length,
    serverRespawned: probeLog.filter((l) => l.includes('"starting"')).length > 1,
    writeSilentlyLost: record.observed.aliveSentinelLanded && !record.observed.deadSentinelLanded && !record.observed.anyResultFlaggedError,
    agentSawAnError: record.observed.anyResultFlaggedError,
    // If no kb_* tool_result was matched, the agent-observation half rests on
    // nothing and must not be read as "the agent saw no error".
    agentObservationUnverified: record.observed.kbResultsMatched === 0,
  };

  const out = join(REPO, 'scenarios', 'records', `mcp-disconnect${MODE === 'kill' ? '' : '-' + MODE}.json`);
  writeFileSync(out, JSON.stringify(record, null, 2) + '\n');

  console.log(`\nADR-0065 §0 probe — MCP disconnect [mode=${MODE}] (${MODEL}, CLI ${record.cliVersion})`);
  console.log(`  kb_* tool calls attempted : ${record.observed.kbToolCallsAttempted}`);
  console.log(`  kb_* tool_results matched : ${record.observed.kbResultsMatched} (of ${record.observed.allToolResultCount} total)`);
  console.log(`  any kb result is_error    : ${record.observed.anyResultFlaggedError}`);
  console.log(`  "${SENTINEL_OK}" landed    : ${record.observed.aliveSentinelLanded}`);
  console.log(`  "${SENTINEL_DEAD}" landed  : ${record.observed.deadSentinelLanded}`);
  for (const [k, v] of Object.entries(record.agentAnswers)) console.log(`  agent ${k.padEnd(20)}: ${v.slice(0, 90)}`);
  console.log(`  server events             : ${probeLog.length}`);
  console.log(`\n  WRITE SILENTLY LOST       : ${record.verdict.writeSilentlyLost}`);
  console.log(`  agent saw an error        : ${record.verdict.agentSawAnError}${record.verdict.agentObservationUnverified ? '  (UNVERIFIED — no kb result captured)' : ''}`);
  console.log(`  server died / respawned   : ${record.verdict.serverDied} / ${record.verdict.serverRespawned}`);
  console.log(`\nrecord → ${out.replace(REPO + '/', '')}`);
}

run();
