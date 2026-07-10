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

// CI runners have no global git identity, so identity comes from the environment
// rather than from `-c` flags a call site can forget.
//
// The environment is built from NOTHING but PATH. Spreading `process.env` here
// inherited any ambient `GIT_DIR`, and these fixtures create commits: with
// `GIT_DIR` set to another repository, running this selftest wrote 8 commits
// into it. Observed, not theorised. A test that mutates a repo it does not own
// is worse than a test that fails.
export const GIT_ENV = {
  PATH: process.env.PATH,
  HOME: '/nonexistent',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};
const gitIn = (cwd) => (...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: GIT_ENV }).trim();

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
  isOperator: (n) => n === 'vilosource',
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
    // NOT a test of EXEMPT_PATHS: `reviews/*.json` matches no IMPL rule, so it
    // would pass with the exempt list empty. Named honestly.
    name: 'a review record matches no implementation rule',
    expect: null,
    ctx: () => ctx({ changedFiles: [`reviews/${'a'.repeat(40)}.json`], readRecord: () => undefined }),
  },
  {
    name: 'zero findings is allowed when the record says what it ruled out',
    expect: null,
    ctx: () => ctx({ readRecord: () => record({ findings: [], ruledOut: ['race conditions', 'the proof can fail'] }) }),
  },
  {
    name: 'a BLOCKING finding may be waived by an operator named in reviews/OPERATORS',
    expect: null,
    ctx: () => ctx({ readRecord: () => record({ findings: [{ id: 'F1', severity: 'blocking', status: 'accepted', acceptedBy: 'vilosource', summary: 'x' }] }) }),
  },
  {
    // The first version accepted ANY truthy string here, so the author could
    // waive their own blocker with `acceptedBy: "me"` while the ADR claimed
    // only the operator could. Prose asserting a property the code lacked.
    name: 'a BLOCKING finding waived by someone not on the operator allowlist',
    expect: /\[review\].*not listed in reviews\/OPERATORS/s,
    ctx: () => ctx({ readRecord: () => record({ findings: [{ id: 'F1', severity: 'blocking', status: 'accepted', acceptedBy: 'me-myself', summary: 'x' }] }) }),
  },
  {
    // A non-string `acceptedBy` threw a TypeError out of isOperator — fail-closed,
    // but a stack trace instead of a finding.
    name: 'a BLOCKING finding waived by a non-string `acceptedBy`',
    expect: /\[review\].*no `acceptedBy` string/s,
    ctx: () => ctx({ readRecord: () => record({ findings: [{ id: 'F1', severity: 'blocking', status: 'accepted', acceptedBy: 123, summary: 'x' }] }) }),
  },
  {
    name: 'no operator allowlist at all ⇒ nobody may waive a blocking finding',
    expect: /\[review\].*not listed in reviews\/OPERATORS/s,
    ctx: () => ctx({ isOperator: () => false, readRecord: () => record({ findings: [{ id: 'F1', severity: 'blocking', status: 'accepted', acceptedBy: 'vilosource', summary: 'x' }] }) }),
  },
  {
    name: 'editing reviews/OPERATORS is itself an implementation change',
    expect: /\[review\].*carries no review record/s,
    ctx: () => ctx({ changedFiles: ['reviews/OPERATORS'], readRecord: () => undefined }),
  },
  {
    // Committing L4 evidence is the project's own DoD workflow. Forcing a code
    // review onto it would block honest work — a false RED.
    name: 'a PR that only commits L4 evidence (scenarios/records/) needs no review',
    expect: null,
    ctx: () => ctx({ changedFiles: ['scenarios/records/doctor-staleness.json'], readRecord: () => undefined }),
  },
  {
    name: 'an honest FIX-FIRST over `major` findings alone is recordable, and still blocks',
    expect: /\[review\].*verdict is FIX-FIRST/s,
    ctx: () => ctx({ readRecord: () => record({ verdict: 'FIX-FIRST', findings: [{ id: 'F1', severity: 'major', status: 'open', summary: 'x' }] }) }),
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
    expect: /\[review\].*asserts verdict "MERGE" while carrying an unresolved `blocking` finding/s,
    ctx: () => ctx({ readRecord: () => record({ findings: [{ id: 'F1', severity: 'blocking', status: 'open', summary: 'x' }] }) }),
  },
  {
    name: 'an honest FIX-FIRST verdict blocks the merge',
    expect: /\[review\].*verdict is FIX-FIRST: fix the findings/s,
    ctx: () => ctx({ readRecord: () => record({ verdict: 'FIX-FIRST', findings: [{ id: 'F1', severity: 'blocking', status: 'open', summary: 'x' }] }) }),
  },
  {
    name: 'a REDESIGN verdict is recordable and blocks the merge',
    expect: /\[review\].*verdict is REDESIGN/s,
    ctx: () => ctx({ readRecord: () => record({ verdict: 'REDESIGN' }) }),
  },
  {
    name: 'an unknown verdict is rejected',
    expect: /\[review\].*expected one of MERGE \/ FIX-FIRST \/ REDESIGN/s,
    ctx: () => ctx({ readRecord: () => record({ verdict: 'LGTM' }) }),
  },
  {
    name: 'record carries no findings array at all',
    expect: /\[review\].*carries no findings array/s,
    ctx: () => ctx({ readRecord: () => record({ findings: undefined }) }),
  },
  {
    name: 'a finding with no id or summary',
    expect: /\[review\].*has no id\/summary/s,
    ctx: () => ctx({ readRecord: () => record({ findings: [{ severity: 'minor', status: 'fixed' }] }) }),
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
  // The fixtures create commits. If the environment they run under can be
  // redirected, they mutate a repository they do not own.
  ['fixture env inherits no GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE', !['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_NAMESPACE'].some((k) => k in GIT_ENV)],
  ['isImplementation: src/x.ts', isImplementation('src/x.ts') === true],
  ['isImplementation: scripts/x.mjs', isImplementation('scripts/x.mjs') === true],
  ['isImplementation: reviews/OPERATORS', isImplementation('reviews/OPERATORS') === true],
  // The ONE exemption that does any work: it shadows an IMPL match. Asserted as
  // a pair, so it cannot pass for an unrelated reason.
  ['EXEMPT shadows IMPL: scenarios/x.ts is implementation', isImplementation('scenarios/x.ts') === true],
  ['EXEMPT shadows IMPL: scenarios/records/x.json is not', isImplementation('scenarios/records/x.json') === false],
  // These match no IMPL rule at all. Asserted as behaviour, not as an inert regex.
  ['not implementation: docs/x.md', isImplementation('docs/x.md') === false],
  ['not implementation: .vfkb/entries.jsonl', isImplementation('.vfkb/entries.jsonl') === false],
  ['not implementation: README.md', isImplementation('README.md') === false],
  ['not implementation: CLAUDE.md', isImplementation('CLAUDE.md') === false],
  ['not implementation: a review record', isImplementation(`reviews/${'a'.repeat(40)}.json`) === false],
  // Case variants and path oddities fail CLOSED.
  ['case variant: Src/x.ts is implementation', isImplementation('Src/x.ts') === true],
  ['leading ./ is normalised: ./src/x.ts', isImplementation('./src/x.ts') === true],
  ['a path escaping its directory is implementation', isImplementation('scenarios/records/../a.ts') === true],
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
  const g = gitIn(dir);
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
  // Only a real `reviews/<40-hex>.json` may be stripped — `reviews/notes.md`
  // must not be, or "reviews-only" becomes "anything under reviews/".
  const headSha = commit(`reviews/${'d'.repeat(40)}.json`, 'add review record');

  const cands = candidateShas(dir, base);
  const checks = [
    ['candidateShas includes HEAD', cands[0] === headSha],
    ['candidateShas strips a trailing reviews-only commit', cands.includes(implSha)],
  ];

  // A trailing commit that touches code as well must NOT be stripped.
  const mixed = commit('src/b.ts', 'more code');
  const cands2 = candidateShas(dir, base);
  checks.push(['candidateShas does NOT strip a commit that touches code', !cands2.includes(headSha) && cands2[0] === mixed && cands2.length === 1]);

  // `reviews/OPERATORS` is not a review record: a commit touching it is code.
  const ops = commit('reviews/OPERATORS', 'add an operator');
  checks.push(['candidateShas does NOT strip a commit touching reviews/OPERATORS', candidateShas(dir, base)[0] === ops && candidateShas(dir, base).length === 1]);

  // THE MERGE COMMIT. `git show --name-only` prints NOTHING for a merge, so
  // `[].every(isReviewRecord)` was vacuously true: the walk sailed through the
  // merge, down the first-parent line, and accepted a review record belonging to
  // some OTHER pull request — passing a merge of entirely unreviewed code.
  // This fixture is the case the original suite never built.
  {
    const d2 = mkdtempSync(join(tmpdir(), 'review-gate-merge-'));
    const g2 = gitIn(d2);
    const c2 = (path, msg) => {
      mkdirSync(join(d2, path, '..'), { recursive: true });
      writeFileSync(join(d2, path), `${msg}\n`);
      g2('add', '-A');
      g2('commit', '-q', '-m', msg);
      return g2('rev-parse', 'HEAD');
    };
    g2('init', '-q', '-b', 'main');
    const b2 = c2('README.md', 'base');
    const impl2 = c2('src/a.ts', 'impl');
    const rec2 = c2(`reviews/${'c'.repeat(40)}.json`, 'a previous PR left its review record');
    g2('checkout', '-q', '-b', 'side', impl2);
    c2('src/evil.ts', 'unreviewed code');
    g2('checkout', '-q', 'main');
    g2('merge', '-q', '--no-ff', 'side', '-m', 'Merge pull request #999');
    const mergeHead = g2('rev-parse', 'HEAD');

    const c = candidateShas(d2, b2, mergeHead);
    checks.push(['a merge commit is never stripped (it brings in another lineage)', c.length === 1 && c[0] === mergeHead]);
    checks.push(["a merge does not inherit another PR's review record", !c.includes(rec2) && !c.includes(impl2)]);

    // ISOLATION. The two guards above (`parents > 1` and `touched.length === 0`)
    // are redundant on a plain merge — reverting either alone reddens nothing,
    // which means neither is tested. These two fixtures separate them.
    //
    // (a) a MERGE whose combined diff lists ONLY a review record. Non-empty file
    //     list, so only the parent count can stop the walk.
    g2('checkout', '-q', '-b', 'side2', impl2);
    c2('src/more-evil.ts', 'more unreviewed code');
    g2('checkout', '-q', 'main');
    g2('merge', '--no-ff', '--no-commit', 'side2');
    writeFileSync(join(d2, 'reviews', `${'e'.repeat(40)}.json`), '{}\n');
    g2('add', '-A');
    g2('commit', '-q', '-m', 'Merge, resolving only a review record');
    const sneaky = g2('rev-parse', 'HEAD');
    const touched = g2('show', '--name-only', '--format=', sneaky).split('\n').filter(Boolean);
    const cs = candidateShas(d2, b2, sneaky);
    checks.push([
      `a merge whose diff is review-records-only is still not stripped (files: ${touched.length})`,
      touched.length > 0 && cs.length === 1 && cs[0] === sneaky,
    ]);

    // (b) an EMPTY commit at the tip. One parent, zero files — `[].every()` is
    //     vacuously true, so only the empty-list guard can stop the walk.
    const d3 = mkdtempSync(join(tmpdir(), 'review-gate-empty-'));
    const g3 = gitIn(d3);
    g3('init', '-q', '-b', 'main');
    mkdirSync(join(d3, 'src'), { recursive: true });
    writeFileSync(join(d3, 'README.md'), 'base\n');
    g3('add', '-A');
    g3('commit', '-q', '-m', 'base');
    const b3 = g3('rev-parse', 'HEAD');
    writeFileSync(join(d3, 'src', 'a.ts'), 'x\n');
    g3('add', '-A');
    g3('commit', '-q', '-m', 'impl');
    const impl3 = g3('rev-parse', 'HEAD');
    g3('commit', '-q', '--allow-empty', '-m', 'an empty commit proves nothing');
    const emptyHead = g3('rev-parse', 'HEAD');
    const ce = candidateShas(d3, b3, emptyHead);
    checks.push(['an empty commit is not stripped (it is not a review record)', ce.length === 1 && ce[0] === emptyHead && !ce.includes(impl3)]);
    rmSync(d3, { recursive: true, force: true });

    rmSync(d2, { recursive: true, force: true });
  }

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
