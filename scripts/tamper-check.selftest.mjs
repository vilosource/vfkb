#!/usr/bin/env node
// ============================================================================
// Selftest for tamper-check. "A Brake nobody has watched fail is a Brake nobody
// knows is connected" (scripts/review-gate.mjs).
//
// IT DRIVES A REAL GIT REPO, not hand-built inventories. Round 2 of the review
// found the previous selftest imported only `countTests` and `compare` and
// never touched `inventory()`, `commandSurface()` or `main()` — so it validated
// the comparator's arithmetic while ALL FIVE blocking defeats lived in the half
// it never ran. A selftest that exercises the working half is the same defect
// class the Brake exists to catch, one level up.
//
// Every attack below DEFEATED a previous version. They are pinned so the next
// person can see exactly which shapes are load-bearing, and the honest-work half
// is pinned just as hard: a tamper detector that blocks honest work teaches
// people to route around the gate, and the routing-around is invisible.
//
//   node scripts/tamper-check.selftest.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, collectTests, compare } from './tamper-check.mjs';

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}${ok ? '' : ` — wanted ${want}, got ${got}`}`);
};

// ---------------------------------------------------------------- real repo --
const repo = mkdtempSync(join(tmpdir(), 'tamper-self-'));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const put = (p, body) => { mkdirSync(join(repo, p, '..'), { recursive: true }); writeFileSync(join(repo, p), body); };

// `vitest list` needs the deps; borrow this checkout's.
try { symlinkSync(join(process.cwd(), 'node_modules'), join(repo, 'node_modules'), 'dir'); } catch { /* already there */ }
writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
git('init', '-q');
git('config', 'user.email', 'a@b'); git('config', 'user.name', 't');
put('test/a.test.ts', "import { it, expect } from 'vitest';\nconst suffix = 'literal';\nit('adds', () => { expect(1+1).toBe(2); });\nit('subs', () => { expect(2-1).toBe(1); });\nit.each([1, 2])('case %s', (n) => { expect(n).toBe(n); });\nit(`template ${suffix}`, () => { expect(suffix).toBe('literal'); });\n");
put('test/b.test.ts', "import { it, expect } from 'vitest';\nit('mul', () => { expect(2*2).toBe(4); });\n");
// Round 6 B2: the previous gate ran bare `vitest run` in a worktree with no
// build output, so this repo's dist-resolving tests failed at BOTH refs and the
// equal counts cancelled. The fixture now has a `pretest` build and a test that
// only passes once it has run — the honest arm below asserts `0 → 0 failed`.
put('build.mjs', "import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\nwriteFileSync('dist/x.js', 'export const x = 1;\\n');\n");
put('test/built.test.ts', "import { it, expect } from 'vitest';\nit('needs the build output', async () => { const m = await import('../dist/x.js'); expect(m.x).toBe(1); });\n");
// A pre-existing, honest static skip at the BASE. Two arms rest on it: a
// `git mv` of this file must not report the old skip as newly disabled (round 6
// M1), and turning it into a failure must not buy a runtime-skip credit (D3).
put('test/legacy.test.ts', "import { it, expect } from 'vitest';\nit.skip('old skip', () => { expect(1).toBe(2); });\nit('still live', () => { expect(1).toBe(1); });\n");
put('package.json', '{\n  "name": "t", "type": "module",\n  "scripts": { "pretest": "node build.mjs", "test": "vitest run" }\n}\n');
writeFileSync(join(repo, '.gitignore'), 'node_modules\ndist\n');
put('.github/workflows/test.yml', 'jobs:\n  t:\n    steps:\n      - run: npm test\n');
git('add', '-A'); git('commit', '-q', '-m', 'base');
const BASE = git('rev-parse', 'HEAD').trim();

/** Apply a tamper, run the REAL gate end to end, restore. */
function gate(mutate, message = 'change') {
  mutate();
  git('add', '-A');
  git('commit', '-q', '-m', message, '--allow-empty');
  const quiet = console.log, qerr = console.error;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  let code;
  try { code = main(['--repo', repo, '--base', BASE, '--head', 'HEAD']); }
  finally { console.log = quiet; console.error = qerr; }
  git('reset', '-q', '--hard', BASE);
  lastOutput = lines.join('\n');
  return code === 0 ? 'PASS' : 'BLOCK';
}
let lastOutput = '';
const edit = (p, fn) => () => put(p, fn(git('show', `HEAD:${p}`)));
const wf = (body) => () => put('.github/workflows/test.yml', body);

console.log('--- ATTACKS: each of these defeated a previous version (want BLOCK) ---');
check('git rm a test file', gate(() => git('rm', '-q', 'test/b.test.ts')), 'BLOCK');
check('it.concurrent.skip — leaked through the WAIVER before', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it.concurrent.skip('adds'"))), 'BLOCK');
check("it['skip'] — same leak", gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it['skip']('adds'"))), 'BLOCK');
check('it.skipIf(true)', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it.skipIf(true)('adds'"))), 'BLOCK');
check("it['only'] — the bracket form ONLY missed", gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it['only']('adds'"))), 'BLOCK');
check('tests commented out wholesale', gate(() => put('test/a.test.ts', "import { it } from 'vitest';\n/*\nit('adds', () => {});\nit('subs', () => {});\n*/\n")), 'BLOCK');
check('a skip hidden behind a regex containing a quote (killed 3 scanners)', gate(() => put('test/a.test.ts', ["import { it, expect } from 'vitest';", "const Q = /['" + '"' + "]/;", "it.skip('adds', () => {});", "it('subs', () => { expect(1).toBe(1+0); });"].join('\n'))), 'BLOCK');
check('a vitest.config exclusion (every count unchanged)', gate(() => put('vitest.config.ts', "export default { test: { exclude: ['test/b.test.ts'] } };\n")), 'BLOCK');
check('count-neutral swap: delete a real file, add junk tests', gate(() => { git('rm', '-q', 'test/b.test.ts'); put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts') + "it('junk', () => { expect(1).toBe(1+0); });\n"); }), 'BLOCK');
check('it.todo', gate(edit('test/a.test.ts', (t) => t.replace(/it\('adds'.*/, "it.todo('adds');"))), 'BLOCK');
check('a split-line .skip', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it\n  .skip('adds"))), 'BLOCK');
check('skip plus same-file junk cannot hide behind a held count', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it.skip('adds'") + "it('junk', () => { expect(1).toBe(1); });\n")), 'BLOCK');
check('a same-name decoy in another file cannot hide the skipped original', gate(() => {
  put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts').replace("it('adds'", "it.skip('adds'"));
  put('test/c.test.ts', "import { it, expect } from 'vitest';\nit('adds', () => expect(1).toBe(1));\n");
}), 'BLOCK');
check('renaming and skipping in one change stays unwaivable', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it.skip('renamed adds'"))), 'BLOCK');
check('skipping generated it.each names stays unwaivable', gate(edit('test/a.test.ts', (t) => t.replace('it.each([1, 2])', 'it.skip.each([1, 2])'))), 'BLOCK');
check('skipping a generated template-literal name stays unwaivable', gate(edit('test/a.test.ts', (t) => t.replace('it(`template ${suffix}`', 'it.skip(`template ${suffix}`'))), 'BLOCK');

for (const [label, command] of [
  ['-t test-name narrowing', 'vitest run -t "no such test name anywhere"'],
  ['positional file narrowing', 'vitest run test/b.test.ts'],
  ['--exclude narrowing', 'vitest run --exclude "test/**"'],
  ['--project narrowing', 'vitest run --project nope'],
]) {
  check(label, gate(() => put('package.json', `{\n  "name": "t", "type": "module",\n  "scripts": { "test": ${JSON.stringify(command)} }\n}\n`)), 'BLOCK');
}

console.log('\n--- THE WAIVER WAIVES WHAT IT SAYS IT WAIVES ---');

console.log('\n--- HONEST WORK (want PASS) — blocking this is a defect, ADR-0052 ---');
check('adding tests', gate(() => put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts') + "it('n', () => { expect(3).toBe(1+2); });\n")), 'PASS');
check('renaming a test TITLE in place', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it('adds two numbers'"))), 'PASS');
check('moving a test file to a different collected path', gate(() => { mkdirSync(join(repo, 'test/unit'), { recursive: true }); git('mv', 'test/b.test.ts', 'test/unit/b.test.ts'); }), 'PASS');
check('moving a test between two test files', gate(() => { put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts').replace(/^.*it\('subs'.*$\n/m, '')); put('test/b.test.ts', git('show', 'HEAD:test/b.test.ts') + "it('subs', () => { expect(2-1).toBe(1); });\n"); }), 'PASS');
check('adding a whole new test file', gate(() => put('test/c.test.ts', "import { it, expect } from 'vitest';\nit('eps', () => { expect(5).toBe(2+3); });\n")), 'PASS');
check('renaming a test TITLE to something unrelated', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it('completely different'"))), 'PASS');
check('a docs-only change', gate(() => put('README.md', 'hi\n')), 'PASS');
check('THIS Brake quoted as test data in a file', gate(() => put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts') + 'const s = "it.skip(\'x\')";\n')), 'PASS');
// With the trailer waiver gone, an honest deletion blocks too — and that is the
// accepted cost. There is NO waiver this script reads (round 6 B1 found one
// advertised that nothing enforced): the escape is an operator bypassing the
// required check under their own GitHub name, which an agent cannot do.
check('deleting a test while explaining its old name in a comment still blocks — the only escape is an operator bypass', gate(() => put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts').replace(/^.*it\('adds'.*$\n/m, '// removed: adds — superseded by the property test\n'))), 'BLOCK');
check('renaming generated it.each cases without disabling them', gate(edit('test/a.test.ts', (t) => t.replace("'case %s'", "'value %s works'"))), 'PASS');
check('changing a generated template-literal name without disabling it', gate(edit('test/a.test.ts', (t) => t.replaceAll("'literal'", "'renamed'"))), 'PASS');

// Round 6 M1: round 5 dropped the rename wiring, and a `git mv` of a file that
// already carried a skip at the base reported that skip as newly disabled.
check('moving a test file that already had an honest skip at the base', gate(() => { mkdirSync(join(repo, 'test/unit'), { recursive: true }); git('mv', 'test/legacy.test.ts', 'test/unit/legacy.test.ts'); }), 'PASS');

console.log('\n--- the run OBSERVES a built suite (round 6 B2) ---');
// If the gate skipped the project's `pretest`, `built.test.ts` would fail at
// both refs, the counts would cancel, and this would still PASS — so the pin
// is a content assertion over the gate's own stats line, not the exit code.
check('a docs-only change runs the built suite: nothing failed at either ref', gate(() => put('README.md', 'built\n')) === 'PASS' && /0 → 0 failed/.test(lastOutput), true);
check('flipping an assertion is reported as a FAILURE, not as fewer tests ran', gate(edit('test/b.test.ts', (t) => t.replace('toBe(4)', 'toBe(5)'))) === 'BLOCK' && /more-tests-failed/.test(lastOutput) && !/fewer-tests-ran/.test(lastOutput), true);
// The round-6 defeat, in miniature: turn a base skip into a failure (skipped −1,
// failed +1), spend the credit on a runtime skip of a real test (skipped +1,
// passed −1), add junk to hold `passed`. Only the `failed` column moves.
check('a base skip turned into a failure cannot buy a runtime-skip credit', gate(() => {
  put('test/legacy.test.ts', git('show', 'HEAD:test/legacy.test.ts').replace("it.skip('old skip', () => { expect(1).toBe(2); });", "it('old skip', () => { expect(1).toBe(2); });"));
  put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts').replace("it('adds', () => {", "it('adds', (ctx) => { ctx.skip();") + "it('junk', () => { expect(1).toBe(1); });\n");
}), 'BLOCK');

console.log('\n--- RUNTIME skips: what collection structurally cannot see ---');
// Round 5's B1: a two-line setupFiles change silenced the ENTIRE suite while a
// collection-only gate printed "the suite was not weakened". vitest LISTS a test
// that calls ctx.skip() at runtime, so only an actual run sees this family.
check('a setupFile beforeEach ctx.skip() that kills the whole suite', gate(() => { put('vitest-setup.ts', "import { beforeEach } from 'vitest';\nbeforeEach((ctx) => { ctx.skip(); });\n"); put('vitest.config.ts', "export default { test: { setupFiles: ['./vitest-setup.ts'] } };\n"); }), 'BLOCK');
check('a single runtime ctx.skip()', gate(edit('test/a.test.ts', (t) => t.replace("it('adds', () => {", "it('adds', (ctx) => { ctx.skip();"))), 'BLOCK');

console.log('\n--- there is NO trailer waiver: nothing launders ---');
// The Tamper-Waiver trailer leaked in FOUR consecutive review rounds by four
// different routes, because free text is writable by whoever is being checked.
// The escape is an operator bypassing the check under their own name.
check('the block message does not advertise a waiver this script cannot honour', !/review record/i.test(lastOutput) && /operator/.test(lastOutput), true);
check('deleting a test file, with the old trailer present, still blocks', gate(() => git('rm', '-q', 'test/b.test.ts'), 'tidy\n\nTamper-Waiver: obsolete'), 'BLOCK');
check('deleting ALL tests, with the old trailer, still blocks', gate(() => git('rm', '-q', '-r', 'test'), 'tidy\n\nTamper-Waiver: obsolete'), 'BLOCK');

console.log('\n--- fails CLOSED, never open ---');
check('an unresolvable base refuses to give a verdict', (() => { const q = console.error; console.error = () => {}; const c = main(['--repo', repo, '--base', 'no-such-ref', '--head', 'HEAD']); console.error = q; return c; })() !== 0, true);
check('base === head refuses (the vacuous-check trap)', (() => { const q = console.error; console.error = () => {}; const c = main(['--repo', repo, '--base', BASE, '--head', BASE]); console.error = q; return c; })() !== 0, true);

const noDeps = mkdtempSync(join(tmpdir(), 'tamper-nodeps-'));
execFileSync('git', ['-C', noDeps, 'init', '-q']);
execFileSync('git', ['-C', noDeps, 'config', 'user.email', 'a@b']);
execFileSync('git', ['-C', noDeps, 'config', 'user.name', 't']);
writeFileSync(join(noDeps, 'package.json'), '{"scripts":{"test":"vitest run"}}\n');
writeFileSync(join(noDeps, 'a.test.ts'), "import { it } from 'vitest'; it('x', () => {});\n");
execFileSync('git', ['-C', noDeps, 'add', '-A']);
execFileSync('git', ['-C', noDeps, 'commit', '-q', '-m', 'base']);
const missingDeps = collectTests(noDeps, 'HEAD');
check('collection without node_modules fails loudly with installation guidance', !missingDeps.ok && missingDeps.detail.includes('npm ci'), true);
rmSync(noDeps, { recursive: true, force: true });
check('review-gate installs dependencies before the tamper selftest', /npm ci[\s\S]*tamper-check\.selftest/.test(readFileSync(join(process.cwd(), '.github/workflows/review-gate.yml'), 'utf8')), true);

console.log('\n--- SEVERAL TASKS AT ONE LOCATION (review finding B1), end to end ---');
// `describe.each` puts `group 1 > inner` and `group 2 > inner` at ONE line and
// column. A `-t` narrowing silences one of them while the SIBLING keeps that
// location occupied, and the run channel is paid for the round-6 way: un-skip a
// base skip to buy the credit, add a junk test to hold the per-file count.
//
// The first version of the vitest-5 fix answered PASS here, because it treated a
// location as runnable if the list held ANY row there. The pre-fix engine named
// the silenced task out loud. So this arm pins the DETECTION, not the fix, and it
// gets its own fixture repo because the shared one above cannot express a `-t`
// that enumerates every surviving name.
//
// The predicate is a CONTENT assertion over the output, not the exit code: the
// failure mode here presents as a successful run that simply lacks the finding.
const repo2 = mkdtempSync(join(tmpdir(), 'tamper-self-loc-'));
{
  const g2 = (...a) => execFileSync('git', ['-C', repo2, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const put2 = (f, body) => { mkdirSync(join(repo2, f, '..'), { recursive: true }); writeFileSync(join(repo2, f), body); };
  try { symlinkSync(join(process.cwd(), 'node_modules'), join(repo2, 'node_modules'), 'dir'); } catch { /* already there */ }
  writeFileSync(join(repo2, '.gitignore'), 'node_modules\n');
  g2('init', '-q'); g2('config', 'user.email', 'a@b'); g2('config', 'user.name', 't');
  put2('test/a.test.ts', "import { describe, it, expect } from 'vitest';\ndescribe.each([1, 2])('group %s', (g) => { it('inner', () => { expect(g).toBe(g); }); });\nit('kept', () => { expect(1).toBe(1); });\n");
  put2('test/legacy.test.ts', "import { it, expect } from 'vitest';\nit.skip('old skip', () => { expect(1).toBe(1); });\n");
  put2('package.json', '{\n  "name": "t2", "type": "module",\n  "scripts": { "test": "vitest run" }\n}\n');
  g2('add', '-A'); g2('commit', '-q', '-m', 'base');
  const BASE2 = g2('rev-parse', 'HEAD').trim();
  put2('test/a.test.ts', g2('show', 'HEAD:test/a.test.ts') + "it('junk', () => { expect(1).toBe(1); });\n");
  put2('test/legacy.test.ts', "import { it, expect } from 'vitest';\nit('old skip', () => { expect(1).toBe(1); });\n");
  put2('package.json', '{\n  "name": "t2", "type": "module",\n  "scripts": { "test": "vitest run -t \\"group 1|kept|junk|old skip\\"" }\n}\n');
  g2('add', '-A'); g2('commit', '-q', '-m', 'silence one of two tasks sharing a location');
  const quiet = console.log, qerr = console.error, lines = [];
  console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  let code;
  try { code = main(['--repo', repo2, '--base', BASE2, '--head', 'HEAD']); }
  finally { console.log = quiet; console.error = qerr; }
  const out = lines.join('\n');
  check('a task silenced while a SIBLING holds its location is still caught (B1)',
    code !== 0 && /tests-disabled/.test(out) && /group 2 > inner/.test(out), true);
}
rmSync(repo2, { recursive: true, force: true });

console.log('\n--- unit level (what is left after the scanner was deleted) ---');

// THE TWO OBSERVATION CHANNELS DISAGREE ON GENERATED NAMES under vitest 5:
// `vitest list` reports an `it.each` block ONCE under its uninterpolated source
// pattern, while the collect-only task graph reports one task per generated case.
// Reconciling them by COUNTING NAMES scored every generated task as
// declared-but-not-runnable, which turned an honest `it.each` rename into a
// BLOCK (observed on the vitest 5 bump, PR #329).
//
// The two real-repo arms above only observe this when the installed vitest IS 5,
// so the shape is ALSO pinned here as DATA. This arm fails on any vitest, which
// is the point: it is the can-fail pin that survives a downgrade of the runner.
const chan = (rows) => {
  const m = new Map(), seen = new Map();
  for (const r of rows) {
    const id = `${r.file}::${r.name}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    m.set(`${id}::${n}`, r);
  }
  return m;
};
const inv = (list, declared) => ({
  collected: { ok: true, tests: chan(list), declared: chan(declared) },
  run: { ok: true, total: 0, passed: 0, failed: 0, skipped: 0 },
});
const at = (line, column = 1) => ({ line, column });
const F = 'test/a.test.ts';
const v5Base = inv(
  [{ file: F, name: 'case %s', location: at(4, 16) }],
  [{ file: F, name: 'case 1', mode: 'run', location: at(4, 16) }, { file: F, name: 'case 2', mode: 'run', location: at(4, 16) }],
);
const v5Renamed = inv(
  [{ file: F, name: 'value %s works', location: at(4, 16) }],
  [{ file: F, name: 'value 1 works', mode: 'run', location: at(4, 16) }, { file: F, name: 'value 2 works', mode: 'run', location: at(4, 16) }],
);
const v5Skipped = inv(
  [],
  [{ file: F, name: 'case 1', mode: 'skip', location: at(4, 16) }, { file: F, name: 'case 2', mode: 'skip', location: at(4, 16) }],
);
check('channels disagreeing on generated names reconcile by location: an it.each rename is not a weakening',
  compare(v5Base, v5Renamed).findings.length, 0);
