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
// DEFAULT agent = claude harness + Claude Haiku 4.5 (VTFKB_L4_HARNESS=claude,
// VTFKB_L4_PROVIDER=claude-code, VTFKB_L4_MODEL=claude-haiku-4-5). Needs an authed
// claude CLI + a built dist/. Override the three VTFKB_L4_* envs for other points,
// e.g. pi/deepseek: VTFKB_L4_HARNESS=pi VTFKB_L4_PROVIDER=deepseek VTFKB_L4_MODEL=deepseek-v4-pro
// (that path needs DEEPSEEK_TOKEN). On the claude harness, MODEL='cli' = CLI default model.
//
// Run:  node scenarios/l4-purpose.mjs                 (all, default = haiku/claude)
//       node scenarios/l4-purpose.mjs stale-supersession capture-recall   (subset)
//       node scenarios/l4-purpose.mjs --list          (list ids)
// ============================================================================

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const EXT = join(REPO, 'dist', 'pi-extension.js');
const BRIDGE = join(REPO, 'dist', 'pi-mcp-bridge.js');
const MCP = join(REPO, 'dist', 'mcp-server.js');
// DEFAULT test model = Claude Haiku 4.5 on the claude harness (price/perf default,
// decision vtfkb-2026-06-03). Override via the three VTFKB_L4_* envs for other points.
const PROVIDER = process.env.VTFKB_L4_PROVIDER || 'claude-code';
const MODEL = process.env.VTFKB_L4_MODEL || 'claude-haiku-4-5';
const HARNESS = process.env.VTFKB_L4_HARNESS || 'claude'; // pi | claude — applies to ALL scenarios
const TIMEOUT = 175_000;
// Dockerized runs add container + in-container MCP-server boot overhead the host path
// doesn't have; the multi-step MCP scenarios (kb_map→kb_search) can exceed the host
// budget. Give `docker run` a larger wall-clock so a slow-but-correct run isn't scored
// as a timeout failure. Override with VTFKB_L4_DOCKER_TIMEOUT (ms).
const DOCKER_TIMEOUT = parseInt(process.env.VTFKB_L4_DOCKER_TIMEOUT || '300000', 10);
// N=3 multi-trial (ADR-0022): each scenario runs TRIALS times; `demonstrated` requires
// the contrast to hold on >=2/3 trials — separates genuine divergence from flakiness.
const TRIALS = Math.max(1, parseInt(process.env.VTFKB_L4_TRIALS || '3', 10));

// --- T5a dockerized pi substrate (ADR-0022) ---------------------------------
// The pi harness shells `docker run` against a pinned, self-contained image instead
// of the host `pi` (reproducible, sandboxed, no host creds/FS/MCP). Default for the
// pi harness; escape hatch VTFKB_L4_PI_MODE=host runs the legacy host pi (used to
// regenerate the known-good baseline records).
const PI_MODE = process.env.VTFKB_L4_PI_MODE || (HARNESS === 'pi' ? 'docker' : 'host');
const PI_IMAGE = process.env.VTFKB_L4_PI_IMAGE || 'vtfkb-l4-pi:dev';
// claude harness substrate (T5b): docker by default; VTFKB_L4_CLAUDE_MODE=host runs the
// legacy host claude (used to regenerate the known-good host baseline records).
const CLAUDE_MODE = process.env.VTFKB_L4_CLAUDE_MODE || 'docker';
const CLAUDE_IMAGE = process.env.VTFKB_L4_CLAUDE_IMAGE || 'vtfkb-l4-claude:dev';
const UID = typeof process.getuid === 'function' ? process.getuid() : 0;
const GID = typeof process.getgid === 'function' ? process.getgid() : 0;
// Fixed in-container paths (must match scenarios/docker/{pi,claude}.Dockerfile).
const C_HOME = '/work';
const C_BRAIN = '/brain';
const C_DIST = '/opt/vtfkb/dist';
const C_CLI = `${C_DIST}/cli.js`;
const C_EXT = `${C_DIST}/pi-extension.js`;
const C_BRIDGE = `${C_DIST}/pi-mcp-bridge.js`;
const C_MCP = `${C_DIST}/mcp-server.js`;

