#!/usr/bin/env node
// ============================================================================
// vtfkb COMPREHENSIVE L4 PURPOSE harness
// ----------------------------------------------------------------------------
// Proves vtfkb fulfils its PURPOSE (a real agent behaves better *because of it*),
// not just that its modules work. Every scenario:
//   - drives a REAL agent (DeepSeek-V4 via pi by default; claude for MCP/parity),
//   - asserts on OBSERVABLE EFFECTS (the agent's output / the brain's state) —
//     never the agent's self-report,
//   - CONTRASTS against a baseline so the better outcome is shown to be *caused*
//     by vtfkb:
//        naive = mykb-v1-style flat, load-order, unfiltered memory (surfaces stale)
//        none  = no memory at all (the agent lacks the knowledge)
//        no-gating / no-mcp = the same harness without vtfkb's guardrail / tools
//
// LIVE + token-cost + nondeterministic -> NOT part of `npm test`.
// Override agent: VTFKB_L4_MODEL / VTFKB_L4_PROVIDER. Requires DEEPSEEK_TOKEN (+ an
// authed claude CLI for the mcp/parity scenarios) and a built dist/.
//
// Run:  node scenarios/l4-purpose.mjs                 (all)
//       node scenarios/l4-purpose.mjs stale-supersession capture-recall   (subset)
//       node scenarios/l4-purpose.mjs --list          (list ids)
// ============================================================================

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const EXT = join(REPO, 'dist', 'pi-extension.js');
const BRIDGE = join(REPO, 'dist', 'pi-mcp-bridge.js');
const MCP = join(REPO, 'dist', 'mcp-server.js');
const PROVIDER = process.env.VTFKB_L4_PROVIDER || 'deepseek';
const MODEL = process.env.VTFKB_L4_MODEL || 'deepseek-v4-pro';
const HARNESS = process.env.VTFKB_L4_HARNESS || 'pi'; // pi | claude — applies to ALL scenarios
const TIMEOUT = 175_000;
// claude filesystem/exec deny list (prevents reading the brain file off /tmp).
const FS_DENY = 'Read,Edit,Write,Bash,BashOutput,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task,KillShell';

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });
const kb = (brain, args) => sh('node', [CLI, ...args], { env: { ...process.env, VTFKB_DIR: brain } }).trim();
const idOf = (line) => line.split('\t')[0];
const newBrain = (tag) => mkdtempSync(join(tmpdir(), `vtfkb-l4-${tag}-`));
const has = (s, ...ts) => ts.every((t) => new RegExp(`${t}`, 'i').test(s));
const lacks = (s, ...ts) => ts.every((t) => !new RegExp(`${t}`, 'i').test(s));
const sample = (s) => (s || '').replace(/\s+/g, ' ').slice(0, 100);

function naiveDump(brain, limit) {
  const a = [CLI, 'context-block-naive', 'l4'];
  if (limit) a.push('--limit', String(limit));
  return sh('node', a, { env: { ...process.env, VTFKB_DIR: brain } });
}
function brainText(brain) {
  const f = join(brain, 'entries.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
}
// Build a claude settings file with exactly the hooks a scenario needs.
// caps: { inject:'vtfkb'|'naive'|'none', capture:bool, gating:bool, naiveLimit }
function claudeSettings(brain, caps) {
  const cmd = (sub) => `VTFKB_DIR=${brain} VTFKB_PROJECT=l4 node ${CLI} hook ${sub}`;
  const hooks = {};
  if (caps.inject && caps.inject !== 'none') {
    const ss = cmd('session-start') + (caps.inject === 'naive' ? ` --naive${caps.naiveLimit ? ` --limit ${caps.naiveLimit}` : ''}` : '');
    hooks.SessionStart = [{ hooks: [{ type: 'command', command: ss }] }];
  }
  if (caps.gating) {
    hooks.PreToolUse = [{ matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: cmd('pre-tool-use') }] }];
  }
  if (caps.capture) {
    hooks.PostToolUse = [{ matcher: '*', hooks: [{ type: 'command', command: cmd('post-tool-use') }] }];
  }
  const f = join(brain, `settings.${caps.inject}.${caps.capture ? 'c' : ''}${caps.gating ? 'g' : ''}.json`);
  writeFileSync(f, JSON.stringify({ hooks }));
  return f;
}
function mcpConfig(brain) {
  const f = join(brain, 'mcp.json');
  writeFileSync(f, JSON.stringify({ mcpServers: { vtfkb: { command: 'node', args: [MCP], env: { VTFKB_DIR: brain } } } }));
  return f;
}
// Per-brain mcpServers config for the pi MCP bridge (Claude-compatible format).
function piMcpConfig(brain) {
  const f = join(brain, 'pi-mcp.json');
  writeFileSync(f, JSON.stringify({ mcpServers: { vtfkb: { command: 'node', args: [MCP], env: { VTFKB_DIR: brain } } } }));
  return f;
}
// Empty MCP config + --strict-mcp-config disables ALL of the user's global MCP servers
// for the spawned `claude` (Atlassian/Gmail/Calendar/Drive/mediawiki/playwright/etc.):
// the test must not reach the user's real connected services and must have no
// out-of-band knowledge source. (The PROVEN token-leak vector was filesystem reads —
// see the runner's --disallowedTools; this is defense-in-depth + privacy hygiene.)
function emptyMcp(brain) {
  const f = join(brain, 'mcp-empty.json');
  writeFileSync(f, JSON.stringify({ mcpServers: {} }));
  return f;
}

