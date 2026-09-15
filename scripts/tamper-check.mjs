#!/usr/bin/env node
// ============================================================================
// TAMPER DETECTION (P12-a, ADR-0075 clause 3 / RFC-039 D8).
//
// An agent asked to make tests pass has an obvious shortcut. GitHub's own words:
// "Agents have an obvious path to get tests passing: remove the tests, skip the
// lint step, add `|| true` to test commands." This Brake reads a unified diff
// and refuses the four shapes that buy a green run without buying correctness.
//
// It is DELIBERATELY not a coverage tool and not a linter. It answers exactly
// one question: did this change make the suite weaker in a way that looks like
// success? Anything requiring judgement belongs to the ADR-0052 review.
//
// A GATE THAT BLOCKS HONEST WORK IS A DEFECT (ADR-0052), so two things are
// designed in rather than bolted on:
//   * Every detector is anchored on ADDED lines only. Touching a file that
//     already contains `.skip` does not implicate you.
//   * REMOVED-TEST detection has a real escape, because legitimate reasons
//     exist (deleting a genuinely obsolete test, splitting a file). The escape
//     is a `Tamper-Waiver: <reason>` trailer in the commit message — machine
//     checkable, and it forces the author to say WHY in a durable place rather
//     than silently shrinking the suite.
//
//   node scripts/tamper-check.mjs [--base <ref>] [--head <ref>]
// ============================================================================
import { execFileSync } from 'node:child_process';

/** Files whose weakening is what this Brake is about. */
export const isTestPath = (f) => /(^|\/)(test|tests|scenarios)\//i.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(f);
/** Where a `|| true` would neuter a command rather than guard an optional step. */
export const isCommandPath = (f) => /^\.github\/workflows\/.*\.ya?ml$/i.test(f) || /(^|\/)package\.json$/i.test(f) || /\.(sh|bash|mjs|js)$/i.test(f);