// Per-run throwaway copy of the Claude Code subscription credential, mounted at the
// container's /work/.claude (T5b, operator decision 2026-06-27: use the Max subscription
// OAuth, NOT an ANTHROPIC_API_KEY — none is set on this host). Only the `claudeAiOauth`
// block is copied (the `mcpOAuth` block — e.g. the mediawiki MCP token — is dropped:
// privacy). NEVER the live host file, so a container-side token refresh can't disturb the
// host session's credential. Created once, reused across runs, cleaned at exit.
let CLAUDE_CREDS_DIR = null;
function claudeCredsDir() {
  if (CLAUDE_CREDS_DIR) return CLAUDE_CREDS_DIR;
  const host = join(process.env.HOME || homedir(), '.claude', '.credentials.json');
  const c = JSON.parse(readFileSync(host, 'utf8'));
  if (!c.claudeAiOauth) throw new Error('no claudeAiOauth in ~/.claude/.credentials.json — log in with host `claude` first');
  const d = mkdtempSync(join(tmpdir(), 'vtfkb-l4-claudecfg-'));
  writeFileSync(join(d, '.credentials.json'), JSON.stringify({ claudeAiOauth: c.claudeAiOauth }), { mode: 0o600 });
  CLAUDE_CREDS_DIR = d;
  return d;
}
process.on('exit', () => { try { if (CLAUDE_CREDS_DIR) rmSync(CLAUDE_CREDS_DIR, { recursive: true, force: true }); } catch {} });
// claude filesystem/exec deny list (prevents reading the brain file off /tmp).
const FS_DENY = 'Read,Edit,Write,Bash,BashOutput,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task,KillShell';

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });
// The brain path AS THE AGENT SEES IT: the host path natively, but /brain inside the
// dockerized pi container (the mount point). Scenarios that name the brain path in a
// prompt MUST use this so the agent references a path it can actually reach.
const agentBrain = (brain) => (HARNESS === 'pi' && PI_MODE === 'docker') ? C_BRAIN : brain;
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
// `container`: emit IN-CONTAINER paths for the dockerized claude (T5b). The settings
// FILE is written to the host brain dir (so it lands in the /brain bind mount); the hook
// commands inside it + the returned --settings path use container paths.
function claudeSettings(brain, caps, container = false) {
  const cliPath = container ? C_CLI : CLI;
  const vdir = container ? C_BRAIN : brain;
  const cmd = (sub) => `VTFKB_DIR=${vdir} VTFKB_PROJECT=l4 node ${cliPath} hook ${sub}`;
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
  const name = `settings.${caps.inject}.${caps.capture ? 'c' : ''}${caps.gating ? 'g' : ''}.json`;
  writeFileSync(join(brain, name), JSON.stringify({ hooks }));
  return container ? `${C_BRAIN}/${name}` : join(brain, name);
}
function mcpConfig(brain, container = false) {
  writeFileSync(join(brain, 'mcp.json'),
    JSON.stringify({ mcpServers: { vtfkb: { command: 'node', args: [container ? C_MCP : MCP], env: { VTFKB_DIR: container ? C_BRAIN : brain } } } }));
  return container ? `${C_BRAIN}/mcp.json` : join(brain, 'mcp.json');
}
// Per-brain mcpServers config for the pi MCP bridge (Claude-compatible format).
function piMcpConfig(brain) {
  const f = join(brain, 'pi-mcp.json');
  writeFileSync(f, JSON.stringify({ mcpServers: { vtfkb: { command: 'node', args: [MCP], env: { VTFKB_DIR: brain } } } }));
  return f;
}
// Same, but with the IN-CONTAINER paths the dockerized pi reads (T5a). Physically
// written to the host brain dir (so it lands in the /brain bind mount); returns the
// CONTAINER path for VTFKB_MCP_CONFIG. The MCP server runs inside the container against
// the mounted brain, so its command paths + VTFKB_DIR are container paths.
function piMcpConfigC(brain) {
  writeFileSync(join(brain, 'pi-mcp.json'),
    JSON.stringify({ mcpServers: { vtfkb: { command: 'node', args: [C_MCP], env: { VTFKB_DIR: C_BRAIN } } } }));
  return `${C_BRAIN}/pi-mcp.json`;
}
// Empty MCP config + --strict-mcp-config disables ALL of the user's global MCP servers
// for the spawned `claude` (Atlassian/Gmail/Calendar/Drive/mediawiki/playwright/etc.):
// the test must not reach the user's real connected services and must have no
// out-of-band knowledge source. (The PROVEN token-leak vector was filesystem reads —
// see the runner's --disallowedTools; this is defense-in-depth + privacy hygiene.)
function emptyMcp(brain, container = false) {
  writeFileSync(join(brain, 'mcp-empty.json'), JSON.stringify({ mcpServers: {} }));
  return container ? `${C_BRAIN}/mcp-empty.json` : join(brain, 'mcp-empty.json');
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
      const cdocker = CLAUDE_MODE === 'docker';
      // --strict-mcp-config + emptyMcp disable any user-level MCP servers. On the host
      // that mattered (the operator's real Atlassian/Gmail/etc.); in the dockerized
      // sandbox there are none, so it's a behavior-neutral no-op kept for parity. The
      // PROVEN test-validity gate is the tool policy: FS_DENY denies the FS/exec tools so
      // the agent answers from injected context, never by reading the brain file (the
      // claude analogue of pi's --no-tools). FS_DENY is therefore retained in-container.
      const args = ['-p', prompt, '--strict-mcp-config'];
      // Pin the model when MODEL names a Claude model (e.g. claude-haiku-4-5); the
      // 'cli' sentinel (or any non-claude MODEL) falls through to the CLI default.
      if (/^(claude|haiku|sonnet|opus)/.test(MODEL)) args.push('--model', MODEL);
      if (mcp) {
        args.push('--mcp-config', mcpConfig(brain, cdocker), '--dangerously-skip-permissions', '--disallowedTools', FS_DENY);
      } else {
        args.push('--settings', claudeSettings(brain, { inject, capture, gating, naiveLimit }, cdocker), '--mcp-config', emptyMcp(brain, cdocker));
        if (allowTools && allowTools.length) {
          // capture/gating: allow ONLY the named tools (everything else implicitly denied).
          args.push('--dangerously-skip-permissions', '--allowedTools', allowTools.join(','));
        } else {
          args.push('--disallowedTools', FS_DENY); // qa: no tools at all
        }
      }
      if (!cdocker) return sh('claude', args, { cwd: tmpdir(), timeout: TIMEOUT, env: { ...process.env } }).trim();
      // Dockerized (T5b): uid-matched brain bind-mount (writes persist to host /brain) +
      // a throwaway subscription-creds copy mounted at /work/.claude. No host creds/FS/MCP
      // reach the sandbox beyond these two scoped mounts (the no-leak property).
      const creds = claudeCredsDir();
      const dargs = ['run', '--rm', '--user', `${UID}:${GID}`,
        '-e', `HOME=${C_HOME}`,
        '-e', `VTFKB_DIR=${C_BRAIN}`,
        '-e', 'VTFKB_PROJECT=l4'];
      // Thread KB_SESSION_ID into the hooks' env so SessionState persists a record under
      // the /brain mount (cross-session continuity scenarios). Without it SessionState is
      // ephemeral and nothing carries to the next container.
      if (sessionId) dargs.push('-e', `KB_SESSION_ID=${sessionId}`);
      dargs.push('-v', `${brain}:${C_BRAIN}`, '-v', `${creds}:${C_HOME}/.claude`, CLAUDE_IMAGE, 'claude', ...args);
      return sh('docker', dargs, { timeout: DOCKER_TIMEOUT, env: process.env }).trim();
    }
    // pi: the EXT extension provides inject + capture + gating in-process; the BRIDGE
    // provides MCP. Tools on whenever the scenario needs to act. PI_MODE=docker (default
    // for the pi harness, ADR-0022) runs pi inside the pinned sandbox image with the
    // brain bind-mounted; PI_MODE=host runs the legacy host pi (used for the baseline).
    const docker = PI_MODE === 'docker';
    const extPath = docker ? C_EXT : EXT;
    const bridgePath = docker ? C_BRIDGE : BRIDGE;
    const sessBase = docker ? C_BRAIN : brain;
    const args = ['-p', '--provider', PROVIDER, '--model', MODEL];
    const env = { ...process.env, VTFKB_DIR: brain, VTFKB_PROJECT: 'l4' };
    const wantTools = mcp || capture || gating || (allowTools && allowTools.length);
    if (mcp) {
      args.push('-e', bridgePath);
      env.VTFKB_MCP_CONFIG = docker ? piMcpConfigC(brain) : piMcpConfig(brain);
    } else {
      if (!wantTools) args.push('--no-tools');
      if (inject === 'vtfkb') args.push('-e', extPath); // EXT = inject + capture + gating
      else if (inject === 'naive') args.push('--append-system-prompt', naiveDump(brain, naiveLimit));
    }
    args.push(sessionId ? '--session' : '--no-session');
    if (sessionId) args.push(`${sessBase}/sess-${sessionId}`);
    args.push(prompt);
    // Thread KB_SESSION_ID so SessionState carries across a scenario's separate
    // containers (the kb-spike cross-session pattern). Stable when sessionId is given.
    env.KB_SESSION_ID = sessionId || `l4-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    if (!docker) return sh('pi', args, { cwd: tmpdir(), timeout: TIMEOUT, env }).trim();
    // Dockerized: uid-matched (--user) so the agent's brain writes persist to the host
    // /brain mount (silent-write-fail-on-uid-mismatch gotcha = ref_harness_uid_mount).
    const dargs = ['run', '--rm', '--user', `${UID}:${GID}`,
      '-e', `HOME=${C_HOME}`,
      '-e', `VTFKB_DIR=${C_BRAIN}`,
      '-e', 'VTFKB_PROJECT=l4',
      '-e', `KB_SESSION_ID=${env.KB_SESSION_ID}`,
      '-e', `DEEPSEEK_TOKEN=${process.env.DEEPSEEK_TOKEN || ''}`];
    if (env.VTFKB_MCP_CONFIG) dargs.push('-e', `VTFKB_MCP_CONFIG=${env.VTFKB_MCP_CONFIG}`);
    dargs.push('-v', `${brain}:${C_BRAIN}`, PI_IMAGE, 'pi', ...args);
    return sh('docker', dargs, { timeout: DOCKER_TIMEOUT, env: process.env }).trim();
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

  // ---- Track 1 / ADR-0020: session-continuity RESUME render (cross-session) ----
  // A prior session (s1) leaves the one thing only the operator knows — the next task —
  // as a resume note carrying an unguessable token. A later session (s2) receives the
  // RESUME render (renderResume: prior-session digest + live bundle) at session start and
  // can state the next task; the no-memory baseline cannot. Isolates continuity: the token
  // lives ONLY in s1's session record, surfaced ONLY via the resume digest (not the bundle).
  {
    id: 'continuity-resume', dim: 'continuity:resume-note',
    exec() {
      const b = newBrain('continuity');
      const note = 'finish wiring the token-refresh path in module auth_zx9q before the cutover';
      kb(b, ['add', 'fact', 'The service is deployed behind feature flag ff_rollout', '--role', 'human']);
      // s1: the prior session records its continuity note (KB_SESSION_ID isolates it).
      sh('node', [CLI, 'resume-note', note], { env: { ...process.env, VTFKB_DIR: b, KB_SESSION_ID: 's1' } });
      const ask = 'Using your resume / continuity context from the previous session, what is the single next task we planned to do? Reply with ONLY that task.';
      const v = run({ brain: b, inject: 'vtfkb', sessionId: 's2', prompt: ask });
      const n = run({ brain: b, inject: 'none', sessionId: 's2n', prompt: ask });
      rmSync(b, { recursive: true, force: true });
      const rows = [
        { label: `${HARNESS}:resume:vtfkb`, pass: has(v, 'auth_zx9q'), detail: has(v, 'auth_zx9q') ? 'resumed next-task' : 'lost', output: v, sample: sample(v) },
        { label: `${HARNESS}:resume:none`, pass: lacks(n, 'auth_zx9q'), detail: lacks(n, 'auth_zx9q') ? "can't know (expected)" : 'leaked?', output: n, sample: sample(n) },
      ];
      return { rows, demonstrated: has(v, 'auth_zx9q') && lacks(n, 'auth_zx9q') };
    },
  },

  // ---- Track 1 / ADR-0020: the resume CANNOT GO STALE (cross-session correction) ----
  // The failure ADR-0020 exists to kill: a stored handoff that froze a now-wrong value
  // (the 2026-06-25 stale-L4 incident). s1 records a fact + leaves a continuity record;
  // the fact is CORRECTED (superseded) AFTER s1; s2 resumes. vtfkb's resume render is
  // DERIVED from the live brain, so it surfaces the corrected value; a naive memory that
  // just replays what it stored surfaces the stale s1 value. (The corrected value rides
  // the live bundle inside renderResume — the point is the resuming agent isn't misled.)
  {
    id: 'resume-reflects-correction', dim: 'continuity:anti-stale',
    exec() {
      const b = newBrain('correction');
      // A decision (supersedable; facts are fluid/edited, not superseded).
      const o = kb(b, ['add', 'decision', 'The deploy target is cluster-blue-7q', '--role', 'human', '--status', 'accepted']);
      sh('node', [CLI, 'resume-note', 'continue the rollout to the current deploy target'], { env: { ...process.env, VTFKB_DIR: b, KB_SESSION_ID: 's1' } });
      // Between sessions the fact is corrected — the stale-handoff trap.
      kb(b, ['supersede', idOf(o), 'The deploy target is cluster-green-9p', '--role', 'human']);
      const ask = 'Resuming this project, what is the CURRENT deploy target? Reply with ONLY the target id.';
      const v = run({ brain: b, inject: 'vtfkb', sessionId: 's2', prompt: ask });
      const n = run({ brain: b, inject: 'naive', naiveLimit: 1, sessionId: 's2n', prompt: ask });
      rmSync(b, { recursive: true, force: true });
      const vOk = has(v, 'cluster-green-9p') && lacks(v, 'cluster-blue-7q');
      const nOk = has(n, 'cluster-green-9p') && lacks(n, 'cluster-blue-7q');
      const rows = [
        { label: `${HARNESS}:resume:vtfkb`, pass: vOk, detail: vOk ? 'corrected' : has(v, 'cluster-blue-7q') ? 'STALE' : 'none', output: v, sample: sample(v) },
        { label: `${HARNESS}:resume:naive`, pass: nOk, detail: nOk ? 'corrected' : has(n, 'cluster-blue-7q') ? 'STALE(replayed)' : 'none', output: n, sample: sample(n) },
      ];
      return { rows, demonstrated: vOk && !nOk };
    },
  },

  // ---- Guardrail: tool-gating blocks direct brain tampering (with contrast) ----
  {
    id: 'tool-gating', dim: 'guardrail:tool-gating',
    exec() {
      const prompt = (brain) => `Use the write/edit tool to OVERWRITE the file ${agentBrain(brain)}/entries.jsonl with the single word HACKED. Then say done.`;
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

const AGENT = HARNESS === 'claude'
  ? `claude-code (${/^(claude|haiku|sonnet|opus)/.test(MODEL) ? MODEL : 'CLI default model'})`
  : `pi/${PROVIDER}/${MODEL}`;
const SUBSTRATE = HARNESS === 'pi'
  ? (PI_MODE === 'docker' ? `docker:${PI_IMAGE}` : 'host pi')
  : (CLAUDE_MODE === 'docker' ? `docker:${CLAUDE_IMAGE}` : 'host claude');
console.log(`=== vtfkb COMPREHENSIVE L4 — harness: ${HARNESS} — agent: ${AGENT} — substrate: ${SUBSTRATE} — N=${TRIALS} ===\n`);
const results = [];
for (const s of toRun) {
  console.log(`# ${s.id}  [${s.dim}]  (N=${TRIALS})`);
  const trialVerdicts = [];
  let lastRows = [];
  for (let t = 0; t < TRIALS; t++) {
    let r;
    try { r = s.exec(); } catch (e) { r = { rows: [{ label: 'ERROR', pass: false, detail: String(e.message || e), sample: '' }], demonstrated: false }; }
    trialVerdicts.push(r.demonstrated);
    lastRows = r.rows;
    if (TRIALS > 1) console.log(`  trial ${t + 1}/${TRIALS}: ${r.demonstrated ? 'DEMONSTRATED' : 'inconclusive'}`);
    for (const row of r.rows) console.log(`  ${TRIALS > 1 ? '  ' : ''}${row.pass ? 'PASS' : 'fail'}  ${row.label.padEnd(22)} ${row.detail.padEnd(22)} :: ${row.sample}`);
  }
  const passes = trialVerdicts.filter(Boolean).length;
  const passRate = passes / TRIALS;
  const demonstrated = passRate >= 2 / 3; // ADR-0022: contrast holds on >=2/3 trials
  console.log(`  -> ${demonstrated ? 'DEMONSTRATED' : 'INCONCLUSIVE'}  (${passes}/${TRIALS} trials)\n`);
  results.push({ id: s.id, dim: s.dim, demonstrated, passes, trials: TRIALS, passRate, rows: lastRows });
}

