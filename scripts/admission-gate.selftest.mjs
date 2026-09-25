#!/usr/bin/env node
// ============================================================================
// Selftest for the admission gate. "A Brake nobody has watched fail is a Brake
// nobody knows is connected" (scripts/review-gate.mjs).
//
// Both halves are pinned. A gate that blocks honest work is a defect (ADR-0052),
// and an ADMISSION gate with that flaw is the worst kind: it turns "specify your
// issue" into "guess my magic heading", which is what the first draft did — it
// demanded a literal "Acceptance criteria" heading and matched ZERO of this
// repo's 36 real issues. The vocabulary below is the one the corpus actually
// uses, and the honest-work cases are drawn from real issue shapes.
//
// Per brain gotcha 1af189641750, "observed red" is a floor: every check here is
// written so that DELETING its detector makes it fail. Verify that when editing.
//
//   node scripts/admission-gate.selftest.mjs
// ============================================================================
import { admit, repoProbes, repoRoot, main } from './admission-gate.mjs';

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}${ok ? '' : ` — wanted ${want}, got ${got}`}`);
};

// A repo where src/, test/, scripts/ and two decisions exist.
const REAL = new Set(['src', 'src/engine.ts', 'test', 'test/a.test.ts', 'scripts', 'docs/adr/ADR-0075-the-software-factory.md']);
const probes = {
  has: (p) => REAL.has(p),
  find: (d) => (d === 'ADR-0075' ? 'docs/adr/ADR-0075-the-software-factory.md' : null),
};
const ok = (body) => admit(body, probes).ok;
const why = (body) => admit(body, probes).problems.join(' | ');

const FULL = `Some context about the bug.

## Acceptance criteria
- [ ] \`src/engine.ts\` stops throwing on an empty brain

## Surfaces
- \`src/engine.ts\`
- \`test/a.test.ts\`

Governing: \`ADR-0075\`
`;

console.log('--- a complete issue is dispatchable ---');
check('the full shape passes', ok(FULL), true);

