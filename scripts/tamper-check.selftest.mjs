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
import { collectTests, workflowSteps, isNeutered, main } from './tamper-check.mjs';

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
put('package.json', '{\n  "name": "t", "type": "module",\n  "scripts": { "test": "vitest run" }\n}\n');
put('.github/workflows/test.yml', 'jobs:\n  t:\n    steps:\n      - run: npm test\n');
git('add', '-A'); git('commit', '-q', '-m', 'base');
const BASE = git('rev-parse', 'HEAD').trim();

/** Apply a tamper, run the REAL gate end to end, restore. */
function gate(mutate, message = 'change') {
  mutate();
  git('add', '-A');
  git('commit', '-q', '-m', message, '--allow-empty');
  const quiet = console.log, qerr = console.error;
  console.log = () => {}; console.error = () => {};
  let code;
  try { code = main(['--repo', repo, '--base', BASE, '--head', 'HEAD']); }
  finally { console.log = quiet; console.error = qerr; }
  git('reset', '-q', '--hard', BASE);
  return code === 0 ? 'PASS' : 'BLOCK';
}
const edit = (p, fn) => () => put(p, fn(git('show', `HEAD:${p}`)));
const wf = (body) => () => put('.github/workflows/test.yml', body);
const W = 'tidy\n\nTamper-Waiver: stated reason';

