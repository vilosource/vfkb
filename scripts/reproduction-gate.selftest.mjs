#!/usr/bin/env node
// ============================================================================
// Selftest for reproduction-gate. "A Brake nobody has watched fail is a Brake
// nobody knows is connected" (scripts/review-gate.mjs).
//
// IT DRIVES A REAL GIT REPO through main(), the way CI does: a fixture with a
// `pretest` build step and tests that import the BUILT output, so the gate is
// exercised against the same shape this repo has (tests resolving dist/). Both
// directions are pinned — a fix that proves its bug PASSES, a fix that cannot
// FAILS — and so is every honest shape that must NOT be blocked, because a gate
// that blocks honest work teaches people to route around it (ADR-0052).
//
// Each pin below names the mutation of reproduction-gate.mjs it was observed
// red under, in the review record's `mutations` (ADR-0070 §2).
//
//   node scripts/reproduction-gate.selftest.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './reproduction-gate.mjs';

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}${ok ? '' : ` — wanted ${want}, got ${got}`}`);
};

// ---------------------------------------------------------------- real repo --
const repo = mkdtempSync(join(tmpdir(), 'repro-self-'));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const put = (p, body) => { mkdirSync(join(repo, p, '..'), { recursive: true }); writeFileSync(join(repo, p), body); };

try { symlinkSync(join(process.cwd(), 'node_modules'), join(repo, 'node_modules'), 'dir'); } catch { /* already there */ }
writeFileSync(join(repo, '.gitignore'), 'node_modules\ndist\n');
git('init', '-q');
git('config', 'user.email', 'a@b'); git('config', 'user.name', 't');
// The "old" tree: a greeting with a bug (should say hello), built into dist/ by
// pretest — exactly this repo's shape, where tests resolve ../dist/*.
put('src/greet.js', "export const greet = (n) => 'hi ' + n;\n");
put('build.mjs', "import { mkdirSync, readdirSync, copyFileSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\nfor (const f of readdirSync('src')) copyFileSync('src/' + f, 'dist/' + f);\n");
put('test/greet.test.ts', "import { it, expect } from 'vitest';\nimport { greet } from '../dist/greet.js';\nit('mentions the name', () => { expect(greet('bob')).toContain('bob'); });\n");
// An honest pre-existing red at the base: a fix that merely TOUCHES this file
// must not be proven by a failure that was already there.
put('test/broken.test.ts', "import { it, expect } from 'vitest';\nit('already broken at the base', () => { expect(1).toBe(2); });\n");
put('package.json', '{\n  "name": "t", "type": "module",\n  "scripts": { "pretest": "node build.mjs", "test": "vitest run" }\n}\n');
git('add', '-A'); git('commit', '-q', '-m', 'chore: base');
const BASE = git('rev-parse', 'HEAD').trim();

let lastOutput = '';
/** Apply a change, commit it under `subject`, run the REAL gate end to end, restore. */
function gate(mutate, subject = 'fix: something', env = {}) {
  mutate();
  git('add', '-A');
  git('commit', '-q', '-m', subject, '--allow-empty');
  const quiet = console.log, qerr = console.error;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  let code;
  try { code = main(['--repo', repo, '--base', BASE, '--head', 'HEAD'], { ...process.env, ...env }); }
  finally { console.log = quiet; console.error = qerr; }
  git('reset', '-q', '--hard', BASE);
  lastOutput = lines.join('\n');
  return code === 0 ? 'PASS' : 'BLOCK';
}
const fixSrc = () => put('src/greet.js', "export const greet = (n) => 'hello ' + n;\n");
const redTest = () => put('test/hello.test.ts', "import { it, expect } from 'vitest';\nimport { greet } from '../dist/greet.js';\nit('says hello', () => { expect(greet('bob')).toBe('hello bob'); });\n");
const greenTest = () => put('test/more.test.ts', "import { it, expect } from 'vitest';\nimport { greet } from '../dist/greet.js';\nit('still mentions the name', () => { expect(greet('ann')).toContain('ann'); });\n");

console.log('--- A FIX THAT PROVES ITS BUG (want PASS) ---');
check('fix: src changed + a new test that is red at the base', gate(() => { fixSrc(); redTest(); }), 'PASS');
check('  …and the replay saw a BUILT base: no file failed to load', /0 file\(s\) could not load/.test(lastOutput), true);
check('fix: only an EXPECTATION changed in an existing test, no new it()', gate(() => { fixSrc(); put('test/greet.test.ts', "import { it, expect } from 'vitest';\nimport { greet } from '../dist/greet.js';\nit('mentions the name', () => { expect(greet('bob')).toBe('hello bob'); });\n"); }) === 'PASS' && /PASSED — 1 test/.test(lastOutput), true);

console.log('\n--- A FIX THAT CANNOT PROVE ITS BUG (want BLOCK) ---');
check('fix: src changed + a new test that already passes at the base', gate(() => { fixSrc(); greenTest(); }), 'BLOCK');
check('  …and the message says the tests already pass, and offers NO waiver', /ALREADY PASSES/.test(lastOutput) && /THERE IS NO WAIVER/.test(lastOutput) && !/Reproduction-Waiver/.test(lastOutput), true);
check('fix: a pre-existing red in a touched test file is NOT proof', gate(() => { fixSrc(); put('test/broken.test.ts', "import { it, expect } from 'vitest';\nit('already broken at the base', () => { expect(1).toBe(2); });\nit('a new passing test', () => { expect(2).toBe(2); });\n"); }), 'BLOCK');
check('fix: new test file imports a module the fix ADDED — a link failure is not a red test', gate(() => { put('src/shout.js', "export const shout = (n) => n.toUpperCase();\n"); put('test/shout.test.ts', "import { it, expect } from 'vitest';\nimport { shout } from '../dist/shout.js';\nit('shouts', () => { expect(shout('a')).toBe('A'); });\n"); }), 'BLOCK');
check('  …and the message says the reproduction must target the OLD surface, not PASSED', /tests can run against the tree that had the bug/.test(lastOutput) && !/PASSED/.test(lastOutput), true);
check('fix: a Reproduction-Waiver trailer changes nothing', gate(() => { fixSrc(); greenTest(); }, 'fix: tidy\n\nReproduction-Waiver: coverage only'), 'BLOCK');

console.log('\n--- THE TRIGGER IS THE CLAIM, NOT THE DIFF (honest non-fix work: want PASS, and say why) ---');
check('refactor: src changed + tests that pass at the base is not a fix and is skipped', gate(() => { fixSrc(); greenTest(); }, 'refactor: rename'), 'PASS');
check('  …and the log names the claim', /SKIPPED \(claim: refactor\)/.test(lastOutput), true);
check('feat: same shape, skipped', gate(() => { fixSrc(); greenTest(); }, 'feat: shiny'), 'PASS');
check('fix: with NO test change is skipped loudly (the review record must explain)', gate(() => { fixSrc(); }), 'PASS');
check('  …loudly', /adds or changes NO test/.test(lastOutput) && /mutationsNote/.test(lastOutput), true);
check('fix: touching no src/ (docs only) is skipped', gate(() => { put('README.md', 'fixed a typo\n'); }, 'fix: typo'), 'PASS');

console.log('\n--- THE ISSUE LABEL IS AUTHORITATIVE (through a `gh` on PATH, the way CI resolves it) ---');
const shim = mkdtempSync(join(tmpdir(), 'repro-gh-'));
writeFileSync(join(shim, 'gh'), '#!/bin/sh\n[ "${GH_FAKE_EXIT:-0}" = 0 ] || exit "$GH_FAKE_EXIT"\nprintf "%s\\n" "$GH_FAKE_LABELS" | tr "," "\\n"\n');
chmodSync(join(shim, 'gh'), 0o755);
const withGh = (labels, exit = 0) => ({ PATH: `${shim}:${process.env.PATH}`, GH_FAKE_LABELS: labels, GH_FAKE_EXIT: String(exit) });
check('refactor: subject, but Closes #7 and #7 is labelled bug → armed, and blocks a non-red test', gate(() => { fixSrc(); greenTest(); }, 'refactor: tidy\n\nCloses #7', withGh('bug')), 'BLOCK');
check('  …and the log credits the issue label', /issue #7 \(commit message\) is labelled bug/.test(lastOutput), true);
check('refactor: subject, Closes #7, #7 is an enhancement → not a fix, skipped', gate(() => { fixSrc(); greenTest(); }, 'refactor: tidy\n\nCloses #7', withGh('enhancement')), 'PASS');
check('the issue lookup failing falls back to the commit type and SAYS so', gate(() => { fixSrc(); greenTest(); }, 'refactor: tidy\n\nCloses #7', withGh('', 1)), 'PASS');
check('  …', /lookup unavailable/.test(lastOutput), true);
check('the issue from the PR body counts too', gate(() => { fixSrc(); greenTest(); }, 'refactor: tidy', { ...withGh('bug'), PR_BODY: 'Fixes #9' }), 'BLOCK');
rmSync(shim, { recursive: true, force: true });

console.log('\n--- fails CLOSED, never open ---');
// The replay runs the BASE tree's own scripts, so a broken runner or build must
// live at the base: a second base commit on top of the first, discarded after.
function gateFromBrokenBase(breakBase, mutate) {
  breakBase();
  git('add', '-A'); git('commit', '-q', '-m', 'chore: broken base');
  const base2 = git('rev-parse', 'HEAD').trim();
  mutate();
  git('add', '-A'); git('commit', '-q', '-m', 'fix: something');
  const quiet = console.log, qerr = console.error;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  let code;
  try { code = main(['--repo', repo, '--base', base2, '--head', 'HEAD'], { ...process.env }); }
  finally { console.log = quiet; console.error = qerr; }
  git('reset', '-q', '--hard', BASE);
  lastOutput = lines.join('\n');
  return code === 0 ? 'PASS' : 'BLOCK';
}
check('a runner that produces no report is INCONCLUSIVE and exits 1, not PASSED', gateFromBrokenBase(() => put('package.json', '{\n  "name": "t", "type": "module",\n  "scripts": { "pretest": "node build.mjs", "test": "vitest run --reporter=bogus" }\n}\n'), () => { fixSrc(); redTest(); }), 'BLOCK');
check('  …', /INCONCLUSIVE/.test(lastOutput) && !/PASSED/.test(lastOutput), true);
check('a base that cannot BUILD is INCONCLUSIVE, not proof', gateFromBrokenBase(() => put('build.mjs', "throw new Error('base build broken');\n"), () => { fixSrc(); redTest(); }), 'BLOCK');
check('  …', /INCONCLUSIVE/.test(lastOutput) && !/PASSED/.test(lastOutput), true);
const quietRun = (argv) => { const q = console.error, l = console.log; console.error = () => {}; console.log = () => {}; try { return main(argv); } finally { console.error = q; console.log = l; } };
check('an unresolvable base refuses to give a verdict', quietRun(['--repo', repo, '--base', 'no-such-ref', '--head', 'HEAD']) !== 0, true);
check('base === head refuses (the vacuous-check trap)', quietRun(['--repo', repo, '--base', BASE, '--head', BASE]) !== 0, true);

rmSync(repo, { recursive: true, force: true });
if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nreproduction-gate selftest passed (the Brake is connected, and it does not block honest work).');