check('the same disagreement still catches a SKIPPED it.each block',
  compare(v5Base, v5Skipped).findings.some((f) => f.kind === 'tests-disabled'), true);
// A task without a location must degrade to name reconciliation, not to silence.
// REVIEW FINDING B1, as DATA: several DIFFERENTLY-NAMED tasks share ONE location
// (`describe.each` puts both at 2:48). Presence at a location is therefore NOT
// evidence that a particular task there runs. The live arm above only catches a
// regression to pure presence while the installed vitest is 4 — on vitest 5 the
// uninterpolated row drops entirely under `-t`, so it would block anyway. This arm
// fails on ANY runner, which is what makes it the load-bearing pin.
const sameLocBase = inv(
  [{ file: F, name: 'group 1 > inner', location: at(2, 48) }, { file: F, name: 'group 2 > inner', location: at(2, 48) }],
  [{ file: F, name: 'group 1 > inner', mode: 'run', location: at(2, 48) }, { file: F, name: 'group 2 > inner', mode: 'run', location: at(2, 48) }],
);
const sameLocFiltered = inv(
  [{ file: F, name: 'group 1 > inner', location: at(2, 48) }],
  [{ file: F, name: 'group 1 > inner', mode: 'run', location: at(2, 48) }, { file: F, name: 'group 2 > inner', mode: 'run', location: at(2, 48) }],
);
check('a sibling at the SAME location cannot vouch for a filtered-out task (B1)',
  compare(sameLocBase, sameLocFiltered).findings.some((f) => f.kind === 'tests-disabled'), true);
// A regression pin for the no-location FALLBACK, not a pin of this fix: it is green
// both with and without the location join, and no configuration was found in which
// Vitest omits a location (both channels force `includeTaskLocation`, and disabling
// it makes collection fail closed). Kept because it is cheap; not claimed as
// observed-red in the review record.
check('a declared task with no location still reports as disabled when the list lacks its name',
  compare(inv([{ file: F, name: 'adds' }], [{ file: F, name: 'adds', mode: 'run' }]),
          inv([], [{ file: F, name: 'adds', mode: 'skip' }])).findings.some((f) => f.kind === 'tests-disabled'), true);

rmSync(repo, { recursive: true, force: true });
if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\ntamper-check selftest passed (the Brake is connected, and it does not block honest work).');
