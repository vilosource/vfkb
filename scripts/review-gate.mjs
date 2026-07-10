#!/usr/bin/env node
// ============================================================================
// Deterministic review gate (ADR-0052 — the Brake on the review rule)
// ----------------------------------------------------------------------------
// Brain decision 1cf647f35571 records the operator's standing rule: "after every
// major implementation launch a review agent." On 2026-07-09 four PRs — two of
// them substantial implementations — were self-merged without one. The rule was
// not disobeyed so much as rendered inapplicable: it lived in a command scoped
// to a `v2` branch topology that had dissolved, so there was nothing to skip.
//
// A prose rule with no Brake gets skipped. This is the Brake.
//
// A PR that touches implementation paths FAILS unless it carries a review record
// `reviews/<sha>.json` for the code that was actually reviewed.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT
//   It proves a review record exists, is bound to THIS diff, and that its own
//   findings support its verdict. It cannot prove a review HAPPENED — an author
//   determined to lie can hand-write the JSON. That is deliberate: the observed
//   failure was OMISSION under end-of-chain momentum, not forgery, and
//   CLAUDE.md forbids building for a defect nobody has seen. What the Brake
//   changes is that skipping the review is no longer silent: it now requires a
//   deliberate false statement, committed under your name.
//
//   node scripts/review-gate.mjs [--base origin/main]
// ============================================================================
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Changing any of these is an implementation change and needs a review.
// Case-insensitive: a file at `Src/` is a mistake, and failing closed on it is
// the safe direction.
export const IMPL_PATHS = [
  /^src\//i,
  /^test\//i,
  /^scenarios\//i,
  /^scripts\//i,
  /^\.claude\/commands\//i,
  /^\.github\/workflows\//i,
  // The waiver allowlist decides who may merge over a blocking finding. Editing
  // it is an implementation change, and is itself reviewed — otherwise an agent
  // could simply add itself.
  /^reviews\/OPERATORS$/,
];

