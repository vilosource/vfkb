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
// Docs, the brain, and this repo's prose are exempt — the same carve-out
// ADR-0029 makes for sub-tasks and pure-doc edits.
export const IMPL_PATHS = [/^src\//, /^test\//, /^scenarios\//, /^scripts\//, /^\.claude\/commands\//, /^\.github\/workflows\//];
const EXEMPT_PATHS = [/^docs\//, /^\.vfkb\//, /^README\.md$/, /^CLAUDE\.md$/, /^reviews\//];

const SEVERITY = ['blocking', 'major', 'minor'];
const STATUS = ['fixed', 'accepted', 'open'];

export const isImplementation = (f) => !EXEMPT_PATHS.some((r) => r.test(f)) && IMPL_PATHS.some((r) => r.test(f));

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

function validateRecord(rec, sha, docExists) {
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
    // A blocking finding may be waived, but only on the record, by a named human.
    if (f.severity === 'blocking' && f.status === 'accepted' && !f.acceptedBy) {
      bad.push(`finding ${f.id} waives a BLOCKING finding with no \`acceptedBy\` — only the operator may accept one, on the record`);
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

  const derived = deriveVerdict(rec.findings);
  if (rec.verdict !== derived) {
    bad.push(
      `record asserts verdict ${JSON.stringify(rec.verdict)} but its findings derive ${derived}` +
        (derived === 'FIX-FIRST' ? ' — an unresolved blocking finding cannot be merged over' : ''),
    );
  }
  if (derived !== 'MERGE') {
    bad.push(`review verdict is ${derived}: fix the blocking findings and re-review against the new head sha`);
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
    const bad = validateRecord(rec, sha, ctx.docExists);
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
const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

/** HEAD, plus each sha reachable by stripping trailing commits that touch ONLY reviews/. */
export function candidateShas(repo, base, head = 'HEAD') {
  const shas = [git(repo, 'rev-parse', head)];
  for (const sha of git(repo, 'rev-list', `${base}..${head}`).split('\n').filter(Boolean)) {
    const touched = git(repo, 'show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
    // Walk back while the tip commits only add review records.
    if (touched.every((f) => /^reviews\//.test(f))) shas.push(git(repo, 'rev-parse', `${sha}^`));
    else break;
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