const SKIP = /\b(?:it|test|describe|bench)\s*\.\s*(skip|todo|failing)\s*\(|^\s*x(?:it|test|describe)\s*\(/;
const ONLY = /\b(?:it|test|describe)\s*\.\s*only\s*\(/;
// `|| true` / `; true` / `|| exit 0` attached to something that runs tests or lint.
const OR_TRUE = /\b(?:test|vitest|jest|tsc|lint|eslint|npm\s+(?:run\s+)?\w+|node\s+\S+)\b[^\n#]*?(?:\|\|\s*(?:true|exit\s+0)|;\s*true\b|--passWithNoTests)/i;
// Assertions that hold no matter what the code does.
const TAUTOLOGY = [
  /expect\s*\(\s*(true)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*true\s*\)/,
  /expect\s*\(\s*(false)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*false\s*\)/,
  /expect\s*\(\s*(\d+|'[^']*'|"[^"]*")\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/,
  /expect\s*\(\s*([A-Za-z_$][\w$.]*)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/,
  /\bassert\s*\(\s*true\s*\)/,
  /expect\s*\(\s*[^)]*\s*\)\s*\.\s*toBeDefined\s*\(\s*\)\s*;?\s*$(?<!x)/,
];
const TEST_DECL = /\b(?:it|test)\s*(?:\.\s*\w+\s*)?\(/g;

/**
 * In JS-family files, a pattern inside a STRING LITERAL is data, not code — so
 * strip literals before matching. This is not a convenience: any test for a
 * linter necessarily contains the shapes that linter detects, and without this
 * the Brake flags its own selftest (observed on the first control run). It is
 * scoped to JS/TS because in YAML `run: npm test || true` is unquoted and real.
 */
const isJsFamily = (f) => /\.[cm]?[jt]sx?$/i.test(f);
const stripStrings = (line) =>
  line
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

/** Split a unified diff into per-file added/removed line lists. */
export function parseDiff(diff) {
  const files = new Map();
  let cur = null;
  for (const line of String(diff).split('\n')) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) { cur = { file: m[1], added: [], removed: [] }; files.set(m[1], cur); continue; }
    if (!cur || line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) cur.added.push(line.slice(1));
    else if (line.startsWith('-')) cur.removed.push(line.slice(1));
  }
  return [...files.values()];
}

/**
 * Count LIVE test declarations. A skipped test contributes nothing, so removing
 * one removes nothing — counting it would flag the honest cleanup of a
 * long-dead `it.skip` as tampering. (Caught by this Brake's own selftest.)
 */
const countLive = (lines, file) =>
  lines.reduce((n, l0) => {
    const l = isJsFamily(file) ? stripStrings(l0) : l0;
    return SKIP.test(l) ? n : n + (l.match(TEST_DECL)?.length ?? 0);
  }, 0);

/**
 * @returns findings: {kind, file, detail, waivable}
 */
export function scanDiff(diff, { waiver = null } = {}) {
  const out = [];
  for (const { file, added, removed } of parseDiff(diff)) {
    const code = (l) => (isJsFamily(file) ? stripStrings(l) : l);
    for (const line of added) {
      const raw = line.trim();
      if (!raw || raw.startsWith('//') || raw.startsWith('*') || raw.startsWith('#')) continue;
      const t = code(raw);
      if (isTestPath(file) && SKIP.test(t)) out.push({ kind: 'skip', file, detail: raw.slice(0, 120), waivable: false });
      if (isTestPath(file) && ONLY.test(t)) out.push({ kind: 'only', file, detail: raw.slice(0, 120), waivable: false });
      if (isCommandPath(file) && OR_TRUE.test(t)) out.push({ kind: 'or-true', file, detail: raw.slice(0, 120), waivable: false });
      if (isTestPath(file) && TAUTOLOGY.some((re) => re.test(t))) out.push({ kind: 'tautology', file, detail: raw.slice(0, 120), waivable: false });
    }
    if (isTestPath(file)) {
      const net = countLive(added, file) - countLive(removed, file);
      if (net < 0 && !waiver) {
        out.push({ kind: 'tests-removed', file, detail: `${-net} more test declaration(s) removed than added`, waivable: true });
      }
    }
  }
  return out;
}

const EXPLAIN = {
  skip: 'a skipped/todo test was ADDED — a skipped test is not a passing test',
  only: 'an `.only` was ADDED — it silently skips every other test in the file',
  'or-true': 'a command was neutered so it cannot fail',
  tautology: 'an assertion was ADDED that holds regardless of what the code does',
  'tests-removed': 'the file lost test declarations',
};

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });

export function main(argv = process.argv.slice(2)) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const head = arg('--head', 'HEAD');
  let base = arg('--base', null);
  if (!base) { try { base = git('merge-base', 'origin/main', head).trim(); } catch { base = git('rev-parse', `${head}^`).trim(); } }

  const diff = git('diff', '--unified=0', `${base}..${head}`);
  const msg = (() => { try { return git('log', '--format=%B', `${base}..${head}`); } catch { return ''; } })();
  const waiver = /^Tamper-Waiver:\s*(.+)$/im.exec(msg)?.[1]?.trim() ?? null;

  const findings = scanDiff(diff, { waiver });
  const scanned = parseDiff(diff).length;
  console.log(`tamper-check: ${scanned} changed file(s) between ${base.slice(0, 7)}..${head}`);
  if (waiver) console.log(`  Tamper-Waiver present: "${waiver}" (waives test-removal only)`);

  if (!findings.length) { console.log('tamper-check PASSED — the suite was not weakened'); return 0; }
  for (const f of findings) console.error(`  TAMPER [${f.kind}] ${f.file}: ${EXPLAIN[f.kind]}\n    ${f.detail}`);
  console.error(`\ntamper-check FAILED (${findings.length} finding(s)).`);
  if (findings.some((f) => f.waivable)) {
    console.error('Removing tests may be legitimate. If it is, say why in a commit trailer:\n  Tamper-Waiver: <reason the removal is correct>');
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