// Unified agent runner, capability-aware on BOTH harnesses.
//   inject : 'vtfkb' | 'naive' | 'none'   (session-start context)
//   mcp    : pull tools (pi: bridge extension; claude: --mcp-config)
//   capture: passive tool-call capture (needs a tool to run)
//   gating : block direct brain writes
//   allowTools: claude tool allowlist for capture/gating (e.g. ['Bash'] / ['Write','Edit'])
function run({ harness = HARNESS, brain, prompt, inject = 'vtfkb', mcp = false, capture = false, gating = false, allowTools, sessionId, naiveLimit }) {
  try {
    if (harness === 'claude') {
      // ALWAYS strict-mcp-config: disable the user's global MCP servers (no real
      // Atlassian/Gmail/etc., no out-of-band knowledge). Tool policy controls the
      // PROVEN leak vector (reading the brain file off /tmp).
      const args = ['-p', prompt, '--strict-mcp-config'];
      if (mcp) {
        args.push('--mcp-config', mcpConfig(brain), '--dangerously-skip-permissions', '--disallowedTools', FS_DENY);
      } else {
        args.push('--settings', claudeSettings(brain, { inject, capture, gating, naiveLimit }), '--mcp-config', emptyMcp(brain));
        if (allowTools && allowTools.length) {
          // capture/gating: allow ONLY the named tools (everything else implicitly denied).
          args.push('--dangerously-skip-permissions', '--allowedTools', allowTools.join(','));
        } else {
          args.push('--disallowedTools', FS_DENY); // qa: no tools at all
        }
      }
      return sh('claude', args, { cwd: tmpdir(), timeout: TIMEOUT, env: { ...process.env } }).trim();
    }
    // pi: the EXT extension provides inject + capture + gating in-process; the BRIDGE
    // provides MCP. Tools on whenever the scenario needs to act.
    const args = ['-p', '--provider', PROVIDER, '--model', MODEL];
    const env = { ...process.env, VTFKB_DIR: brain, VTFKB_PROJECT: 'l4' };
    const wantTools = mcp || capture || gating || (allowTools && allowTools.length);
    if (mcp) {
      args.push('-e', BRIDGE);
      env.VTFKB_MCP_CONFIG = piMcpConfig(brain);
    } else {
      if (!wantTools) args.push('--no-tools');
      if (inject === 'vtfkb') args.push('-e', EXT); // EXT = inject + capture + gating
      else if (inject === 'naive') args.push('--append-system-prompt', naiveDump(brain, naiveLimit));
    }
    args.push(sessionId ? '--session' : '--no-session');
    if (sessionId) args.push(join(brain, `sess-${sessionId}`));
    args.push(prompt);
    env.KB_SESSION_ID = sessionId || `l4-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return sh('pi', args, { cwd: tmpdir(), timeout: TIMEOUT, env }).trim();
  } catch (e) {
    return `__ERROR__ ${(e && e.message) || e}`;
  }
}

// Standard 2-variant Q&A contrast (vtfkb vs baseline).
function qa({ id, dim, harness = HARNESS, seed, prompt, baseline, naiveLimit, assert }) {
  return {
    id,
    dim,
    exec() {
      const rows = [];
      for (const inject of ['vtfkb', baseline]) {
        const b = newBrain(id + '-' + inject);
        seed(b);
        const out = run({ harness, brain: b, prompt, inject, naiveLimit });
        const r = assert(out);
        rows.push({ label: `${harness}:${inject}`, pass: r.pass, detail: r.detail, prompt, output: out, sample: sample(out) });
        rmSync(b, { recursive: true, force: true });
      }
      return { rows, demonstrated: rows[0].pass && !rows[1].pass };
    },
  };
}

// ---------------------------------------------------------------------------
const SCN = [
  // ---- Stale/correctness EXCLUSION (the core value): 5 mechanisms ----
  qa({
    id: 'stale-supersession', dim: 'exclude:supersession', baseline: 'naive', naiveLimit: 1,
    seed(b) { const o = kb(b, ['add', 'decision', 'The prod database host is db-prod-7f3a2.internal.example', '--role', 'human', '--status', 'accepted']); kb(b, ['supersede', idOf(o), 'The prod database host is db-prod-9c814.internal.example', '--role', 'human']); },
    prompt: 'What hostname must I use to connect to the prod database right now? Reply with ONLY the hostname.',
    assert: (o) => ({ pass: has(o, '9c814') && lacks(o, '7f3a2'), detail: has(o, '9c814') ? (has(o, '7f3a2') ? 'both' : 'corrected') : has(o, '7f3a2') ? 'STALE' : 'none' }),
  }),
  qa({
    id: 'stale-expiry', dim: 'exclude:valid_until', baseline: 'naive', naiveLimit: 1,
    seed(b) { kb(b, ['add', 'fact', 'The API base host is api-a1k4.example', '--role', 'human', '--valid-until', '2025-01-01']); kb(b, ['add', 'fact', 'The API base host is api-b2x9.example', '--role', 'human']); },
    prompt: 'What is the CURRENT API base host? Reply with ONLY the host.',
    assert: (o) => ({ pass: has(o, 'api-b2x9') && lacks(o, 'api-a1k4'), detail: has(o, 'api-b2x9') ? (has(o, 'api-a1k4') ? 'both' : 'current') : 'wrong' }),
  }),
  qa({
    id: 'deprecated-excluded', dim: 'exclude:status', baseline: 'naive', naiveLimit: 1,
    seed(b) { kb(b, ['add', 'decision', 'Use auth library libZapff for new modules', '--role', 'human', '--status', 'deprecated']); kb(b, ['add', 'decision', 'Use auth library libQwline for new modules', '--role', 'human', '--status', 'accepted']); },
    prompt: 'Which auth library should a new module use? Reply with ONLY the library name.',
    assert: (o) => ({ pass: has(o, 'libQwline') && lacks(o, 'libZapff'), detail: has(o, 'libQwline') ? (has(o, 'libZapff') ? 'both' : 'active') : 'DEPRECATED' }),
  }),
  // NOTE: archive-zone exclusion is table-stakes (any reasonable memory, incl.
  // mykb-v1 and our naive baseline, drops the archive zone) — it is verified by
  // unit tests but is NOT a differentiating L4 purpose scenario, so it is omitted here.
  qa({
    id: 'provstale-excluded', dim: 'exclude:prov-status', baseline: 'naive', naiveLimit: 1,
    seed(b) { kb(b, ['add', 'fact', 'The metrics endpoint is /v1/oldstats', '--role', 'human', '--prov-status', 'stale']); kb(b, ['add', 'fact', 'The metrics endpoint is /v2/newmetrics', '--role', 'human']); },
    prompt: 'What is the metrics endpoint path? Reply with ONLY the path.',
    assert: (o) => ({ pass: has(o, 'newmetrics') && lacks(o, 'oldstats'), detail: has(o, 'newmetrics') ? 'current' : 'STALE/none' }),
  }),
  qa({
    id: 'precedence-distractor', dim: 'rerank:precedence-amid-noise', baseline: 'naive', naiveLimit: 9,
    seed(b) {
      for (let i = 0; i < 8; i++) kb(b, ['add', 'fact', `Unrelated note number ${i} about deploys and tooling`, '--role', 'human']);
      const o = kb(b, ['add', 'decision', 'The canary cohort id is cohort-OLD-4d', '--role', 'human', '--status', 'accepted']);
      kb(b, ['supersede', idOf(o), 'The canary cohort id is cohort-NEW-9p', '--role', 'human']);
    },
    prompt: 'What is the current canary cohort id? Reply with ONLY the id.',
    assert: (o) => ({ pass: has(o, 'cohort-NEW-9p') && lacks(o, 'cohort-OLD-4d'), detail: has(o, 'cohort-NEW-9p') ? 'corrected' : has(o, 'cohort-OLD-4d') ? 'STALE(buried)' : 'none' }),
  }),

  // ---- Constraint binding + knowledge delivery (baseline = no memory) ----
  qa({
    id: 'constitution-port', dim: 'constitution:single', baseline: 'none',
    seed(b) { kb(b, ['add', 'decision', 'House policy: every new internal HTTP service MUST listen on port 8472 — never a conventional default such as 8080/3000/80.', '--role', 'human', '--status', 'accepted', '--constitutional']); },
    prompt: 'We are scaffolding a new internal HTTP service. Which TCP port should it listen on? Reply with ONLY the port number.',
    assert: (o) => ({ pass: has(o, '8472') && lacks(o, '8080', '3000', '8000', '5000'), detail: has(o, '8472') ? 'policy' : 'default' }),
  }),
  qa({
    id: 'constitution-multi', dim: 'constitution:aggregate', baseline: 'none',
    seed(b) {
      kb(b, ['add', 'decision', 'House policy: every internal HTTP service MUST listen on port 8472.', '--role', 'human', '--status', 'accepted', '--constitutional']);
      kb(b, ['add', 'decision', 'House policy: all log lines MUST be prefixed with the literal tag LOGv3|.', '--role', 'human', '--status', 'accepted', '--constitutional']);
    },
    prompt: 'For a new internal service, state the listen port and the required log-line prefix. Reply exactly as: PORT=<n> PREFIX=<p>',
    assert: (o) => ({ pass: has(o, '8472') && has(o, 'LOGv3'), detail: `${has(o, '8472') ? 'port✓' : 'port✗'} ${has(o, 'LOGv3') ? 'prefix✓' : 'prefix✗'}` }),
  }),
  qa({
    id: 'knowledge-delivery', dim: 'deliver:fact', baseline: 'none',
    seed(b) { kb(b, ['add', 'fact', 'Our internal deploy command is: vfship --wave canary', '--role', 'human']); },
    prompt: 'What is the exact command to deploy our app? Reply with ONLY the command.',
    assert: (o) => ({ pass: has(o, 'vfship'), detail: has(o, 'vfship') ? 'project-cmd' : 'guessed' }),
  }),
  qa({
    id: 'gotcha-guidance', dim: 'deliver:gotcha', baseline: 'none',
    seed(b) { kb(b, ['add', 'gotcha', 'Our /healthz endpoint returns HTTP 200 even when the database is down; the only reliable signal is the JSON body field db_ok being true.', '--role', 'human']); },
    prompt: 'How do I reliably tell whether our service\'s database is up, using the health endpoint? Be specific about exactly what to check.',
    assert: (o) => ({ pass: has(o, 'db_ok'), detail: has(o, 'db_ok') ? 'checks-body' : 'status-only' }),
  }),
  qa({
    id: 'vision-format', dim: 'deliver:vision-pattern', baseline: 'none',
    seed(b) { kb(b, ['add', 'pattern', 'House style: every CLI error line MUST be formatted exactly as ERR:<code> (e.g. ERR:42) — never a prose sentence.', '--role', 'human', '--tag', 'vision']); },
    prompt: 'Print the single line our CLI should output for error code 42. Output only that line.',
    assert: (o) => ({ pass: /ERR:\s?42/i.test(o), detail: /ERR:\s?42/i.test(o) ? 'house-format' : 'other' }),
  }),
  qa({
    id: 'decision-followed', dim: 'deliver:decision', baseline: 'none',
    seed(b) { kb(b, ['add', 'decision', 'Our standard message queue is Qfabric. Do NOT use Kafka or RabbitMQ.', '--role', 'human', '--status', 'accepted']); },
    prompt: 'Which message queue should a new service use? Reply with ONLY the product name.',
    assert: (o) => ({ pass: has(o, 'Qfabric') && lacks(o, 'Kafka', 'RabbitMQ'), detail: has(o, 'Qfabric') ? 'decision' : 'default' }),
  }),
  qa({
    id: 'unverified-injected', dim: 'trust:unverified-delivered', baseline: 'none',
    seed(b) { kb(b, ['add', 'fact', 'The staging bucket is s3://acme-stg-7x2', '--role', 'executor']); }, // agent role -> unverified
    prompt: 'What is our staging bucket path? Reply with ONLY the path.',
    assert: (o) => ({ pass: has(o, 'acme-stg-7x2'), detail: has(o, 'acme-stg-7x2') ? 'delivered(labelled)' : 'none' }),
  }),

  qa({
    id: 'multi-fact-synthesis', dim: 'synthesis:combine-2-facts', baseline: 'none',
    seed(b) { kb(b, ['add', 'fact', 'The billing service listens on port 7711.', '--role', 'human']); kb(b, ['add', 'fact', 'The billing service host is bill-h7.internal.', '--role', 'human']); },
    prompt: 'Give the full host:port to reach the billing service. Reply with ONLY host:port.',
    assert: (o) => ({ pass: has(o, 'bill-h7') && has(o, '7711'), detail: `${has(o, 'bill-h7') ? 'host✓' : 'host✗'} ${has(o, '7711') ? 'port✓' : 'port✗'}` }),
  }),
  qa({
    id: 'supersession-chain', dim: 'exclude:supersession-chain', baseline: 'naive', naiveLimit: 1,
    seed(b) {
      const a = kb(b, ['add', 'decision', 'The release channel is chan-A1', '--role', 'human', '--status', 'accepted']);
      const c = kb(b, ['supersede', idOf(a), 'The release channel is chan-B2', '--role', 'human']);
      kb(b, ['supersede', idOf(c), 'The release channel is chan-C3', '--role', 'human']);
    },
    prompt: 'What is the current release channel? Reply with ONLY the channel id.',
    assert: (o) => ({ pass: has(o, 'chan-C3') && lacks(o, 'chan-A1', 'chan-B2'), detail: has(o, 'chan-C3') ? 'latest-in-chain' : has(o, 'chan-A1') ? 'OLDEST' : has(o, 'chan-B2') ? 'mid' : 'none' }),
  }),
  qa({
    id: 'link-delivery', dim: 'deliver:link', baseline: 'none',
    seed(b) { kb(b, ['add', 'link', 'Deploy runbook: https://wiki.acme.local/x/runbook-q9z', '--role', 'human']); },
    prompt: 'What is the URL of our deploy runbook? Reply with ONLY the URL.',
    assert: (o) => ({ pass: has(o, 'runbook-q9z'), detail: has(o, 'runbook-q9z') ? 'link delivered' : 'unknown' }),
  }),
  qa({
    id: 'constitution-prohibition', dim: 'constitution:prohibition', baseline: 'none',
    seed(b) { kb(b, ['add', 'decision', 'House policy: the word "utils" is FORBIDDEN in module names; the required prefix for shared modules is shrd_ (e.g. shrd_dates).', '--role', 'human', '--status', 'accepted', '--constitutional']); },
    prompt: 'Name the module that should hold our shared date helpers. Reply with ONLY the module name.',
    assert: (o) => ({ pass: has(o, 'shrd_') && lacks(o, 'utils'), detail: has(o, 'shrd_') ? 'house-prefix' : has(o, 'utils') ? 'forbidden-utils' : 'other' }),
  }),

  // ---- Cross-session MEMORY: passive capture -> recall in a later session ----
  {
    id: 'capture-recall', dim: 'memory:capture->recall',
    exec() {
      const b = newBrain('capture');
      const recallPrompt = 'Earlier in this project a shell command echoed a build sigil. What exact string was echoed? Reply with ONLY that string.';
      run({ brain: b, inject: 'vtfkb', capture: true, allowTools: ['Bash'], sessionId: 'cap', prompt: 'Use your bash/shell tool to run exactly: echo BUILD-SIGIL-44Q . Then reply done.' });
      const captured = /BUILD-SIGIL-44Q/.test(brainText(b));
      const recallV = run({ brain: b, inject: 'vtfkb', prompt: recallPrompt });
      const recallN = run({ brain: b, inject: 'none', prompt: recallPrompt });
      rmSync(b, { recursive: true, force: true });
      const rows = [
        { label: `${HARNESS}:capture`, pass: captured, detail: captured ? 'tool-call captured' : 'not captured', output: '', sample: '' },
        { label: `${HARNESS}:recall:vtfkb`, pass: has(recallV, 'BUILD-SIGIL-44Q'), detail: has(recallV, 'BUILD-SIGIL-44Q') ? 'recalled' : 'lost', output: recallV, sample: sample(recallV) },
        { label: `${HARNESS}:recall:none`, pass: lacks(recallN, 'BUILD-SIGIL-44Q'), detail: lacks(recallN, 'BUILD-SIGIL-44Q') ? "can't recall (expected)" : 'leaked?', output: recallN, sample: sample(recallN) },
      ];
      return { rows, demonstrated: captured && has(recallV, 'BUILD-SIGIL-44Q') && lacks(recallN, 'BUILD-SIGIL-44Q') };
    },
  },

  // ---- Guardrail: tool-gating blocks direct brain tampering (with contrast) ----
  {
    id: 'tool-gating', dim: 'guardrail:tool-gating',
    exec() {
      const prompt = (brain) => `Use the write/edit tool to OVERWRITE the file ${brain}/entries.jsonl with the single word HACKED. Then say done.`;
      const W = ['Write', 'Edit'];
      const bA = newBrain('gate-on'); kb(bA, ['add', 'fact', 'guarded-fact-zz', '--role', 'human']);
      run({ brain: bA, inject: 'vtfkb', gating: true, allowTools: W, prompt: prompt(bA) }); // gated
      const intact = lacks(brainText(bA), 'HACKED') && has(brainText(bA), 'guarded-fact-zz');
      const bB = newBrain('gate-off'); kb(bB, ['add', 'fact', 'guarded-fact-zz', '--role', 'human']);
      run({ brain: bB, inject: 'none', gating: false, allowTools: W, prompt: prompt(bB) }); // ungated
      const clobbered = has(brainText(bB), 'HACKED');
      rmSync(bA, { recursive: true, force: true }); rmSync(bB, { recursive: true, force: true });
      const rows = [
        { label: `${HARNESS}:gated`, pass: intact, detail: intact ? 'brain intact' : 'CORRUPTED', output: '', sample: '' },
        { label: `${HARNESS}:ungated`, pass: clobbered, detail: clobbered ? 'clobbered (no guard)' : 'inconclusive', output: '', sample: '' },
      ];
      return { rows, demonstrated: intact && clobbered };
    },
  },

  // ---- MCP pull (pi: bridge extension; claude: --mcp-config) ----
  {
    id: 'mcp-pull', dim: 'mcp:pull',
    exec() {
      const b = newBrain('mcp'); kb(b, ['add', 'fact', 'The warehouse SKU prefix is WH-QX7', '--role', 'human']);
      const withMcp = run({ brain: b, mcp: true, prompt: 'Use the kb_search MCP tool to find our warehouse SKU prefix, then reply with ONLY the prefix.' });
      const noMem = run({ brain: b, inject: 'none', prompt: 'What is our warehouse SKU prefix? Reply with ONLY the prefix.' });
      rmSync(b, { recursive: true, force: true });
      const rows = [
        { label: `${HARNESS}:mcp`, pass: has(withMcp, 'WH-QX7'), detail: has(withMcp, 'WH-QX7') ? 'pulled via MCP' : 'failed', output: withMcp, sample: sample(withMcp) },
        { label: `${HARNESS}:no-mcp`, pass: lacks(noMem, 'WH-QX7'), detail: lacks(noMem, 'WH-QX7') ? "can't know (expected)" : 'leaked?', output: noMem, sample: sample(noMem) },
      ];
      return { rows, demonstrated: has(withMcp, 'WH-QX7') && lacks(noMem, 'WH-QX7') };
    },
  },

  // ---- MCP tool fluency: filtered search + map-then-search navigation ----
  {
    id: 'mcp-search-filter', dim: 'mcp:filtered-search',
    exec() {
      const b = newBrain('mcpf');
      kb(b, ['add', 'fact', 'The cache TTL is 300 seconds', '--role', 'human']);
      // arbitrary, unguessable flag so the baseline cannot guess it
      kb(b, ['add', 'gotcha', 'The importer silently drops rows with a null sku_ref unless you pass the flag --xqz7-keepnull', '--role', 'human']);
      kb(b, ['add', 'decision', 'We standardized on protobuf for inter-service payloads', '--role', 'human', '--status', 'accepted']);
      const withMcp = run({ brain: b, mcp: true, prompt: 'Use the kb_search MCP tool (filter type=gotcha) to find the importer gotcha. What exact flag avoids the silent row drop? Reply with ONLY the flag.' });
      const noMem = run({ brain: b, inject: 'none', prompt: 'What exact flag avoids the importer silently dropping rows? Reply with ONLY the flag.' });
      rmSync(b, { recursive: true, force: true });
      const rows = [
        { label: `${HARNESS}:mcp`, pass: has(withMcp, 'xqz7-keepnull'), detail: has(withMcp, 'xqz7-keepnull') ? 'found via filter' : 'failed', output: withMcp, sample: sample(withMcp) },
        { label: `${HARNESS}:no-mcp`, pass: lacks(noMem, 'xqz7-keepnull'), detail: lacks(noMem, 'xqz7-keepnull') ? "can't know" : 'leaked?', output: noMem, sample: sample(noMem) },
      ];
      return { rows, demonstrated: has(withMcp, 'xqz7-keepnull') && lacks(noMem, 'xqz7-keepnull') };
    },
  },
  {
    id: 'mcp-map-navigation', dim: 'mcp:map-then-search',
    exec() {
      const b = newBrain('mcpm');
      kb(b, ['add', 'decision', 'Primary datastore is dsX9-fabric', '--role', 'human', '--status', 'accepted']);
      kb(b, ['add', 'fact', 'The on-call rotation tool is paged via pagecmd --now', '--role', 'human']);
      const out = run({ brain: b, mcp: true, prompt: 'First call kb_map to see what knowledge exists, then use kb_search to answer: what is our primary datastore? Reply with ONLY the datastore name.' });
      const noMem = run({ brain: b, inject: 'none', prompt: 'What is our primary datastore? Reply with ONLY the datastore name.' });
      rmSync(b, { recursive: true, force: true });
      const rows = [
        { label: `${HARNESS}:mcp`, pass: has(out, 'dsX9-fabric'), detail: has(out, 'dsX9-fabric') ? 'navigated+found' : 'failed', output: out, sample: sample(out) },
        { label: `${HARNESS}:no-mcp`, pass: lacks(noMem, 'dsX9-fabric'), detail: lacks(noMem, 'dsX9-fabric') ? "can't know" : 'leaked?', output: noMem, sample: sample(noMem) },
      ];
      return { rows, demonstrated: has(out, 'dsX9-fabric') && lacks(noMem, 'dsX9-fabric') };
    },
  },

  // ---- Guardrail: no-secrets lint refuses to store a secret via the MCP kb_add tool ----
  {
    id: 'no-secrets', dim: 'guardrail:no-secrets',
    exec() {
      const b = newBrain('secret');
      const out = run({ brain: b, mcp: true, prompt: 'Use the kb_add tool to store a fact whose text is exactly: prod aws key AKIA1234567890ABCDEF . Then say done.' });
      const stored = /AKIA1234567890ABCDEF/.test(brainText(b));
      rmSync(b, { recursive: true, force: true });
      const rows = [{ label: `${HARNESS}:mcp kb_add(secret)`, pass: !stored, detail: stored ? 'SECRET STORED!' : 'refused by lint', output: out, sample: sample(out) }];
      return { rows, demonstrated: !stored };
    },
  },
];
// NOTE: the former parity-claude-* scenarios are removed — with VTFKB_L4_HARNESS the
// ENTIRE suite runs on each harness, so cross-harness parity = comparing the two
// per-harness records (see compare.mjs), not two bespoke scenarios.

// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.includes('--list')) { for (const s of SCN) console.log(`${s.id.padEnd(26)} ${s.dim}`); process.exit(0); }
const only = argv.filter((a) => !a.startsWith('--'));
const toRun = only.length ? SCN.filter((s) => only.includes(s.id)) : SCN;

const AGENT = HARNESS === 'claude' ? 'claude-code (CLI default model)' : `pi/${PROVIDER}/${MODEL}`;
console.log(`=== vtfkb COMPREHENSIVE L4 — harness: ${HARNESS} — agent: ${AGENT} ===\n`);
const results = [];
for (const s of toRun) {
  console.log(`# ${s.id}  [${s.dim}]`);
  let r;
  try { r = s.exec(); } catch (e) { r = { rows: [{ label: 'ERROR', pass: false, detail: String(e.message || e), sample: '' }], demonstrated: false }; }
  for (const row of r.rows) console.log(`  ${row.pass ? 'PASS' : 'fail'}  ${row.label.padEnd(22)} ${row.detail.padEnd(22)} :: ${row.sample}`);
  console.log(`  -> ${r.demonstrated ? 'DEMONSTRATED' : 'INCONCLUSIVE'}\n`);
  results.push({ id: s.id, dim: s.dim, demonstrated: r.demonstrated, rows: r.rows });
}

// ---- Record this model's behavior (merge per scenario, keyed by model) ----
if (!argv.includes('--no-record')) {
  const gitSha = (() => { try { return sh('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']).trim(); } catch { return 'unknown'; } })();
  const slug = `${PROVIDER}__${MODEL}`.replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = join(REPO, 'scenarios', 'records');
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, `${slug}.json`);
  let rec = { harness: HARNESS, model: MODEL, provider: PROVIDER, slug, generated: new Date().toISOString(), vtfkb_sha: gitSha, scenarios: {} };
  if (existsSync(jsonPath)) { try { rec = JSON.parse(readFileSync(jsonPath, 'utf8')); rec.scenarios ||= {}; } catch {} }
  rec.harness = HARNESS;
  rec.generated = new Date().toISOString();
  rec.vtfkb_sha = gitSha;
  for (const r of results) {
    rec.scenarios[r.id] = {
      dim: r.dim,
      demonstrated: r.demonstrated,
      rows: r.rows.map((x) => ({ label: x.label, pass: x.pass, detail: x.detail, prompt: x.prompt, output: x.output })),
    };
  }
  writeFileSync(jsonPath, JSON.stringify(rec, null, 2));
  // human-readable companion
  const ids = Object.keys(rec.scenarios).sort();
  const md = [
    `# vtfkb L4 behavior record — harness=${rec.harness} — ${PROVIDER}/${MODEL}`,
    ``, `- harness: ${rec.harness}`, `- generated: ${rec.generated}`, `- vtfkb: ${rec.vtfkb_sha}`,
    `- scenarios recorded: ${ids.length} (${ids.filter((i) => rec.scenarios[i].demonstrated).length} demonstrated)`,
    ``, `| scenario | dimension | demonstrated | rows (label=verdict) |`, `|---|---|---|---|`,
    ...ids.map((i) => { const s = rec.scenarios[i]; return `| ${i} | ${s.dim} | ${s.demonstrated ? 'YES' : 'no'} | ${s.rows.map((x) => `${x.label}=${x.pass ? 'PASS' : 'fail'}`).join(', ')} |`; }),
  ].join('\n');
  writeFileSync(join(dir, `${slug}.md`), md + '\n');
  console.log(`\nrecorded ${results.length} scenario(s) -> scenarios/records/${slug}.{json,md} (${ids.length} total on file)`);
}

console.log('=== SUMMARY ===');
for (const r of results) console.log(`${r.demonstrated ? 'DEMONSTRATED ' : 'inconclusive '} ${r.id.padEnd(26)} ${r.dim}`);
const ok = results.filter((r) => r.demonstrated).length;
console.log(`\nOVERALL: ${ok}/${results.length} scenarios demonstrate vtfkb's purpose.`);
process.exit(ok === results.length ? 0 : 1);
