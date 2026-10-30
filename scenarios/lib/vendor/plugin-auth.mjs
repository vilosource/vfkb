// ============================================================================
// The credential seam for the four L4 scenarios (ADR-0067 — hybrid model).
// ----------------------------------------------------------------------------
// Two modes, selected by $VFKB_L4_AUTH:
//
//   oauth (default)  — the laptop leg: hand the operator's OAuth access token to
//                      each child as $CLAUDE_CODE_OAUTH_TOKEN. NOTHING is staged
//                      on disk and the child never touches the macOS Keychain
//                      (see "No Keychain" below).
//   deepseek-env     — the CI leg: NO credential file anywhere; headless
//                      Claude Code authenticates via ANTHROPIC_BASE_URL +
//                      ANTHROPIC_AUTH_TOKEN against DeepSeek's
//                      Anthropic-compatible endpoint (spike plugin#45 —
//                      full pipeline observed working, marketplace included).
//
// Every record gains a producedBy block (ADR-0067 D5) naming where the run
// happened and the credential KIND — never a value — so the two record
// populations stay distinguishable at a glance.
//
// Secrets: with env auth, a token echoed into an error line would land in a
// committed record's `out`/`err` field. GitHub masks logs, not file contents
// (the RFC-036 D3 lesson). redactSecrets() is applied at every capture point.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const AUTH_MODE = process.env.VFKB_L4_AUTH || 'oauth';
const DEEPSEEK_BASE = 'https://api.deepseek.com/anthropic';
// The env token cannot be refreshed by the child, so it must outlive the run.
const MIN_TOKEN_MINUTES = parseInt(process.env.VFKB_L4_MIN_TOKEN_MINUTES || '60', 10);

if (!['oauth', 'deepseek-env'].includes(AUTH_MODE)) {
  throw new Error(`VFKB_L4_AUTH=${AUTH_MODE} is not a mode (oauth | deepseek-env)`);
}

/**
 * The Keychain service holding THIS profile's credentials.
 *
 * Claude Code keys its Keychain entry by config dir: the default `~/.claude`
 * profile uses the bare service name, and every relocated profile appends the
 * first 8 hex of sha256($CLAUDE_CONFIG_DIR). Reading the bare name from a
 * wrapper-launched session therefore returns ANOTHER profile's token — which is
 * how a run staged a stale `team` credential while `claude auth status` in the
 * same shell reported a live `max` one, and then failed all six trials with
 * "401 OAuth access token has been revoked".
 *
 * DERIVED, NOT DOCUMENTED (observed 2026-09-13). sha256(path)[:8] reproduced all
 * three suffixed entries on this machine exactly — .claude-cldp -> 7993e3dd,
 * .claude-cldw -> 77ec0b16, .claude-oneio -> a4edfbef — so it is a 3/3 match on
 * independent inputs rather than a guess. If Claude Code ever changes the scheme
 * this lookup simply misses and readRealCredentials() throws naming what it tried,
 * which is the safe direction: a loud miss, never a silently wrong account.
 */
function keychainService() {
  const base = 'Claude Code-credentials';
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  if (!cfg || resolve(cfg) === resolve(join(homedir(), '.claude'))) return base;
  return `${base}-${createHash('sha256').update(cfg).digest('hex').slice(0, 8)}`;
}

/**
 * Read the operator's real credentials, from wherever Claude Code actually keeps
 * them. Two lookups, in order, because BOTH assumptions in the original one-liner
 * were wrong on this machine (observed 2026-09-13, which is why the L4s could not
 * be run at all):
 *
 *   1. `$CLAUDE_CONFIG_DIR/.credentials.json`, else `~/.claude/.credentials.json`.
 *      Claude Code relocates its ENTIRE config dir via that variable and the wrapper
 *      launchers here all set it; hardcoding `~/.claude` looked in a directory the
 *      session does not use. (Same defect class as the guard this branch fixes.)
 *   2. The macOS login Keychain, service "Claude Code-credentials". On macOS there
 *      is NO credentials file at all by default — the token lives in the Keychain,
 *      and the payload is already the exact `{ claudeAiOauth: … }` shape the sandbox
 *      wants. Without this, oauth mode is unrunnable on a stock macOS install.
 *
 * Returns the parsed object, or throws naming every place it looked — a credential
 * lookup that fails vaguely costs a metered run to diagnose.
 */