// Exempt paths WIN over the implementation list. This list contains ONLY entries
// that actually shadow an IMPL_PATHS match — anything else would be dead code
// that reads as protection. `docs/`, `.vfkb/`, `README.md`, `CLAUDE.md` and the
// review records are exempt because no IMPL rule matches them, and the selftest
// asserts that BEHAVIOUR rather than trusting an inert regex to express it.
//
//   scenarios/records/ shadows scenarios/ — committing L4 evidence is the
//   project's own DoD workflow (ADR-0022/0029), and forcing an adversarial code
//   review onto a PR that adds nothing but a scenario record blocks honest work.
const EXEMPT_PATHS = [/^scenarios\/records\//i];

/** Only a review record may be stripped from the tip when locating the reviewed sha. */
const isReviewRecord = (f) => /^reviews\/[0-9a-f]{40}\.json$/i.test(f);

const SEVERITY = ['blocking', 'major', 'minor'];
const STATUS = ['fixed', 'accepted', 'open'];
// A reviewer may return any of these. Only MERGE lets the PR through.
const VERDICTS = ['MERGE', 'FIX-FIRST', 'REDESIGN'];

export const isImplementation = (raw) => {
  const f = String(raw).replace(/^\.\//, '');
  // `git diff --name-only` never emits these, but a path that escapes its
  // directory is not something to reason about — treat it as implementation.
  if (f.split('/').includes('..')) return true;
  return !EXEMPT_PATHS.some((r) => r.test(f)) && IMPL_PATHS.some((r) => r.test(f));
};

/**
 * Recompute the verdict from the findings. The record's own `verdict` field is a
 * CLAIM; this is the evidence. A record may not assert MERGE while carrying an
 * unresolved blocking finding — the same reason the release gate stopped reading
 * `demonstrated: true` (RFC-024 §2a).
 */
export function deriveVerdict(findings) {
  const unresolved = findings.filter((f) => f.severity === 'blocking' && f.status === 'open');
  return unresolved.length ? 'FIX-FIRST' : 'MERGE';
}

function validateRecord(rec, sha, docExists, isOperator) {
  const bad = [];
  if (rec.recordVersion !== 1) bad.push(`recordVersion is ${rec.recordVersion}, expected 1`);
  if (rec.sha !== sha) bad.push(`record says sha ${rec.sha} but it is filed as ${sha}`);

  if (!Array.isArray(rec.governing) || rec.governing.length === 0) {
    bad.push('record names no governing document — a review with no standard to review against is an opinion');
  } else {
    for (const d of rec.governing) if (!docExists(d)) bad.push(`governing document ${d} does not exist`);
  }
  if (!rec.reviewer?.agent || !rec.reviewer?.model) bad.push('record does not say who reviewed it (reviewer.agent, reviewer.model)');
  if (!Number.isInteger(rec.reviewer?.rounds) || rec.reviewer.rounds < 1) bad.push('record declares no review rounds');

  if (!Array.isArray(rec.findings)) {
    bad.push('record carries no findings array');
    return bad;
  }
  for (const [i, f] of rec.findings.entries()) {
    if (!f.id || !f.summary) bad.push(`finding ${i} has no id/summary`);
    if (!SEVERITY.includes(f.severity)) bad.push(`finding ${f.id ?? i} has severity ${JSON.stringify(f.severity)}`);
    if (!STATUS.includes(f.status)) bad.push(`finding ${f.id ?? i} has status ${JSON.stringify(f.status)}`);
    // A blocking finding may be waived, but only on the record, by an operator
    // named in `reviews/OPERATORS`. Accepting any truthy string here would let
    // the author waive their own blocker with `acceptedBy: "me"` — which is what
    // the first version of this gate did, while its ADR claimed otherwise.
    if (f.severity === 'blocking' && f.status === 'accepted') {
      if (!f.acceptedBy || typeof f.acceptedBy !== 'string') {
        // A non-string here used to throw a TypeError out of isOperator: still
        // fail-closed, but a stack trace instead of a finding.
        bad.push(`finding ${f.id} waives a BLOCKING finding with no \`acceptedBy\` string`);
      } else if (!isOperator(f.acceptedBy)) {
        bad.push(
          `finding ${f.id} waives a BLOCKING finding as "${f.acceptedBy}", who is not listed in reviews/OPERATORS — ` +
            `only an operator may accept a blocking finding, on the record`,
        );
      }
    }
  }
  // "No findings" must say what was checked and ruled out (the rubric's rule).
  if (rec.findings.length === 0 && (!Array.isArray(rec.ruledOut) || rec.ruledOut.length === 0)) {
    bad.push('record reports no findings but does not say what it checked and ruled out — "clean" must be shown, not asserted');
  }
  // Count what you claim.
  if (rec.findingsCount !== undefined && rec.findingsCount !== rec.findings.length) {
    bad.push(`record claims findingsCount ${rec.findingsCount} but carries ${rec.findings.length} findings`);
  }

  if (!VERDICTS.includes(rec.verdict)) {
    bad.push(`record asserts verdict ${JSON.stringify(rec.verdict)}; expected one of ${VERDICTS.join(' / ')}`);
    return bad;
  }
  // The verdict is a CLAIM; the findings are the evidence. A record may not
  // assert MERGE while carrying an unresolved blocking finding.
  //
  // The reverse is NOT an error: a reviewer may honestly return FIX-FIRST over
  // `major` findings alone. An earlier version failed that as a "mismatch",
  // which would have red-lighted a correct review — and made REDESIGN, which the
  // rubric asks reviewers to use, impossible to record at all.
  const derived = deriveVerdict(rec.findings);
  if (rec.verdict === 'MERGE' && derived === 'FIX-FIRST') {
    bad.push('record asserts verdict "MERGE" while carrying an unresolved `blocking` finding — that cannot be merged over');
  }
  if (rec.verdict !== 'MERGE') {
    bad.push(`review verdict is ${rec.verdict}: fix the findings and re-review against the new head sha`);
  }
  return bad;
}

/**
 * @param ctx.changedFiles  paths changed vs the base branch
 * @param ctx.candidates    shas a record may legitimately be filed against:
 *                          HEAD, plus HEAD with trailing record-only commits stripped
 * @param ctx.readRecord    (sha) => record | undefined
 * @param ctx.docExists     (path) => boolean
 */
export function runReviewGate(ctx) {
  const impl = ctx.changedFiles.filter(isImplementation);
  const notes = [];
  if (impl.length === 0) {
    notes.push(`no implementation paths changed (${ctx.changedFiles.length} file(s)) — review not required`);
    return { failures: [], notes };
  }
  notes.push(`${impl.length} implementation file(s) changed: ${impl.slice(0, 4).join(', ')}${impl.length > 4 ? ', …' : ''}`);

  for (const sha of ctx.candidates) {
    const rec = ctx.readRecord(sha);
    if (!rec) continue;
    const bad = validateRecord(rec, sha, ctx.docExists, ctx.isOperator ?? (() => false));
    if (bad.length) return { failures: bad.map((m) => `[review] ${m}`), notes };
    notes.push(
      `review ok: ${sha.slice(0, 7)} reviewed by ${rec.reviewer.agent}/${rec.reviewer.model} over ${rec.reviewer.rounds} round(s), ` +
        `${rec.findings.length} finding(s), verdict ${rec.verdict}`,
    );
    return { failures: [], notes };
  }

  return {
    failures: [
      `[review] this PR changes implementation but carries no review record for it.\n` +
        `         Expected one of: ${ctx.candidates.map((s) => `reviews/${s.slice(0, 7)}….json`).join(' or ')}\n` +
        `         Run \`/review\` (a fresh-eyes subagent — do not review your own diff inline), then commit its record.\n` +
        `         Standing rule, brain decision 1cf647f35571: "after every major implementation launch a review agent."`,
    ],
    notes,
  };
}

// ---------------------------------------------------------------------------
// Git adapter: the only impure part.
// ---------------------------------------------------------------------------
// `cwd` does not win over an ambient GIT_DIR / GIT_WORK_TREE: those redirect git
// at another repository entirely, so the gate would read history it was never
// pointed at. Strip them; keep the rest of the environment (ssh agent, proxies).
const gitEnv = () => {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_NAMESPACE', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[k];
  return env;
};
const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: gitEnv() }).trim();

