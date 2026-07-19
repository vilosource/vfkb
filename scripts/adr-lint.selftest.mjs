#!/usr/bin/env node
// ============================================================================
// Selftest for the ADR lint. "A Brake nobody has watched fail is a Brake nobody
// knows is connected" (scripts/review-gate.mjs).
//
// Both directions matter equally here, and the SECOND is the one that nearly
// went wrong: a first cut of this lint flagged 8 ADRs, of which only 3 were real
// defects. ADR-0050 DEFINES the phrase "built, NOT yet verified"; ADR-0043 says
// "nothing is built speculatively" as policy. A gate that blocks honest work is
// a defect, not caution — so the false-positive cases below are pinned as hard
// as the true-positive ones, using the real prose that tripped it.
//
//   node scripts/adr-lint.selftest.mjs
// ============================================================================
import { lintAdr, lintAll } from './adr-lint.mjs';

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}${ok ? '' : ` — expected ${want ? 'a finding' : 'silence'}, got ${got ? 'a finding' : 'silence'}`}`);
};
const flags = (md) => lintAdr(md, 'test.md').length > 0;

// ---- MUST flag: the three shapes actually observed in the repo -------------
check(
  'a "Status honesty" section (ADR-0064/0065 shape)',
  flags('# ADR-0099\n\n## Status honesty (ADR-0050/0051)\n\nSomething.\n'),
  true,
);
check(
  'the self-referential verdict "Decided, NOT yet built"',
  flags('# ADR-0099\n\nThis is **Decided, NOT yet built.** and will rot.\n'),
  true,
);
check('an "Implementation status" section', flags('# ADR-0099\n\n## Implementation status\n\nHalf done.\n'), true);
check('a "Current status" section', flags('# ADR-0099\n\n### Current status\n\nShipping soon.\n'), true);

// ---- MUST NOT flag: the legitimate prose the first cut wrongly caught ------
// Verbatim from the real corpus. If any of these regress, the lint is blocking
// honest authorship, which is a worse defect than the one it prevents.
check(
  'ADR-0050 DEFINING the phrase (not asserting its own state)',
  flags('the only honest status is \'built, NOT yet verified\'."*\n'),
  false,
);
check('ADR-0043 policy prose "nothing is built speculatively"', flags('- The design exists when the evidence arrives; nothing is built speculatively.\n'), false);
check('ADR-0015 sequencing prose "before … rendering is built"', flags('before ADR-0006/0008 rendering is built.\n'), false);
check('ADR-0048 meta prose "does not claim the replacement is built"', flags('retires a stale gate; it does not claim the replacement is built.\n'), false);
check('ADR-0012 architectural prose "is built behind the same pipeline"', flags('**Stage 1 candidate-narrowing is built behind the same pipeline** but is a\n'), false);

// ---- MUST NOT flag: the recommended REPLACEMENT shape ----------------------
check(
  'the pointer shape this lint tells authors to use',
  flags('# ADR-0099\n\n## Build status — tracked in [#176](https://example/176), not here\n\nSee the issue.\n'),
  false,
);
check(
  'a maintainer correction note quoting the removed claim (blockquote)',
  flags('> This section previously asserted *"Decided, NOT yet built."* That became false.\n'),
  false,
);

// ---- The real corpus must be clean, and that is a regression guard ---------
const corpus = lintAll();
check(`the committed ADR corpus is clean (${corpus.length} finding(s))`, corpus.length > 0, false);
if (corpus.length) corpus.forEach((f) => console.log(`      ${f}`));

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nadr-lint selftest passed (the Brake is connected, and it does not block honest prose).');
