// ============================================================================
// The ONE way a vfkb scenario or probe spawns `claude` on the host (vfkb#422).
// ----------------------------------------------------------------------------
// Every host-run `claude` child gets:
//   - the operator's OAuth ACCESS token in $CLAUDE_CODE_OAUTH_TOKEN (no refresh
//     token, no staged .credentials.json anywhere);
//   - a no-op `security` shim FIRST on PATH, which logs `subcommand|service` and
//     exits 44, so the child can never read or write the macOS Keychain;
//   - a guard that refuses to spawn from a non-Aqua launchd session (herdr/tmux
//     panes, ssh) unless CLAUDE_CODE_OAUTH_TOKEN is exported. There, a Keychain
//     touch is a modal dialog on the operator's screen (brain gotcha 4bceb1a993c2,
//     the 2026-10-29 dialog storm).
//
// The mechanism is vilosource/vfkb-claude-plugin scenarios/auth.mjs (PR #71),
// vendored VERBATIM at ./vendor/plugin-auth.mjs:
//
//   UPSTREAM  vilosource/vfkb-claude-plugin  scenarios/auth.mjs
//   COMMIT    36552e76a7cbc8fe51718859fe0a80de111c3571
//   BLOB      79eb6d0942de33201952b6e9960ebf4c65352f5b  (test/claude-auth.test.ts pins it)
//
//   Has upstream moved?   git -C <plugin-clone> fetch origin main &&
//                         git -C <plugin-clone> log --oneline 36552e76..origin/main -- scenarios/auth.mjs
//                         (empty = current)
//   Is the copy intact?   git hash-object scenarios/lib/vendor/plugin-auth.mjs  (== BLOB)
//
// This file holds vfkb's two DELIBERATE divergences from upstream, as a wrapper so
// the vendored copy stays byte-identical (#389 decide step, ruling 54802539cda7):
//
//   1. Session check BEFORE any Keychain read. Upstream's assertNoKeychainDialogs()
//      reads the stored credential (`security find-generic-password -w`) first and
//      only then checks the session manager, so it cannot pre-empt a read prompt.
//      Here, on darwin outside Aqua, the only admissible credential is an exported
//      CLAUDE_CODE_OAUTH_TOKEN (e.g. from `claude setup-token`) and the Keychain is
//      never consulted. Under Aqua the upstream Keychain read stays (the laptop leg).
//      ANTHROPIC_API_KEY alone does not qualify here: the vendored token lookup
//      would still read the Keychain for the OAuth token (and the operator ruled
//      the claude arm runs on the subscription, not an API key).
//   2. An exit line ALWAYS, not only when writes were refused:
//        claude-auth: keychain shim calls=<N> refusedWrites=<M>
//      so "0 refused writes" is an observed string, not an inference from silence
//      (ADR-0051 clause 3). calls>=1 shows the shim really sat on the child's PATH.
//
// Scenario usage:
//   import { assertClaudeAuthReady, claudeSync, redactSecrets } from './lib/claude-auth.mjs';
//   assertClaudeAuthReady();                 // top of file, before anything metered
//   const out = claudeSync(args, { cwd, timeout, stdio });  // runs the claude binary under claudeEnv()
//   // claudeSync() already redacts what it returns or throws; use redactSecrets()
//   // for any other text bound for a record.
//
// The Brake is test/claude-spawn-audit.test.ts: no file under scenarios/ other
// than this one may spawn `claude` itself.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import * as upstream from './vendor/plugin-auth.mjs';

export const UPSTREAM = Object.freeze({
  repo: 'vilosource/vfkb-claude-plugin',
  path: 'scenarios/auth.mjs',
  commit: '36552e76a7cbc8fe51718859fe0a80de111c3571',
  blob: '79eb6d0942de33201952b6e9960ebf4c65352f5b',
});

export const redactSecrets = upstream.redactSecrets;

