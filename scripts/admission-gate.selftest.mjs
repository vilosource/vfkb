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
import { admit } from './admission-gate.mjs';

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

console.log('\n--- the refusal is ACTIONABLE, which is the point ---');
check('a bare issue names all three missing things', admit('help', probes).problems.length === 3, true);
check('...and says what to add, not just what is wrong', why('help').includes('Add a section headed'), true);

if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log('\nadmission-gate selftest passed (the Brake is connected, and it does not block honest work).');