function readRealCredentials() {
  const tried = [];
  const cfg = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const file = join(cfg, '.credentials.json');
  tried.push(file);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch { /* fall through to the Keychain */ }

  if (process.platform === 'darwin') {
    const svc = keychainService();
    tried.push(`macOS Keychain service "${svc}"`);
    try {
      const out = execFileSync(
        'security',
        ['find-generic-password', '-s', svc, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return JSON.parse(out.trim());
    } catch { /* fall through to the throw */ }
  }
  throw new Error(`no readable Claude Code credentials — looked in: ${tried.join(' ; ')}`);
}

// Fail BEFORE anything metered runs, and name the missing thing. An empty
// token does not error fast — observed in the spike: a bad token makes
// `claude -p` HANG to the timeout, which a trial would score as a model miss.
export function assertAuthReady() {
  if (AUTH_MODE === 'deepseek-env') {
    if (!process.env.DEEPSEEK_TOKEN) {
      throw new Error('VFKB_L4_AUTH=deepseek-env but DEEPSEEK_TOKEN is not set — refusing: ' +
        'a missing token hangs the turn and would be scored as a scenario result');
    }
    return;
  }
  assertNoKeychainDialogs();
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return; // operator-supplied (e.g. `claude setup-token`)
  let all;
  try { all = readRealCredentials(); } catch (e) {
    throw new Error(`oauth mode but no credentials could be read: ${e.message}`);
  }
  if (!all.claudeAiOauth) throw new Error('credentials found, but they carry no claudeAiOauth block');

  // PRESENT is not the same as VALID, and the difference costs real money. The
  // scenarios copy the STORED token into the sandbox verbatim; they never refresh
  // it. A live Claude Code session keeps working off an in-memory refresh, so the
  // snapshot on disk can be long expired while everything looks healthy — observed
  // 2026-09-13, when a token that expired two days earlier let this check pass and
  // then failed all six trials with "401 OAuth access token has been revoked",
  // burning the metered runs AND writing a 0/3 NOT-DEMONSTRATED record that blamed
  // the capability for an auth failure. That record is worse than the wasted spend:
  // it is false evidence in the DoD chain.
  //
  // This is the same reasoning as the empty-token check above ("a missing token
  // hangs the turn and would be scored as a model miss") — applied to the failure
  // mode that actually happened.
  const expiresAt = all.claudeAiOauth.expiresAt;
  if (typeof expiresAt === 'number' && expiresAt > Date.now() &&
      expiresAt - Date.now() < MIN_TOKEN_MINUTES * 60000) {
    // The child gets the ACCESS token only (no refresh token — that is what keeps it
    // off the Keychain), so a run that outlives the token fails mid-trial with a
    // 401 and scores the auth failure as a capability miss.
    const mins = Math.round((expiresAt - Date.now()) / 60000);
    throw new Error(
      `the stored claudeAiOauth token expires in ${mins} min (< VFKB_L4_MIN_TOKEN_MINUTES=${MIN_TOKEN_MINUTES}) — ` +
        'refusing: the sandboxed children cannot refresh it. Use `claude` interactively until it refreshes, ' +
        'or export a long-lived CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`), then re-run.',
    );
  }
  if (typeof expiresAt === 'number' && expiresAt <= Date.now()) {
    const when = new Date(expiresAt).toISOString();
    throw new Error(
      `the stored claudeAiOauth token EXPIRED at ${when} — refusing before anything metered runs. ` +
        'A live session refreshes in memory without rewriting the store, so this can be stale while ' +
        'Claude Code still works. Re-authenticate (run `claude` and complete /login) so the refreshed ' +
        'token is written back, then re-run this scenario.',
    );
  }
}

/**
 * Stage credentials into a sandbox HOME — now a deliberate no-op in BOTH modes.
 *
 * It used to copy the claudeAiOauth block (access AND refresh token) into
 * <home>/.claude/.credentials.json. On macOS that made every sandbox a fresh
 * Claude Code profile that could refresh the token and save it to a NEW Keychain
 * item, "Claude Code-credentials-<sha256(config dir)[:8]>" — one per throwaway
 * dir. Observed 2026-10-29: run from a herdr pane (`launchctl managername` =
 * "Background", no GUI login keychain), every such save popped "A keychain cannot
 * be found to store …", one dialog per spawned run. A sandbox refresh could also
 * rotate the operator's real refresh token out from under the live session.
 * authEnv() now carries an access token in the child env instead; kept as an
 * export so the scenarios' call sites stay valid.
 */
export function stageAuth(_homeDir) {}

// --- No Keychain -------------------------------------------------------------
// Belt and braces for the env token: every child runs with a `security` shim
// first on PATH that answers "item not found" (exit 44) and never reaches the real
// Keychain. Claude Code 2.1.292 reads and writes the Keychain by spawning
// `security` from PATH (`security -i` with stdin, or `add-generic-password` for a
// large payload — seen in the binary), so this makes a Keychain write IMPOSSIBLE
// rather than merely unexpected. Attempts are logged (subcommand + service only,
// never an argument that could carry a secret); keychainWriteAttempts() reads them.
let shimDir = null;
let shimLog = null;
function keychainShim() {
  if (shimDir) return shimDir;
  shimDir = mkdtempSync(join(tmpdir(), 'vfkb-l4-nokeychain-'));
  shimLog = join(shimDir, 'attempts.log');
  const sec = join(shimDir, 'security');
  writeFileSync(sec, [
    '#!/bin/sh',
    '# vfkb L4: no Keychain access from sandboxed children (auth.mjs)',
    'sub="$1"; svc=""',
    'while [ $# -gt 0 ]; do [ "$1" = "-s" ] && svc="$2"; shift; done',
    `printf '%s|%s\n' "$sub" "$svc" >> '${shimLog}'`,
    'exit 44',
    '',
  ].join('\n'));
  chmodSync(sec, 0o755);
  return shimDir;
}

/** Keychain WRITE attempts the shim refused so far (`-i` is the stdin write path). */
export function keychainWriteAttempts() {
  if (!shimLog) return [];
  let lines = [];
  try { lines = readFileSync(shimLog, 'utf8').split('\n').filter(Boolean); } catch { return []; }
  return lines.filter((l) => /^(-i|add-generic-password|delete-generic-password)\|/.test(l));
}

// Say so loudly if a child still tried: the shim refused it, but it means the env
// route stopped covering some path and the shim is all that stands in the way.
process.on('exit', () => {
  const n = keychainWriteAttempts().length;
  if (n) process.stderr.write(`auth.mjs: WARNING — the no-Keychain shim refused ${n} Keychain write attempt(s)\n`);
});

let managerName;
function sessionManager() {
  if (managerName !== undefined) return managerName;
  try {
    managerName = execFileSync('launchctl', ['managername'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { managerName = 'unknown'; }
  return managerName;
}

/**
 * Refuse to spawn into a dialog storm. On macOS outside the GUI ("Aqua") session
 * — tmux/herdr panes, ssh, launchd — the login Keychain cannot be written and each
 * attempt is a modal dialog for the operator. If the child env would carry no env
 * credential, Claude Code falls back to the Keychain: refuse instead.
 */
export function assertNoKeychainDialogs(env = process.env, probe = {}) {
  if ((probe.platform ?? process.platform) !== 'darwin') return;
  const hasEnvCred = Boolean(env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  if (hasEnvCred) return;
  if (AUTH_MODE === 'oauth') {
    // authEnv() supplies the token itself; only a missing token is a problem.
    const read = probe.readToken ?? (() => readRealCredentials().claudeAiOauth?.accessToken);
    try { if (read()) return; } catch { /* fall through */ }
  }
  const mgr = probe.manager ?? sessionManager();
  if (mgr !== 'Aqua') {
    throw new Error(
      `launchctl managername is "${mgr}", not "Aqua", and no env credential (CLAUDE_CODE_OAUTH_TOKEN / ` +
        'ANTHROPIC_API_KEY) is available — refusing to spawn claude: each child would try the login Keychain ' +
        'and pop a "keychain cannot be found" dialog. Export CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`) and re-run.',
    );
  }
}

let oauthToken;
function oauthAccessToken() {
  if (oauthToken !== undefined) return oauthToken;
  oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN || readRealCredentials().claudeAiOauth?.accessToken || null;
  return oauthToken;
}

/**
 * Pin a child to a SANDBOX home — both halves of it.
 *
 * Setting HOME alone is not isolation. Claude Code reads its config from
 * $CLAUDE_CONFIG_DIR when that is set, and only falls back to $HOME/.claude when
 * it is not — so a scenario launched from a wrapper-launched session (cldp/cldw/
 * cldo all export it) inherited the HOST's config dir straight through
 * `{ ...process.env, HOME: home }`. Two consequences, both silent:
 *   - `claude plugin install` in an arm wrote to the OPERATOR'S real registry
 *     instead of the sandbox;
 *   - the ADR-0059 guard (which resolves the same variable since vfkb ADR-0072)
 *     answered about the host, so inactive-signal's arms stopped being causal.
 *
 * Note the interaction with authEnv(): in deepseek mode it strips every
 * CLAUDE-prefixed key, which removes this pin — harmless, because the value it
 * removes is exactly the `$HOME/.claude` the fallback then computes. In oauth
 * mode (passthrough) the pin is what does the work.
 */
export function sandboxEnv(baseEnv, home) {
  return { ...baseEnv, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude') };
}

/**
 * The env a `claude` child runs under. oauth: passthrough plus
 * CLAUDE_CODE_OAUTH_TOKEN and the no-Keychain `security` shim on PATH (above).
 * deepseek-env: strip every ANTHROPIC- and CLAUDE-prefixed
 * var the caller inherited (nothing may leak from the invoking session), then
 * set the endpoint pair.
 */
export function authEnv(baseEnv) {
  if (AUTH_MODE === 'oauth') {
    const token = oauthAccessToken();
    const env = { ...baseEnv };
    if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
    // On every platform: a no-op where there is no `security`, and it keeps the selftest portable.
    env.PATH = `${keychainShim()}:${baseEnv.PATH || process.env.PATH || ''}`;
    assertNoKeychainDialogs(env);
    return env;
  }
  const env = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (/^(ANTHROPIC|CLAUDE)/i.test(k)) continue;
    env[k] = v;
  }
  env.ANTHROPIC_BASE_URL = DEEPSEEK_BASE;
  env.ANTHROPIC_AUTH_TOKEN = process.env.DEEPSEEK_TOKEN;
  return env;
}

/** Redact the token (and any deepseek-key-shaped string) from text bound for a record. */
export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const tok of [process.env.DEEPSEEK_TOKEN, oauthToken, process.env.CLAUDE_CODE_OAUTH_TOKEN]) {
    if (tok && tok.length >= 8) out = out.split(tok).join('***REDACTED***');
  }
  return out.replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '***REDACTED***');
}

/** The ADR-0067 D5 provenance block. Credential KIND only — never a value. */
export function producedBy(repoDir) {
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();
  } catch { /* recorded as unknown rather than omitted */ }
  const onRunner = process.env.GITHUB_ACTIONS === 'true';
  return {
    ranOn: onRunner ? 'github-runner' : 'laptop',
    credentialKind: AUTH_MODE === 'oauth' ? 'claude-oauth' : 'deepseek-env',
    authBase: AUTH_MODE === 'oauth' ? 'anthropic-production' : DEEPSEEK_BASE,
    runUrl: onRunner && process.env.GITHUB_SERVER_URL
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    commit,
  };
}