console.log('--- ATTACKS: each of these defeated a previous version (want BLOCK) ---');
check('git rm a test file', gate(() => git('rm', '-q', 'test/b.test.ts')), 'BLOCK');
check('rename a test file OUT of the test paths', gate(() => { mkdirSync(join(repo, 'h'), { recursive: true }); git('mv', 'test/b.test.ts', 'h/b.ts'); }), 'BLOCK');
check('it.concurrent.skip — leaked through the WAIVER before', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it.concurrent.skip('adds'"))), 'BLOCK');
check("it['skip'] — same leak", gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it['skip']('adds'"))), 'BLOCK');
check('it.skipIf(true)', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it.skipIf(true)('adds'"))), 'BLOCK');
check("it['only'] — the bracket form ONLY missed", gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it['only']('adds'"))), 'BLOCK');
check('the test script replaced with `echo ok`', gate(() => put('package.json', '{\n  "scripts": { "test": "echo ok" }\n}\n')), 'BLOCK');
check('the test step deleted from the workflow', gate(wf('jobs:\n  t:\n    steps:\n      - run: echo hi\n')), 'BLOCK');
check('continue-on-error AFTER run: — the shape this repo uses', gate(wf('jobs:\n  t:\n    steps:\n      - run: npm test\n        continue-on-error: true\n')), 'BLOCK');
check('if: false AFTER run:', gate(wf('jobs:\n  t:\n    steps:\n      - run: npm test\n        if: false\n')), 'BLOCK');
check('`pnpm run test || echo skipped` — any || swallows it', gate(wf('jobs:\n  t:\n    steps:\n      - run: pnpm run test || echo skipped\n')), 'BLOCK');
check('`set +e` above the test command (step-scoped)', gate(wf('jobs:\n  t:\n    steps:\n      - run: |\n          set +e\n          npm test\n')), 'BLOCK');
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
check('renaming and skipping in one change stays unwaivable', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it.skip('renamed adds'")), W), 'BLOCK');
check('skipping generated it.each names stays unwaivable', gate(edit('test/a.test.ts', (t) => t.replace('it.each([1, 2])', 'it.skip.each([1, 2])')), W), 'BLOCK');
check('skipping a generated template-literal name stays unwaivable', gate(edit('test/a.test.ts', (t) => t.replace('it(`template ${suffix}`', 'it.skip(`template ${suffix}`')), W), 'BLOCK');

for (const [label, command] of [
  ['-t test-name narrowing', 'vitest run -t "no such test name anywhere"'],
  ['positional file narrowing', 'vitest run test/b.test.ts'],
  ['--exclude narrowing', 'vitest run --exclude "test/**"'],
  ['--project narrowing', 'vitest run --project nope'],
]) {
  check(label, gate(() => put('package.json', `{\n  "name": "t", "type": "module",\n  "scripts": { "test": ${JSON.stringify(command)} }\n}\n`), W), 'BLOCK');
}

console.log('\n--- THE WAIVER WAIVES WHAT IT SAYS IT WAIVES ---');
check('a waiver does NOT excuse an added skip', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it.concurrent.skip('adds'")), W), 'BLOCK');
check('a waiver does NOT excuse `echo ok`', gate(() => put('package.json', '{\n  "scripts": { "test": "echo ok" }\n}\n'), W), 'BLOCK');
check('a waiver does NOT excuse killing the only test step', gate(wf('jobs:\n  t:\n    steps:\n      - run: echo hi\n'), W), 'BLOCK');
check('a waiver DOES excuse deleting an obsolete test', gate(() => git('rm', '-q', 'test/b.test.ts'), W), 'PASS');

console.log('\n--- HONEST WORK (want PASS) — blocking this is a defect, ADR-0052 ---');
check('adding tests', gate(() => put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts') + "it('n', () => { expect(3).toBe(1+2); });\n")), 'PASS');
check('renaming a test TITLE in place', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it('adds two numbers'"))), 'PASS');
check('moving a test between two test files', gate(() => { put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts').replace(/^.*it\('subs'.*$\n/m, '')); put('test/b.test.ts', git('show', 'HEAD:test/b.test.ts') + "it('subs', () => { expect(2-1).toBe(1); });\n"); }), 'PASS');
check('the test script gaining --coverage', gate(() => put('package.json', '{\n  "scripts": { "test": "vitest run --coverage" }\n}\n')), 'PASS');
check('`npm ci || npm install` above npm test in one step', gate(wf('jobs:\n  t:\n    steps:\n      - run: |\n          npm ci || npm install\n          npm test\n')), 'PASS');
check('an OPTIONAL non-test step carrying || true', gate(wf('jobs:\n  t:\n    steps:\n      - run: npm test\n      - run: node drift.mjs || true\n')), 'PASS');
check('a report-only step gaining continue-on-error', gate(wf('jobs:\n  t:\n    steps:\n      - run: npm test\n      - continue-on-error: true\n        run: node drift.mjs\n')), 'PASS');
check('adding a whole new test file', gate(() => put('test/c.test.ts', "import { it, expect } from 'vitest';\nit('eps', () => { expect(5).toBe(2+3); });\n")), 'PASS');
check('renaming a test TITLE to something unrelated', gate(edit('test/a.test.ts', (t) => t.replace("it('adds'", "it('completely different'"))), 'PASS');
check('a docs-only change', gate(() => put('README.md', 'hi\n')), 'PASS');
check('THIS Brake quoted as test data in a file', gate(() => put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts') + 'const s = "it.skip(\'x\')";\n')), 'PASS');
check('deleting a test while explaining its old name in a comment is waivable', gate(() => put('test/a.test.ts', git('show', 'HEAD:test/a.test.ts').replace(/^.*it\('adds'.*$\n/m, '// removed: adds — superseded by the property test\n')), W), 'PASS');
check('renaming generated it.each cases without disabling them', gate(edit('test/a.test.ts', (t) => t.replace("'case %s'", "'value %s works'"))), 'PASS');
check('changing a generated template-literal name without disabling it', gate(edit('test/a.test.ts', (t) => t.replaceAll("'literal'", "'renamed'"))), 'PASS');
check('an honest non-narrowing Vitest flag still passes', gate(() => put('package.json', '{\n  "name": "t", "type": "module",\n  "scripts": { "test": "vitest run --reporter=dot" }\n}\n')), 'PASS');

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

console.log('\n--- unit level (what is left after the scanner was deleted) ---');
check('workflowSteps: a guard BELOW run: is seen', workflowSteps('jobs:\n t:\n  steps:\n   - run: npm test\n     continue-on-error: true\n', 'w')[0]?.guarded === true, true);
check("workflowSteps: an adjacent step's guard does NOT bleed", workflowSteps('jobs:\n t:\n  steps:\n   - continue-on-error: true\n     run: node x.mjs\n   - run: npm test\n', 'w')[0]?.guarded === false, true);
check('isNeutered: any || on a test command', isNeutered('npm test || echo skipped'), true);
check('isNeutered: set +e is step-scoped', isNeutered('set +e\nnpm test'), true);
check('isNeutered: an optional non-test command is not', isNeutered('node drift.mjs || true'), false);
check('isNeutered: npm ci || npm install above npm test is not', isNeutered('npm ci || npm install\nnpm test'), false);

rmSync(repo, { recursive: true, force: true });
if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\ntamper-check selftest passed (the Brake is connected, and it does not block honest work).');
