#!/usr/bin/env node
// L4 scenario — V2-1 session backbone (ADR-0039 ← RFC-014).
//
// Contract (the DoD): two real Claude Code sessions run against ONE brain dir with
// KB_SESSION_ID **unset** (the verified GAP-1 condition). Assert:
//   1. each session gets its own persisted `.sessions/<harness-session-id>.json`;
//   2. session 1's record ACCUMULATES across a `--resume` turn (turnCount == 2);
//   3. captured entries are stamped with the session_id of the session that made
//      the tool call, and land in the right session's capturedIds.
// Must-fail arm (`--arm baseline`): the same drive against a PRE-FIX dist must show
// ephemeral state (no `.sessions/` at all) — proves the scenario can fail (ADR-0029).
//
// Live + metered (real `claude -p`, haiku). Host-sandboxed, not dockerized: the
// capability under test is the hook<->harness stdin contract itself, which the local
// CLI exercises directly. Sandbox uses ABSOLUTE paths to the dist under test — no
// symlinks back into the repo (leak-guard gotcha).
//
// Usage:
//   node scenarios/session-backbone.mjs --arm fixed    [--dist <path/to/dist>]
//   node scenarios/session-backbone.mjs --arm baseline  --dist <path/to/prefix-dist>

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const ARM = flag('arm') ?? 'fixed';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(flag('dist') ?? join(REPO, 'dist'));
const MODEL = process.env.VFKB_SB_MODEL || 'claude-haiku-4-5-20251001';

if (!existsSync(join(DIST, 'cli.js'))) { console.error(`no cli.js under ${DIST}`); process.exit(2); }

// --- sandbox ---------------------------------------------------------------
const sb = mkdtempSync(join(tmpdir(), `vfkb-sb-${ARM}-`));
const brain = join(sb, '.vfkb');
mkdirSync(join(sb, '.claude'), { recursive: true });
mkdirSync(brain, { recursive: true });
const hook = (sub) => `VFKB_DATA_DIR=${brain} VFKB_PROJECT=sbtest node ${join(DIST, 'cli.js')} hook ${sub}`;
writeFileSync(join(sb, '.claude', 'settings.json'), JSON.stringify({
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: hook('session-start') }] }],
    PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: hook('post-tool-use') }] }],
    Stop: [{ hooks: [{ type: 'command', command: hook('stop') }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: hook('session-end') }] }],
  },
}, null, 2));

const env = { ...process.env };
delete env.KB_SESSION_ID; // the GAP-1 condition under test
delete env.VFKB_DATA_DIR; // hooks carry their own; the harness process needs neither

function claude(prompt, resumeId) {
  const a = ['-p', prompt, '--model', MODEL, '--allowedTools', 'Bash', '--output-format', 'json'];
  if (resumeId) a.push('--resume', resumeId);
  const out = execFileSync('claude', a, { cwd: sb, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 });
  const j = JSON.parse(out.slice(out.indexOf('{')));
  return j.session_id;
}

// --- drive: 2 sessions, session 1 gets a resumed second turn ----------------
console.log(`[${ARM}] sandbox: ${sb}`);
const s1 = claude('Use the Bash tool to run exactly: echo marker-s1-t1 . Then reply: done.');
console.log(`[${ARM}] s1 t1 -> ${s1}`);
const s1b = claude('Use the Bash tool to run exactly: echo marker-s1-t2 . Then reply: done.', s1);
console.log(`[${ARM}] s1 t2 (resume) -> ${s1b}`);
const s2 = claude('Use the Bash tool to run exactly: echo marker-s2-t1 . Then reply: done.');
console.log(`[${ARM}] s2 t1 -> ${s2}`);

// --- observe ----------------------------------------------------------------
const sessionsDir = join(brain, '.sessions');
const record = (id) => {
  const f = join(sessionsDir, `${id}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined;
};
const entries = existsSync(join(brain, 'entries.jsonl'))
  ? readFileSync(join(brain, 'entries.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const capturedBy = (id) => entries.filter((e) => e.session_id === id && (e.tags ?? []).includes('captured'));

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

if (ARM === 'baseline') {
  // Pre-fix code: no env id -> ephemeral state. The WHOLE arm passes iff nothing persisted.
  check('pre-fix: no .sessions dir (state was ephemeral)', !existsSync(sessionsDir),
    existsSync(sessionsDir) ? readdirSync(sessionsDir).join(',') : 'absent');
  check('pre-fix: no entry carries a session_id stamp', entries.every((e) => e.session_id === undefined));
} else {
  check('resume kept one session id across turns', s1 === s1b, `${s1} vs ${s1b}`);
  const r1 = record(s1); const r2 = record(s2);
  check(`session 1 record persisted (${s1})`, !!r1);
  check(`session 2 record persisted (${s2})`, !!r2);
  const n = existsSync(sessionsDir) ? readdirSync(sessionsDir).filter((f) => f.endsWith('.json')).length : 0;
  check('exactly 2 session records against the one brain', n === 2, `${n} records`);
  check('session 1 accumulated across the resumed turn (turnCount==2)', r1?.turnCount === 2, `turnCount=${r1?.turnCount}`);
  check('session 2 counted its single turn (turnCount==1)', r2?.turnCount === 1, `turnCount=${r2?.turnCount}`);
  check('record carries the identity surface (pid)', typeof r1?.pid === 'number');
  const c1 = capturedBy(s1); const c2 = capturedBy(s2);
  check('session 1 captures stamped with s1 id (>=1 across 2 turns)', c1.length >= 1, `${c1.length}`);
  check('session 2 captures stamped with s2 id (>=1)', c2.length >= 1, `${c2.length}`);
  check('no capture cross-stamped or unstamped', entries.filter((e) => (e.tags ?? []).includes('captured')).every((e) => e.session_id === s1 || e.session_id === s2));
  check('capturedIds recorded in the RIGHT session record', c1.every((e) => (r1?.capturedIds ?? []).includes(e.id)) && c2.every((e) => (r2?.capturedIds ?? []).includes(e.id)));
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n[${ARM}] ${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
