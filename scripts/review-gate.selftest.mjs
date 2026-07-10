#!/usr/bin/env node
// ============================================================================
// Negative checks for the review gate (ADR-0029: a proof that cannot fail
// proves nothing). A Brake nobody has watched fail is a Brake nobody knows is
// connected.
//
// Each case drives runReviewGate() with one thing broken and asserts it reports
// it. Green baselines are included so the reds are not vacuous. Written after
// nine rounds of adversarial review on the plugin's release gate taught the
// author that a guard shaped to miss its own bug reads as coverage — so each
// guard here is checked by reverting its own rule (see `npm run review-gate:selftest`
// notes in ADR-0052).
//
//   node scripts/review-gate.selftest.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runReviewGate, deriveVerdict, isImplementation, candidateShas } from './review-gate.mjs';

const SHA = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

const record = (over = {}) => ({
  recordVersion: 1,
  sha: SHA,
  governing: ['docs/adr/ADR-0052-review-gate.md'],
  reviewer: { agent: 'general-purpose', model: 'opus', rounds: 2 },
  findings: [{ id: 'F1', severity: 'major', status: 'fixed', summary: 'x' }],
  verdict: 'MERGE',
  ...over,
});

const ctx = (over = {}) => ({
  changedFiles: ['src/doctor.ts'],
  candidates: [SHA],
  readRecord: (s) => (s === SHA ? record() : undefined),
  docExists: () => true,
  ...over,
});

const CASES = [
  // ---- green baselines: without these, every red below is vacuous ----
  { name: 'baseline — implementation change with a valid MERGE record', expect: null, ctx: () => ctx() },
  {
    name: 'docs-only change needs no review',
    expect: null,
    ctx: () => ctx({ changedFiles: ['docs/adr/ADR-0052.md', 'CLAUDE.md', '.vfkb/entries.jsonl'], readRecord: () => undefined }),
  },
  {
    name: 'a review record itself needs no review (reviews/ is exempt)',
    expect: null,
    ctx: () => ctx({ changedFiles: ['reviews/abc.json'], readRecord: () => undefined }),
  },
  {
    name: 'zero findings is allowed when the record says what it ruled out',
    expect: null,
    ctx: () => ctx({ readRecord: () => record({ findings: [], ruledOut: ['race conditions', 'the proof can fail'] }) }),
  },
  {
    name: 'a BLOCKING finding may be waived by a named human, on the record',
    expect: null,
    ctx: () => ctx({ readRecord: () => record({ findings: [{ id: 'F1', severity: 'blocking', status: 'accepted', acceptedBy: 'operator', summary: 'x' }] }) }),
  },

  // ---- the rule itself ----
  {
    name: 'implementation changed and NO review record exists',
    expect: /\[review\].*carries no review record/s,
    ctx: () => ctx({ readRecord: () => undefined }),
  },
  {
    name: 'record exists but is filed against a different sha',
    expect: /\[review\].*record says sha .* but it is filed as/s,
    ctx: () => ctx({ readRecord: () => record({ sha: OLD }) }),
  },
  {
    name: 'a .github workflow change counts as implementation',
    expect: /\[review\].*carries no review record/s,
    ctx: () => ctx({ changedFiles: ['.github/workflows/x.yml'], readRecord: () => undefined }),
  },
  {
    name: 'a .claude/commands change counts as implementation',
    expect: /\[review\].*carries no review record/s,
    ctx: () => ctx({ changedFiles: ['.claude/commands/review.md'], readRecord: () => undefined }),
  },

  // ---- the verdict is recomputed, never read ----
  {
    name: 'record asserts MERGE while carrying an unresolved BLOCKING finding',
    expect: /\[review\].*asserts verdict "MERGE" but its findings derive FIX-FIRST/s,
    ctx: () => ctx({ readRecord: () => record({ findings: [{ id: 'F1', severity: 'blocking', status: 'open', summary: 'x' }] }) }),
  },
  {
    name: 'an honest FIX-FIRST verdict blocks the merge',
    expect: /\[review\].*verdict is FIX-FIRST: fix the blocking findings/s,
    ctx: () => ctx({ readRecord: () => record({ verdict: 'FIX-FIRST', findings: [{ id: 'F1', severity: 'blocking', status: 'open', summary: 'x' }] }) }),
  },
  {
    // The mismatch check must bite in BOTH directions, or it only catches the
    // lie that flatters the author.
    name: 'record asserts FIX-FIRST while its findings derive MERGE',
    expect: /\[review\].*asserts verdict "FIX-FIRST" but its findings derive MERGE/s,
    ctx: () => ctx({ readRecord: () => record({ verdict: 'FIX-FIRST' }) }),
  },
  {
    name: 'a REDESIGN verdict blocks the merge',
    expect: /\[review\].*asserts verdict "REDESIGN"/s,
    ctx: () => ctx({ readRecord: () => record({ verdict: 'REDESIGN' }) }),
  },
  {
    name: 'a BLOCKING finding waived with no `acceptedBy`',
    expect: /\[review\].*waives a BLOCKING finding with no `acceptedBy`/s,
    ctx: () => ctx({ readRecord: () => record({ findings: [{ id: 'F1', severity: 'blocking', status: 'accepted', summary: 'x' }] }) }),
  },

  // ---- the record must be evidence, not testimony ----
  {
    name: '"no findings" without saying what was ruled out',
    expect: /\[review\].*does not say what it checked and ruled out/s,
    ctx: () => ctx({ readRecord: () => record({ findings: [] }) }),
  },
  {
    name: 'findingsCount does not match the findings array',
    expect: /\[review\].*claims findingsCount 3 but carries 1/s,
    ctx: () => ctx({ readRecord: () => record({ findingsCount: 3 }) }),
  },
  {
    name: 'record names no governing document',
    expect: /\[review\].*names no governing document/s,
    ctx: () => ctx({ readRecord: () => record({ governing: [] }) }),
  },
  {
    name: 'record names a governing document that does not exist',
    expect: /\[review\].*does not exist/s,
    ctx: () => ctx({ docExists: () => false }),
  },
  {
    name: 'record does not say who reviewed it',
    expect: /\[review\].*does not say who reviewed it/s,
    ctx: () => ctx({ readRecord: () => record({ reviewer: { rounds: 1 } }) }),
  },
  {
    name: 'record declares no review rounds',
    expect: /\[review\].*declares no review rounds/s,
    ctx: () => ctx({ readRecord: () => record({ reviewer: { agent: 'a', model: 'm', rounds: 0 } }) }),
  },
  {
    name: 'record is an unknown shape version',
    expect: /\[review\].*recordVersion is 2, expected 1/s,
    ctx: () => ctx({ readRecord: () => record({ recordVersion: 2 }) }),
  },
  {
    name: 'a finding with an unknown severity',
    expect: /\[review\].*has severity "cosmetic"/s,
    ctx: () => ctx({ readRecord: () => record({ findings: [{ id: 'F1', severity: 'cosmetic', status: 'fixed', summary: 'x' }] }) }),
  },
  {
    name: 'a finding with an unknown status',
    expect: /\[review\].*has status "wontfix"/s,
    ctx: () => ctx({ readRecord: () => record({ findings: [{ id: 'F1', severity: 'minor', status: 'wontfix', summary: 'x' }] }) }),
  },
];