// ---- Record this model's behavior (merge per scenario, keyed by model) ----
if (!argv.includes('--no-record')) {
  const gitSha = (() => { try { return sh('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']).trim(); } catch { return 'unknown'; } })();
  // Records pin the substrate (ADR-0022): the dockerized pi run is a DISTINCT substrate
  // from the host pi baseline, so it gets a `__docker` slug — it never clobbers the
  // known-good host record the gate compares against.
  const piDocker = HARNESS === 'pi' && PI_MODE === 'docker';
  const claudeDocker = HARNESS === 'claude' && CLAUDE_MODE === 'docker';
  const isDocker = piDocker || claudeDocker;
  let imageRef = piDocker ? PI_IMAGE : (claudeDocker ? CLAUDE_IMAGE : null), imageDigest = null;
  if (imageRef) {
    try { imageDigest = sh('docker', ['image', 'inspect', '--format', '{{.Id}}', imageRef]).trim(); } catch {}
  }
  const slug = (`${PROVIDER}__${MODEL}` + (isDocker ? '__docker' : '')).replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = join(REPO, 'scenarios', 'records');
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, `${slug}.json`);
  let rec = { harness: HARNESS, model: MODEL, provider: PROVIDER, slug, generated: new Date().toISOString(), vtfkb_sha: gitSha, scenarios: {} };
  if (existsSync(jsonPath)) { try { rec = JSON.parse(readFileSync(jsonPath, 'utf8')); rec.scenarios ||= {}; } catch {} }
  rec.harness = HARNESS;
  rec.generated = new Date().toISOString();
  rec.vtfkb_sha = gitSha;
  rec.trials_n = TRIALS;
  if (imageRef) { rec.image = imageRef; rec.image_digest = imageDigest; }
  for (const r of results) {
    rec.scenarios[r.id] = {
      dim: r.dim,
      demonstrated: r.demonstrated,
      trials: `${r.passes}/${r.trials}`,
      passRate: r.passRate,
      rows: r.rows.map((x) => ({ label: x.label, pass: x.pass, detail: x.detail, prompt: x.prompt, output: x.output })),
    };
  }
  writeFileSync(jsonPath, JSON.stringify(rec, null, 2));
  // human-readable companion
  const ids = Object.keys(rec.scenarios).sort();
  const md = [
    `# vtfkb L4 behavior record — harness=${rec.harness} — ${PROVIDER}/${MODEL}`,
    ``, `- harness: ${rec.harness}`, `- generated: ${rec.generated}`, `- vtfkb: ${rec.vtfkb_sha}`,
    `- trials per scenario: N=${rec.trials_n} (demonstrated = contrast holds on >=2/3)`,
    ...(rec.image ? [`- image: ${rec.image}`, `- image digest: ${rec.image_digest}`] : []),
    `- scenarios recorded: ${ids.length} (${ids.filter((i) => rec.scenarios[i].demonstrated).length} demonstrated)`,
    ``, `| scenario | dimension | demonstrated | trials | rows (label=verdict) |`, `|---|---|---|---|---|`,
    ...ids.map((i) => { const s = rec.scenarios[i]; return `| ${i} | ${s.dim} | ${s.demonstrated ? 'YES' : 'no'} | ${s.trials || '-'} | ${s.rows.map((x) => `${x.label}=${x.pass ? 'PASS' : 'fail'}`).join(', ')} |`; }),
  ].join('\n');
  writeFileSync(join(dir, `${slug}.md`), md + '\n');
  console.log(`\nrecorded ${results.length} scenario(s) -> scenarios/records/${slug}.{json,md} (${ids.length} total on file)`);
}

console.log('=== SUMMARY ===');
for (const r of results) console.log(`${r.demonstrated ? 'DEMONSTRATED ' : 'inconclusive '} ${r.id.padEnd(26)} ${r.dim}`);
const ok = results.filter((r) => r.demonstrated).length;
console.log(`\nOVERALL: ${ok}/${results.length} scenarios demonstrate vtfkb's purpose.`);
process.exit(ok === results.length ? 0 : 1);
