#!/usr/bin/env node
// ============================================================================
// Selftest for tamper-check. "A Brake nobody has watched fail is a Brake nobody
// knows is connected" (scripts/review-gate.mjs).
//
// The FALSE-POSITIVE half is pinned as hard as the true-positive half, and it
// uses real shapes from this repo. A tamper detector that blocks honest work
// would be worse than none: it teaches people to route around the gate, and the
// routing-around is invisible. Several cases below are lifted from changes that
// actually landed here — a parameterised test file, a `continue-on-error` drift
// check, a commented-out example — precisely because those are what a naive
// implementation flags.
//
//   node scripts/tamper-check.selftest.mjs
// ============================================================================
import { scanDiff, parseDiff, isTestPath, isCommandPath } from './tamper-check.mjs';

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}${ok ? '' : ` — expected ${want ? 'a finding' : 'silence'}, got ${got ? 'a finding' : 'silence'}`}`);
};
/** Build a minimal unified diff for one file. */
const diff = (file, added = [], removed = []) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,0 +1,0 @@\n` +
  removed.map((l) => `-${l}`).join('\n') + (removed.length ? '\n' : '') +
  added.map((l) => `+${l}`).join('\n') + '\n';
const flags = (d, opts) => scanDiff(d, opts).length > 0;
const kinds = (d, opts) => scanDiff(d, opts).map((f) => f.kind).sort();

console.log('--- MUST flag: the shortcuts that buy a green run ---');
check('a skipped test added', flags(diff('test/a.test.ts', ["  it.skip('does the thing', () => {"])), true);
check('an xit added', flags(diff('test/a.test.ts', ["  xit('does the thing', () => {"])), true);
check('an it.todo added', flags(diff('test/a.test.ts', ["  it.todo('later');"])), true);
check('an .only added (skips every other test silently)', flags(diff('test/a.test.ts', ["  it.only('just this', () => {"])), true);
check('`|| true` on a test command in a workflow', flags(diff('.github/workflows/test.yml', ['        run: npm test || true'])), true);
check('`|| exit 0` on a test command', flags(diff('.github/workflows/test.yml', ['        run: npx vitest run || exit 0'])), true);
check('--passWithNoTests added', flags(diff('package.json', ['    "test": "vitest run --passWithNoTests",'])), true);
check('expect(true).toBe(true)', flags(diff('test/a.test.ts', ['    expect(true).toBe(true);'])), true);
check('expect(x).toBe(x) — same symbol both sides', flags(diff('test/a.test.ts', ['    expect(result).toBe(result);'])), true);
check('expect(1).toBe(1)', flags(diff('test/a.test.ts', ['    expect(1).toBe(1);'])), true);
check('a net test removal with no waiver', flags(diff('test/a.test.ts', [], ["  it('a', () => {});", "  it('b', () => {});"])), true);

console.log('\n--- MUST NOT flag: honest work (a gate that blocks it is a defect) ---');
check(
  'a PARAMETERISED test file: fewer literal it( but more coverage (the real shape of test/catch-blast-radius.test.ts)',
  flags(diff('test/a.test.ts', ['  for (const c of CASES) it(`${c.name}`, () => {});'], ["  it('one', () => {});"])),
  false,
);
check('`.skip` that ALREADY existed in an untouched region (removed lines are not implicating)', flags(diff('test/a.test.ts', ['  // unrelated tidy'], ["  it.skip('old', () => {});"])), false);
check('a COMMENTED-OUT example of the bad shape (docs about the gate)', flags(diff('test/a.test.ts', ["  // it.skip('example of what this Brake catches', () => {"])), false);
check('`continue-on-error: true` on a REPORT-ONLY step (engine-delivery.yml shape)', flags(diff('.github/workflows/engine-delivery.yml', ['        continue-on-error: true'])), false);
check('`|| true` on a non-command line in prose', flags(diff('docs/NOTES.md', ['Use `npm test || true` when you want to ignore failures.'])), false);
check('expect(a).toBe(b) — genuinely different operands', flags(diff('test/a.test.ts', ['    expect(actual).toBe(expected);'])), false);
check('expect(e.validity.valid_from).toBe(\'2020-03-03\') — a real assertion', flags(diff('test/a.test.ts', ["    expect(e.validity.valid_from).toBe('2020-03-03');"])), false);
check('a test RENAME: removals and additions balance', flags(diff('test/a.test.ts', ["  it('renamed', () => {});"], ["  it('old name', () => {});"])), false);
check('net test removal WITH a Tamper-Waiver trailer', flags(diff('test/a.test.ts', [], ["  it('a', () => {});"]), { waiver: 'the feature was deleted in #303' }), false);
check('adding tests (the normal case)', flags(diff('test/a.test.ts', ["  it('new', () => {});", "  it('another', () => {});"])), false);
check('a skip added OUTSIDE a test path (source file)', flags(diff('src/engine.ts', ['  const x = arr.skip(1);'])), false);

console.log('\n--- the waiver is scoped, not a blanket pardon ---');
check(
  'a Tamper-Waiver does NOT excuse an added .skip',
  flags(diff('test/a.test.ts', ["  it.skip('nope', () => {});"]), { waiver: 'I said so' }),
  true,
);

console.log('\n--- structural: the scanner actually parses ---');
check('parseDiff finds the file', parseDiff(diff('test/a.test.ts', ['x'])).length === 1, true);
check('an EMPTY diff yields no findings (and no crash)', flags(''), false);
check('path classification: test/', isTestPath('test/a.test.ts'), true);
check('path classification: scenarios/', isTestPath('scenarios/l4.mjs'), true);
check('path classification: src/ is not a test path', isTestPath('src/engine.ts'), false);
check('path classification: workflows are command paths', isCommandPath('.github/workflows/test.yml'), true);

// A scanner that matches nothing and reports green is the ADR-0051 §3
// quiet-success trap. Assert the detectors are actually wired, not just present.
const allKinds = kinds(
  diff('test/a.test.ts', ["  it.skip('s', () => {});", '    expect(true).toBe(true);']) +
  diff('.github/workflows/test.yml', ['        run: npm test || true']),
);
check(`every detector fires at least once (${allKinds.join(',') || 'NONE'})`, allKinds.length >= 3, true);

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\ntamper-check selftest passed (the Brake is connected, and it does not block honest work).');