let bad = 0;
let total = CASES.length;

for (const c of CASES) {
  const { failures } = runReviewGate(c.ctx());
  const joined = failures.join('\n');
  if (c.expect === null) {
    if (failures.length) {
      console.error(`  FAIL   ${c.name}\n         expected green, got: ${joined}`);
      bad++;
    } else console.log(`  ok     ${c.name} — gate green`);
  } else if (!c.expect.test(joined)) {
    console.error(`  FAIL   ${c.name}\n         expected ${c.expect}\n         got: ${failures.length ? joined : '(gate stayed GREEN — the Brake is not connected)'}`);
    bad++;
  } else console.log(`  ok     ${c.name} — gate red, as required`);
}

// ---------------------------------------------------------------------------
// deriveVerdict + isImplementation, directly.
// ---------------------------------------------------------------------------
const units = [
  ['deriveVerdict: open blocking → FIX-FIRST', deriveVerdict([{ severity: 'blocking', status: 'open' }]) === 'FIX-FIRST'],
  ['deriveVerdict: fixed blocking → MERGE', deriveVerdict([{ severity: 'blocking', status: 'fixed' }]) === 'MERGE'],
  ['deriveVerdict: open major → MERGE', deriveVerdict([{ severity: 'major', status: 'open' }]) === 'MERGE'],
  ['deriveVerdict: empty → MERGE', deriveVerdict([]) === 'MERGE'],
  ['isImplementation: src/x.ts', isImplementation('src/x.ts') === true],
  ['isImplementation: docs/x.md', isImplementation('docs/x.md') === false],
  ['isImplementation: reviews/x.json', isImplementation('reviews/x.json') === false],
  ['isImplementation: scripts/x.mjs', isImplementation('scripts/x.mjs') === true],
];
total += units.length;
for (const [label, ok] of units) {
  if (ok) console.log(`  ok     ${label}`);
  else {
    console.error(`  FAIL   ${label}`);
    bad++;
  }
}

// ---------------------------------------------------------------------------
// candidateShas against a real git repo — the rule that makes this gate
// self-hostable: a record may be filed against the commit it reviewed, and the
// only commits allowed after it are ones that add the record itself.
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'review-gate-git-'));
  const g = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const commit = (path, msg) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), `${msg}\n`);
    g('add', '-A');
    g('commit', '-q', '-m', msg);
    return g('rev-parse', 'HEAD');
  };
  g('init', '-q', '-b', 'main');
  const base = commit('README.md', 'base');
  const implSha = commit('src/a.ts', 'implementation');
  const headSha = commit('reviews/x.json', 'add review record');

  const cands = candidateShas(dir, base);
  const checks = [
    ['candidateShas includes HEAD', cands[0] === headSha],
    ['candidateShas strips a trailing reviews-only commit', cands.includes(implSha)],
  ];

  // A trailing commit that touches code as well must NOT be stripped.
  const mixed = commit('src/b.ts', 'more code');
  const cands2 = candidateShas(dir, base);
  checks.push(['candidateShas does NOT strip a commit that touches code', !cands2.includes(headSha) && cands2[0] === mixed && cands2.length === 1]);

  total += checks.length;
  for (const [label, ok] of checks) {
    if (ok) console.log(`  ok     ${label}`);
    else {
      console.error(`  FAIL   ${label}`);
      bad++;
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log();
if (bad) {
  console.error(`review-gate selftest FAILED: ${bad}/${total} case(s) wrong`);
  process.exit(1);
}
console.log(`review-gate selftest passed: ${total}/${total} cases (the Brake is connected)`);