console.log('\n--- each requirement is INDEPENDENTLY load-bearing ---');
check('drop the criteria section → refused', ok(FULL.replace(/## Acceptance criteria\n- \[ \].*\n/, '')), false);
check('drop the surfaces → refused', ok('## Acceptance criteria\n- [ ] it works\n\nGoverning: `ADR-0075`\n'), false);
check('drop the governing decision → refused', ok(FULL.replace('Governing: `ADR-0075`', '')), false);
check('empty criteria section → refused', ok(FULL.replace('- [ ] `src/engine.ts` stops throwing on an empty brain', '')), false);

console.log('\n--- existence is VERIFIED, not assumed (the authoritative half) ---');
check('a surface whose DIRECTORY does not exist → refused', ok(FULL.replace('src/engine.ts', 'src/nowhere/deep.ts')), false);
check('...and the message names the path', why(FULL.replace('src/engine.ts', 'src/nowhere/deep.ts')).includes('src/nowhere/deep.ts'), true);
check('a file that does not exist YET but whose dir does → allowed', ok(FULL.replace('src/engine.ts', 'src/brand-new.ts')), true);
check('a cited ADR that does not exist → refused', ok(FULL.replace('ADR-0075', 'ADR-9999')), false);
check('...and the message names it', why(FULL.replace('ADR-0075', 'ADR-9999')).includes('ADR-9999'), true);
check('a full ADR path that exists → accepted', ok(FULL.replace('`ADR-0075`', '`docs/adr/ADR-0075-the-software-factory.md`')), true);

console.log('\n--- the heading vocabulary THIS REPO uses (first draft matched none of it) ---');
const withHeading = (h) => `## ${h}\n- rewrite the thing\n\nTouches \`src/engine.ts\`. Governing \`ADR-0075\`.\n`;
for (const h of ['Acceptance criteria', 'Done when', 'Definition of done', 'Requirements', 'Suggested fix', 'Proposed fix', 'Fix shape', 'What would resolve it', 'The property to assert', 'Scope']) {
  check(`"${h}" is recognised`, ok(withHeading(h)), true);
}
check('a heading with no items under it → refused', ok('## Suggested fix\n\n## Something else\n\n`src/engine.ts` `ADR-0075`\n'), false);

console.log('\n--- checkable items in the forms people write them ---');
for (const [label, item] of [['task box', '- [ ] do the thing'], ['ticked box', '- [x] done already'], ['bullet', '- do the thing'], ['star bullet', '* do the thing'], ['numbered', '1. do the thing']]) {
  check(`${label} counts as checkable`, ok(`## Requirements\n${item}\n\n\`src/engine.ts\` \`ADR-0075\`\n`), true);
}

console.log('\n--- honest issue shapes must not be blocked ---');
check('surfaces mentioned in prose rather than a list', ok('## Suggested fix\n- guard it\n\nThe change is in `src/engine.ts`, per `ADR-0075`.\n'), true);
check('a directory named instead of a file', ok('## Requirements\n- add a Brake\n\nTouches `scripts/` per `ADR-0075`.\n'), true);
check('multiple decisions cited, one real', ok('## Requirements\n- x\n\n`src/engine.ts`, per `ADR-0075` and `RFC-999`.\n'), true);
check('a body with no markdown headings at all → refused (not crashed)', ok('just do the thing in src/engine.ts'), false);
check('an empty body → refused, not crashed', ok(''), false);
check('a null body → refused, not crashed', ok(null), false);

check('a surface named in a blob permalink is seen', ok('## Requirements\n- x\n\nhttps://github.com/vilosource/vfkb/blob/main/src/engine.ts\n\nADR-0075\n'), true);

console.log('\n--- the refusal is ACTIONABLE, which is the point ---');
check('a bare issue names all three missing things', admit('help', probes).problems.length === 3, true);
check('...and says what to add, not just what is wrong', why('help').includes('Add a section headed'), true);

console.log('\n--- ONLY VISIBLE TEXT COUNTS (round-1 B1) ---');
// An issue whose visible body was "Please fix the thing" was admitted because a
// nine-line HTML comment carried all three requirements. That is the
// source-text-guard class ADR-0070 §1 bans, and reviews/README.md's own worked
// example of a blocking finding.
const HIDDEN = 'Please fix the thing. It is broken.\n';
const PAYLOAD = '## Requirements\n- [ ] x\n\n`src/engine.ts`\n\nADR-0075\n';
check('requirements buried in an HTML comment do NOT admit', ok(`${HIDDEN}\n<!--\n${PAYLOAD}-->\n`), false);
check('an UNCLOSED HTML comment does not admit either', ok(`${HIDDEN}\n<!--\n${PAYLOAD}`), false);
check('requirements inside a fenced code block do NOT admit', ok(`${HIDDEN}\n\`\`\`\n${PAYLOAD}\`\`\`\n`), false);
check('a tilde-fenced block does not admit', ok(`${HIDDEN}\n~~~\n${PAYLOAD}~~~\n`), false);
check('an UNCLOSED fence does not admit', ok(`${HIDDEN}\n\`\`\`\n${PAYLOAD}`), false);
// <details> is FOLDED, not hidden — a reader can open it, and this repo's issues
// use it for legitimate detail. Kept on purpose, and pinned so the choice is visible.
check('a collapsed <details> DOES admit — folded is not hidden', ok(`${HIDDEN}\n<details><summary>detail</summary>\n\n${PAYLOAD}</details>\n`), true);
check('a fence inside the criteria section does not erase the section', ok('## Requirements\n- [ ] x\n\n```\nsome sample output\n```\n\n`src/engine.ts` `ADR-0075`\n'), true);

console.log('\n--- CRITERIA MAY BE PROSE, AND EVERY HEADING IS SCANNED (round-1 B2) ---');
// All 6 "empty section" refusals on the real corpus were false: the sections were
// prose or blockquotes. Demanding a bullet was the magic-word anti-pattern the
// header warns about, one level down.
check('a prose criteria section is enough', ok('## Suggested fix\n\nTighten the predicate so doctor exits non-zero when the hook is missing.\n\n`src/engine.ts` `ADR-0075`\n'), true);
check('a blockquote criteria section is enough', ok('## The property to assert\n\n> Every declared field carries its own `.catch()`.\n\n`src/engine.ts` `ADR-0075`\n'), true);
// #306's exact shape: a blockquote under the FIRST matching heading and bullets
// under a LATER one. first-heading-wins refused the best-specified issue in the corpus.
check('#306 shape: content under a LATER matching heading counts', ok('## Scope\n\n## Requirements\n\n- [ ] make it stop throwing\n\n`src/engine.ts` `ADR-0075`\n'), true);
check('a heading followed only by another heading is still refused', ok('## Suggested fix\n\n## Not in scope\n\n`src/engine.ts` `ADR-0075`\n'), false);
check('...and the message no longer calls a full section "empty"', !why('## Suggested fix\n\n## Not in scope\n\n`src/engine.ts` `ADR-0075`\n').includes('is empty'), true);

console.log('\n--- A SURFACE IS INSIDE THE REPOSITORY (round-1 M5) ---');
check('.. climbing out of the repo is refused', ok('## Requirements\n- x\n\n`src/../../../../../../etc/passwd`\n\nADR-0075\n'), false);
check('...and the message says it climbs out', why('## Requirements\n- x\n\n`src/../../../.ssh`\n\nADR-0075\n').includes('climb out of it'), true);
check('a legitimate path containing dots is fine', ok('## Requirements\n- x\n\n`src/engine.ts`\n\nADR-0075\n'), true);

console.log('\n--- A CITED DECISION IS THE ONE THAT EXISTS (round-1 M4, m3) ---');
// Against the REAL repo, not the stub: with `\d{3,4}` and an unanchored
// startsWith, `ADR-007` resolved to ADR-0070 and the gate admitted the issue
// while printing a decision it never cited (round-1 M4). A stub that only knows
// ADR-0075 would answer null either way, so the pin has to use real probes.
check('ADR-007 does not resolve to a real ADR (3 digits are not a citation)', admit('## Requirements\n- x\n\n`src/engine.ts`\n\nADR-007\n', repoProbes()).ok, false);
check('...and a full 4-digit citation still resolves', admit('## Requirements\n- x\n\n`src/engine.ts`\n\nADR-0070\n', repoProbes()).ok, true);
check('lowercase adr-0075 is recognised', ok('## Requirements\n- x\n\n`src/engine.ts`\n\nPer adr-0075.\n'), true);

console.log('\n--- THE REAL DRIVER, NOT JUST admit() (round-1 M1/M2/M3) ---');
// repoProbes/main/the gh call were executed by nothing, which is what hid M2.
// Driven here the way CI does, with gh behind a PATH shim — the sibling gate's
// pattern (reproduction-gate.selftest.mjs).
const shim = mkdtempSync(join(tmpdir(), 'adm-gh-'));
// The shim answers only `gh issue view <n> --json body`, and answers in the
// shape the gate parses — JSON with a `body` field. Anything else exits 2, so a
// gate that asked for the wrong thing is observed rather than silently passing.
writeFileSync(join(shim, 'gh'), '#!/bin/sh\n[ "$1" = issue ] && [ "$2" = view ] && [ "$4" = --json ] || { echo "shim: unexpected: $*" >&2; exit 2; }\ncat "$ADM_FAKE_BODY"\n');
chmodSync(join(shim, 'gh'), 0o755);
const bodyFile = join(shim, 'body.md');
const runMain = (argv, env = {}) => {
  const prevPath = process.env.PATH, prevBody = process.env.ADM_FAKE_BODY;
  process.env.PATH = `${shim}:${prevPath}`; process.env.ADM_FAKE_BODY = bodyFile;
  Object.assign(process.env, env);
  const q = console.log, qe = console.error; const lines = [];
  console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  let code; try { code = main(argv); } finally { console.log = q; console.error = qe; process.env.PATH = prevPath; if (prevBody === undefined) delete process.env.ADM_FAKE_BODY; else process.env.ADM_FAKE_BODY = prevBody; }
  return { code, out: lines.join('\n') };
};
writeFileSync(bodyFile, JSON.stringify({ body: PAYLOAD }));
const viaGh = runMain(['42']);
check('main() reads an issue through gh on PATH and admits a good one', viaGh.code === 0 && /PASSED — dispatchable/.test(viaGh.out), true);
writeFileSync(bodyFile, JSON.stringify({ body: 'help' }));
const viaGhBad = runMain(['42']);
check('...and refuses a bare one, exit 1', viaGhBad.code === 1 && /NOT DISPATCHABLE/.test(viaGhBad.out), true);
check('main() with no argument is a usage error, exit 2', runMain([]).code === 2, true);

// M2: the gate must work from any cwd, because its consumer polls from its own.
// The root comes from the SCRIPT's location, so this holds even outside the repo.
const root = repoRoot();
check('repoRoot() finds this repository', existsSync(join(root, 'scripts/admission-gate.mjs')), true);
const here = process.cwd();
try {
  process.chdir(tmpdir());
  const pr = repoProbes();
  check('repoProbes resolves real paths from an unrelated cwd', pr.has('src/engine.ts'), true);
  check('...and resolves a real decision from there too', pr.find('ADR-0075') !== null, true);
  check('...and still says no to a path that does not exist', pr.has('src/definitely-not-here.ts'), false);
  writeFileSync(bodyFile, JSON.stringify({ body: PAYLOAD }));
  check('main() admits from an unrelated cwd (it refused everything before)', runMain(['42']).code === 0, true);
} finally { process.chdir(here); }
check('find() will not accept a truncated decision number', repoProbes().find('ADR-007'), null);
rmSync(shim, { recursive: true, force: true });

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nadmission-gate selftest passed (the Brake is connected, and it does not block honest work).');