/**
 * HEAD, plus each sha reachable by stripping trailing commits that touch ONLY
 * `reviews/`. That is what lets a review of commit X be filed as `reviews/X.json`
 * without the act of filing invalidating itself.
 *
 * A MERGE COMMIT IS NEVER STRIPPED. `git show --name-only` prints nothing for a
 * merge, so `[].every(isReviewPath)` is vacuously TRUE — the first version of
 * this walked straight through merges down the first-parent line until it found
 * some *other* PR's review record, and passed a merge of unreviewed code. Same
 * vacuous-truth bug as a contrast arm whose predicate names a field no trial
 * carries. An empty file list now stops the walk.
 */
export function candidateShas(repo, base, head = 'HEAD') {
  const shas = [git(repo, 'rev-parse', head)];
  for (const sha of git(repo, 'rev-list', `${base}..${head}`).split('\n').filter(Boolean)) {
    const parents = git(repo, 'rev-list', '--parents', '-n', '1', sha).split(/\s+/).length - 1;
    if (parents > 1) break; // a merge commit brings in code from another lineage
    const touched = git(repo, 'show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
    if (touched.length === 0) break; // empty commit: proves nothing, strips nothing
    if (!touched.every(isReviewRecord)) break;
    let parent;
    try {
      parent = git(repo, 'rev-parse', `${sha}^`);
    } catch {
      break; // a root commit has no parent to fall back to
    }
    shas.push(parent);
  }
  return shas;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const baseArg = process.argv.indexOf('--base');
  const base = baseArg > -1 ? process.argv[baseArg + 1] : 'origin/main';
  const mergeBase = git(repo, 'merge-base', base, 'HEAD');

  const ctx = {
    changedFiles: git(repo, 'diff', '--name-only', `${mergeBase}..HEAD`).split('\n').filter(Boolean),
    candidates: candidateShas(repo, mergeBase),
    readRecord: (sha) => {
      const p = join(repo, 'reviews', `${sha}.json`);
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined;
    },
    docExists: (d) => existsSync(join(repo, d)),
    isOperator: (name) => {
      const p = join(repo, 'reviews', 'OPERATORS');
      if (!existsSync(p)) return false; // no allowlist ⇒ nobody may waive
      return readFileSync(p, 'utf8')
        .split('\n')
        .map((l) => l.replace(/#.*$/, '').trim())
        .filter(Boolean)
        .includes(name.trim());
    },
  };

  const { failures, notes } = runReviewGate(ctx);
  for (const n of notes) console.log(n);
  for (const f of failures) console.error(`GATE FAIL: ${f}`);
  if (failures.length) {
    console.error(`\nreview gate FAILED (${failures.length} problem(s))`);
    process.exit(1);
  }
  console.log('\nreview gate PASSED');
}