let managerName;
function sessionManager() {
  if (managerName !== undefined) return managerName;
  try {
    managerName = execFileSync('launchctl', ['managername'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    managerName = 'unknown';
  }
  return managerName;
}

/**
 * Refuse a spawn that could put a Keychain dialog on the operator's screen.
 * Pure over (env, probe): it never reads the Keychain itself, which is the point.
 */
export function assertNoKeychainDialogs(env = process.env, probe = {}) {
  if ((probe.platform ?? process.platform) !== 'darwin') return;
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return;
  const mgr = probe.manager ?? sessionManager();
  if (mgr === 'Aqua') return;
  throw new Error(
    `claude-auth: launchctl managername is "${mgr}", not "Aqua", and CLAUDE_CODE_OAUTH_TOKEN is not exported — ` +
      'refusing before any Keychain access: outside the GUI session every Keychain touch is a modal dialog for ' +
      'the operator. Export a token (`claude setup-token`, or the stored access token) and re-run.',
  );
}

let used = false;
let shimDir = null;

function noteUse() {
  if (used) return;
  used = true;
  process.on('exit', () => {
    try {
      writeSync(2, formatShimReport(keychainShimReport()) + '\n');
    } catch { /* stderr closed: nothing to report to */ }
    if (shimDir && isAbsolute(shimDir) && shimDir.includes('vfkb-l4-nokeychain-')) {
      try { rmSync(shimDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });
}

function assertOAuthMode() {
  // The vendored seam also has a deepseek-env mode (VFKB_L4_AUTH, an env var shared with
  // the plugin repo) that strips CLAUDE* vars and adds NO shim. No vfkb host scenario
  // uses it; inherited by accident it would turn the whole seam off while the exit line
  // still reported a built shim. Refuse it.
  if (upstream.AUTH_MODE !== 'oauth') {
    throw new Error(
      `claude-auth: VFKB_L4_AUTH=${upstream.AUTH_MODE} is not supported for vfkb host claude spawns — ` +
        'only oauth carries the env token and the no-Keychain shim. Unset VFKB_L4_AUTH and re-run.',
    );
  }
}

let ready = false;

/**
 * Preconditions, at the top of every scenario that spawns claude, before anything
 * metered: oauth mode, the session guard (this file) BEFORE any credential read, then
 * upstream's token checks (present, not expired, at least VFKB_L4_MIN_TOKEN_MINUTES
 * (default 60) left on a stored token). claudeEnv() runs this itself before the first
 * spawn, so a scenario that forgets the top-of-file call still gets every check.
 */
export function assertClaudeAuthReady(probe = {}) {
  noteUse();
  assertOAuthMode();
  assertNoKeychainDialogs(process.env, probe);
  upstream.assertAuthReady();
  ready = true;
}

/** The env a host `claude` child runs under: token in env, shim first on PATH. */
export function claudeEnv(baseEnv = process.env, probe = {}) {
  noteUse();
  assertOAuthMode();
  assertNoKeychainDialogs(process.env, probe);
  if (!ready) assertClaudeAuthReady(probe);
  const env = upstream.authEnv(baseEnv);
  const first = env.PATH.split(':')[0];
  // Verify, don't assume: the shim must really be PATH[0] before anything is spawned.
  if (!first.includes('vfkb-l4-nokeychain-') || !existsSync(join(first, 'security'))) {
    throw new Error(`claude-auth: the no-Keychain security shim is not first on the child PATH (got "${first}") — refusing to spawn`);
  }
  shimDir = first;
  return env;
}

// Strings and Buffers (encoding: 'buffer') alike; a Buffer is only rebuilt when a
// secret was actually present, so binary-clean output passes through untouched.
function redactAny(v) {
  if (typeof v === 'string') return redactSecrets(v);
  if (Buffer.isBuffer(v)) {
    const text = v.toString('utf8');
    const red = redactSecrets(text);
    return red === text ? v : Buffer.from(red, 'utf8');
  }
  return v;
}

/**
 * The claude binary run synchronously under claudeEnv(); same defaults as the
 * scenarios' sh(). Redaction happens HERE, at the one capture point every scenario
 * shares: the returned stdout, and a thrown error's stdout/stderr/message, never
 * carry the token, so no record or debug file written from them can either. Record
 * fields are otherwise untouched (only token bytes could ever change).
 */
export function claudeSync(args, opts = {}) {
  const env = claudeEnv(opts.env ?? process.env);
  try {
    return redactAny(execFileSync('claude', args, { encoding: 'utf8', ...opts, env }));
  } catch (e) {
    if (e && typeof e === 'object') {
      for (const k of ['stdout', 'stderr', 'message']) {
        try { e[k] = redactAny(e[k]); } catch { /* read-only field */ }
      }
      if (Array.isArray(e.output)) e.output = e.output.map(redactAny);
    }
    throw e;
  }
}

/** `claude --version`, routed through the same seam as the arms (provenance fidelity). */
export function claudeVersion(opts = {}) {
  return claudeSync(['--version'], { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

/** What the shim saw so far. `calls` counts reads too; `refusedWrites` is the subset that were writes. */
export function keychainShimReport() {
  if (!shimDir) return { built: false, calls: 0, refusedWrites: 0 };
  let lines = [];
  try {
    lines = readFileSync(join(shimDir, 'attempts.log'), 'utf8').split('\n').filter(Boolean);
  } catch { /* no attempts yet: the shim writes the log on first call */ }
  return { built: true, calls: lines.length, refusedWrites: upstream.keychainWriteAttempts().length };
}

export function formatShimReport({ built = true, calls, refusedWrites }) {
  const line = `claude-auth: keychain shim calls=${calls} refusedWrites=${refusedWrites}`;
  if (!built) return `${line} (shim never built: no claude child was spawned)`;
  return refusedWrites > 0 ? `WARNING — ${line}` : line;
}
