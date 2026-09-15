#!/usr/bin/env node
// ============================================================================
// Selftest for tamper-check. "A Brake nobody has watched fail is a Brake nobody
// knows is connected" (scripts/review-gate.mjs).
//
// EVERY ATTACK BELOW DEFEATED THE FIRST VERSION OF THIS BRAKE. Adversarial
// review ran 33 tampers against a line-matching implementation and 21 got
// through, including `git rm` on a test file — the FIRST thing RFC-039 D8 names
// — which printed "0 changed file(s) … PASSED". They are pinned here so the
// rewrite cannot regress to that, and so the next person to touch this file can
// see exactly which shapes are load-bearing.
//
// The FALSE-POSITIVE half is pinned as hard as the true-positive half. A tamper
// detector that blocks honest work is worse than none: it teaches people to
// route around the gate, and the routing-around is invisible. One case here —
// "a normal test with a computed expectation" — was BLOCKED by the rewrite's
// own first draft, because the tautology check only looked at the left-hand
// side. That is the most common honest action there is.
//
//   node scripts/tamper-check.selftest.mjs
// ============================================================================
import { countTests, compare, isTestFile, isCommandFile } from './tamper-check.mjs';

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}${ok ? '' : ` — expected ${want ? 'a finding' : 'silence'}, got ${got ? 'a finding' : 'silence'}`}`);
};

/** Minimal inventories: what the gate compares. */
const inv = ({ live = 2, skipped = 0, files = 2, steps = [{ file: 'w.yml', body: 'npm test', guarded: false }], npmTest = 'vitest run' } = {}) =>
  ({ files, live, skipped, byFile: {}, cmd: { npmTest, steps } });
const lines = (file, ...ls) => ls.map((line) => ({ file, line }));
const hard = (before, after, added = []) => compare(before, after, added).hard.length > 0;
const soft = (before, after, added = []) => compare(before, after, added).soft.length > 0;
const any = (before, after, added = []) => hard(before, after, added) || soft(before, after, added);

console.log('--- the review defeats: weakenings a LINE matcher cannot see ---');
check('a deleted test file (git rm — printed "0 changed file(s) … PASSED")', soft(inv({ live: 3, files: 2 }), inv({ live: 1, files: 1 })), true);
check('a test file renamed OUT of the test paths', soft(inv({ live: 3, files: 2 }), inv({ live: 1, files: 1 })), true);
check('the package.json test script replaced with `echo ok`', any(inv(), inv({ npmTest: 'echo ok' })), true);
check('the test step deleted from a workflow', any(inv(), inv({ steps: [] })), true);
check('`if:` / `continue-on-error:` added to the TEST step', hard(inv(), inv({ steps: [{ file: 'w.yml', body: 'npm test', guarded: true }] })), true);
check('the test command neutered with `|| true`', hard(inv(), inv({ steps: [{ file: 'w.yml', body: 'npm test || true', guarded: false }] })), true);

console.log('\n--- skip aliases: the spellings that leaked through the WAIVER ---');
const skipped = (src) => countTests(src).skipped > 0;
check('it.skip(', skipped("it.skip('a', () => {});"), true);
check('it.concurrent.skip( — leaked to the waivable count before', skipped("it.concurrent.skip('a', () => {});"), true);
check("it['skip']( — same leak", skipped("it['skip']('a', () => {});"), true);
check('it.skipIf(true)(', skipped("it.skipIf(true)('a', () => {});"), true);
check('it.runIf(false)(', skipped("it.runIf(false)('a', () => {});"), true);
check('xit(', skipped("xit('a', () => {});"), true);
check('it.todo(', skipped("it.todo('a');"), true);
check('describe.skip(', skipped("describe.skip('a', () => {});"), true);
check('an apostrophe in a comment does NOT hide a skip', skipped("/* can't be right */ it.skip('a', () => {});"), true);

console.log('\n--- the waiver is scoped, and the scoping is COMPUTED not claimed ---');
const withSkip = () => compare(inv({ skipped: 0 }), inv({ skipped: 1 }));
check('an added skip is a HARD finding (never waivable)', withSkip().hard.length > 0, true);
check('...and never appears among the waivable ones', withSkip().soft.length > 0, false);
check('a neutered command is HARD', compare(inv(), inv({ steps: [{ file: 'w.yml', body: 'npm test || true', guarded: false }] })).hard.length > 0, true);
check('removing tests is SOFT (waivable — deleting an obsolete test is honest)', compare(inv({ live: 3 }), inv({ live: 1 })).soft.length > 0, true);
check('...and removing tests alone raises nothing hard', compare(inv({ live: 3 }), inv({ live: 1 })).hard.length > 0, false);

console.log('\n--- MUST NOT flag: honest work ---');
check('a normal test with a computed expectation (BLOCKED by the first draft)', hard(inv(), inv(), lines('test/a.test.ts', "  expect(1).toBe(1 + 0);")), false);
check('expect(1).toBe(arr.length)', hard(inv(), inv(), lines('test/a.test.ts', '  expect(1).toBe(arr.length);')), false);
check('expect(x).toBeDefined() — a real assertion, already used on main', hard(inv(), inv(), lines('test/a.test.ts', '  expect(result).toBeDefined();')), false);
check('expect(x).toBeTruthy() on a variable', hard(inv(), inv(), lines('test/a.test.ts', '  expect(result).toBeTruthy();')), false);
check('an OPTIONAL non-test step carrying `|| true`', hard(inv(), inv({ steps: [{ file: 'w.yml', body: 'npm test', guarded: false }] }), lines('.github/workflows/w.yml', '        run: node scripts/drift.mjs || true')), false);
check('a report-only step gaining continue-on-error (not a test step)', hard(inv(), inv()), false);
check('moving a test between two test files (net live count unchanged)', any(inv({ live: 3 }), inv({ live: 3 })), false);
check('renaming a test in place', any(inv({ live: 3 }), inv({ live: 3 })), false);
check('adding tests (the normal case)', any(inv({ live: 2 }), inv({ live: 5 })), false);
check('a commented-out example of the bad shape', hard(inv(), inv(), lines('test/a.test.ts', "  // it.skip('example', () => {")), false);
check('the bad shape quoted as TEST DATA is counted, but only as a skip the file really has', countTests("const s = \"it.skip('x')\";").skipped > 0, true);

console.log('\n--- MUST flag: the line-level shapes ---');
check('.only added', hard(inv(), inv(), lines('test/a.test.ts', "  it.only('just this', () => {")), true);
check('expect(true).toBe(true)', hard(inv(), inv(), lines('test/a.test.ts', '  expect(true).toBe(true);')), true);
check('expect(true).toBeTruthy()', hard(inv(), inv(), lines('test/a.test.ts', '  expect(true).toBeTruthy();')), true);
check('expect([]).toEqual([])', hard(inv(), inv(), lines('test/a.test.ts', '  expect([]).toEqual([]);')), true);
check('expect(x).toBe(x)', hard(inv(), inv(), lines('test/a.test.ts', '  expect(res).toBe(res);')), true);
check('assert.ok(1)', hard(inv(), inv(), lines('test/a.test.ts', '  assert.ok(1);')), true);
check('expect.assertions(0)', hard(inv(), inv(), lines('test/a.test.ts', '  expect.assertions(0);')), true);
check('an EMPTY test body (keeps the count, asserts nothing)', hard(inv(), inv(), lines('test/a.test.ts', "  it('x', () => {});")), true);

console.log('\n--- structural ---');
check('path classification: test/', isTestFile('test/a.test.ts'), true);
check('path classification: scenarios/', isTestFile('scenarios/l4.mjs'), true);
check('path classification: src/ is not a test path', isTestFile('src/engine.ts'), false);
check('command files are workflows and package.json ONLY (not every .mjs)', isCommandFile('scripts/x.selftest.mjs'), false);
check('...package.json is one', isCommandFile('package.json'), true);
check('countTests separates live from skipped', countTests("it('a',()=>{});\nit.skip('b',()=>{});").live === 1, true);
check('an identical inventory raises nothing', any(inv(), inv()), false);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\ntamper-check selftest passed (the Brake is connected, and it does not block honest work).');
