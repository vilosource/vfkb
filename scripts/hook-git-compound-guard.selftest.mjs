#!/usr/bin/env node
// Negative checks for the git-compound guard (ADR-0070 §5; ADR-0029 — observed
// failing, both directions). Each case pipes a real PreToolUse payload through
// the real hook process and asserts the decision.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'hook-git-compound-guard.mjs');

const run = (input) => {
  const r = spawnSync('node', [HOOK], { input, encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) throw new Error(`hook exited ${r.status} — a hook must never error (issue #214)`);
  return r.stdout;
};
const decision = (command) => {
  const out = run(JSON.stringify({ tool_input: { command } }));
  try { return JSON.parse(out)?.hookSpecificOutput?.permissionDecision ?? 'allow'; } catch { return 'allow'; }
};

// F1 (review of #263): the hook must TERMINATE when stdin never closes, and a
// dangerous payload that arrived before the deadline must STILL be denied — a
// watchdog that discards the buffer is a silently inert guard (ADR-0051 §3).
import { spawn } from 'node:child_process';
async function watchdogCase() {
  return new Promise((resolveP) => {
    const p = spawn('node', [HOOK], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    const killer = setTimeout(() => {
      p.kill('SIGKILL');
      resolveP({ terminated: false, out });
    }, 5000);
    p.on('exit', () => {
      clearTimeout(killer);
      resolveP({ terminated: true, out });
    });
    // Write a DENY-shaped payload and hold stdin open forever.
    p.stdin.write(JSON.stringify({ tool_input: { command: 'git checkout main && rm -rf build' } }));
  });
}

const CASES = [
  // The two shapes that actually bit (2026-07-26), both must DENY:
  ['git checkout docs/adr-0068-self-merge && python3 - <<EOF\nstuff\nEOF', 'deny'],
  ['git checkout -q feat/x 2>/dev/null || git checkout -q -b feat/x; git stash pop -q', 'deny'],
  ['git switch main && npm test', 'deny'],
  ['cd repo && git checkout main; rm -rf build', 'deny'],
  // F2 (review of #263): a NEWLINE separates commands exactly like `;` — the
  // routine multi-line Bash shape, not adversarial evasion. Both sides:
  ['git checkout main\nrm -rf build', 'deny'],
  ['echo prep\ngit checkout main && rm -rf build', 'deny'],
  ['git checkout feat/x\ngit commit -m wip', 'deny'],
  // F3: a global flag between git and the subcommand must not defeat the guard.
  ['git -C /home/user/repo checkout main && rm -rf build', 'deny'],
  // Legitimate shapes that must stay ALLOWED (a gate that blocks honest work is a defect):
  ['git checkout feat/x', 'allow'],
  ['git switch -c feat/new', 'allow'],
  ['git checkout -- .vfkb/entries.jsonl', 'allow'],                    // file restore (brain recovery)
  ['git checkout -q main -- docs/file.md && cat docs/file.md', 'allow'], // ref-scoped file restore
  ['git checkout -- .vfkb/entries.jsonl && git status', 'allow'],      // restore then read
  ['git log --oneline && git status', 'allow'],                        // no switch at all
  ['echo "git checkout is a command"', 'allow'],                       // prose mention... conservative: contains no separator after
  ['npm test && git commit -m x', 'allow'],
  // The false positive this hook produced on its FIRST live firing: a heredoc
  // whose PROSE mentions git checkout/switch chained with separators. `git`
  // mid-sentence is not at a command position and must not deny — the hook
  // blocked the very command that documented the rule, then blocked its own fix.
  ['python3 - <<EOF\ntext: "never chain git\n  checkout/switch compounded with &&/; in one command"\nEOF', 'allow'],
  ['cat <<DOC\nthe rule about git checkout must not be chained; use two commands\nDOC', 'allow'],
];

let failed = 0;
for (const [cmd, want] of CASES) {
  const got = decision(cmd);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  [${want}] ${cmd.split('\n')[0].slice(0, 70)}${ok ? '' : ` → got ${got}`}`);
}

// Fail-open contract: garbage stdin must allow, not crash.
for (const garbage of ['not json', '', '{"tool_input":{}}', '{"tool_input":{"command":null}}']) {
  const out = run(garbage);
  const dec = (() => { try { return JSON.parse(out)?.hookSpecificOutput?.permissionDecision ?? 'allow'; } catch { return 'allow'; } })();
  const ok = dec === 'allow';
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  [fail-open] ${JSON.stringify(garbage).slice(0, 40)}`);
}

const w = await watchdogCase();
const wOk = w.terminated && w.out.includes('"deny"');
if (!wOk) failed++;
console.log(
  `${wOk ? 'ok  ' : 'FAIL'}  [watchdog] stdin held open → terminated=${w.terminated}, denied=${w.out.includes('"deny"')}`,
);

if (failed) {
  console.error(`\ngit-compound-guard selftest FAILED: ${failed} case(s)`);
  process.exit(1);
}
console.log('\ngit-compound-guard selftest PASSED — both directions observed');
