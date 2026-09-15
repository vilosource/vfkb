#!/usr/bin/env node
// ============================================================================
// TAMPER DETECTION (P12-a, ADR-0075 clause 3 / RFC-039 D8).
//
// An agent asked to make tests pass has an obvious shortcut. GitHub's framing:
// "Agents have an obvious path to get tests passing: remove the tests, skip the
// lint step, add `|| true` to test commands."
//
// ── WHY THIS COMPARES STATE, NOT DIFF LINES ─────────────────────────────────
// The first version of this Brake matched regexes against ADDED diff lines.
// Adversarial review ran 33 tampers against it and 21 got through, four of them
// structurally invisible to ANY line matcher:
//   * `git rm test/foo.test.ts`  -> git emits `+++ /dev/null`, so the file never
//     entered the scanner at all and it printed "0 changed file(s) … PASSED".
//     That is the FIRST thing RFC-039 D8 names, failing while reporting success.
//   * `git mv test/foo.test.ts helpers/foo.ts` -> a 100%-similarity rename has
//     no content lines to match.
//   * `"test": "echo ok"` in package.json, or `if: false` on the test step ->
//     the command is neutered without any banned token appearing.
//   * deleting the test step outright -> nothing is added, so nothing is seen.
// The evidence for all four lives in file STATUS, repo-wide COUNTS and the
// RESOLVED COMMAND — none of which a diff-line scanner reads. So this version
// builds an inventory at the BASE and at the HEAD and compares them. Deletion,
// rename and relocation all fall out of that comparison for free.
//
// ── WHY IT CANNOT QUIETLY BLOCK HONEST WORK ─────────────────────────────────
// A gate that blocks honest work is a defect (ADR-0052), and a tamper detector
// with that flaw is worse than none: it teaches people to route around the gate,
// and the routing-around is invisible. So weakenings that have legitimate
// reasons (deleting an obsolete test, changing the test command) are WAIVABLE via
// a `Tamper-Waiver:` commit trailer, and weakenings that never do (adding a
// skip, neutering a command, writing a tautology) are NOT.
//
// The waiver's scope is enforced by COMPUTING THE UNWAIVABLE FINDINGS FIRST AND
// INDEPENDENTLY. In the first version an unrecognised skip spelling fell through
// to the waivable removal count, so `Tamper-Waiver:` silently excused an added
// `it.concurrent.skip(` — the opposite of what its own documentation claimed.
//
//   node scripts/tamper-check.mjs [--base <ref>] [--head <ref>] [--repo <dir>]
// ============================================================================
import { execFileSync } from 'node:child_process';

export const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(f) || /^(test|tests|scenarios)\//i.test(f);
/** ONLY places where a test command actually lives. Narrowed from "any .mjs",
 *  which made this Brake flag its own selftest (review finding B5). */
export const isCommandFile = (f) => /^\.github\/workflows\/.*\.ya?ml$/i.test(f) || f === 'package.json';

// A skipped test in every spelling review found evading the first version:
// .skip/.todo/.failing, chained (.concurrent.skip), bracket access, x-prefix,
// and the conditional forms whose condition is a constant.
const SKIP = [
  /\b(?:it|test|describe|bench)\s*(?:\.\s*\w+\s*)*\.\s*(?:skip|todo|failing)\s*[(`]/,
  /\b(?:it|test|describe|bench)\s*(?:\.\s*\w+\s*)*\[\s*['"`](?:skip|todo|failing)['"`]\s*\]\s*\(/,
  /\bx(?:it|test|describe)\s*\(/,
  /\b(?:it|test|describe)\s*(?:\.\s*\w+\s*)*\.\s*skipIf\s*\(\s*true\s*\)/,
  /\b(?:it|test|describe)\s*(?:\.\s*\w+\s*)*\.\s*runIf\s*\(\s*false\s*\)/,
];
const ONLY = /\b(?:it|test|describe)\s*(?:\.\s*\w+\s*)*\.\s*only\s*[(`]/;
const TEST_DECL = /\b(?:it|test)\s*(?:\.\s*\w+\s*(?:\([^)]*\)\s*)?)*[(`]/;
/** An empty test body asserts nothing while keeping the count intact. */
const EMPTY_BODY = /\b(?:it|test)\s*\(\s*['"`].*?['"`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/;
const TAUTOLOGY = [
  // BOTH sides constant and equal. Checking only the LEFT side flagged
  // `expect(1).toBe(1 + 0)` and would flag `expect(1).toBe(arr.length)` — a
  // legitimate assertion, and the most common honest action there is. Caught by
  // this Brake's own adversarial run, not by review.
  /expect\s*\(\s*(true|false|\d+|'[^']*'|"[^"]*")\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/,
  // A constant asserted for truthiness is a tautology whatever the matcher.
  /expect\s*\(\s*(?:true|[1-9]\d*|'[^']+'|"[^"]+")\s*\)\s*\.\s*toBeTruthy\s*\(\s*\)/,
  /expect\s*\(\s*(?:false|0|''|"")\s*\)\s*\.\s*toBeFalsy\s*\(\s*\)/,
  /expect\s*\(\s*([A-Za-z_$][\w$.]*)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/,
  /expect\s*\(\s*(\w+\([^)]*\))\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/,
  /expect\s*\(\s*\[\s*\]\s*\)\s*\.\s*toEqual\s*\(\s*\[\s*\]\s*\)/,
  /\bassert(?:\.ok)?\s*\(\s*(?:true|1)\s*\)/,
  /\bexpect\s*\.\s*assertions\s*\(\s*0\s*\)/,
];
// Verbs that actually RUN the suite or the linters. Narrowed so an optional
// `node scripts/whatever.mjs || true` is not swept up (review finding M4).
const TEST_VERB = /\b(?:npm\s+(?:run\s+)?test|npm\s+t\b|yarn\s+test|pnpm\s+test|vitest|jest|mocha|tsc\b|eslint|npm\s+run\s+lint)/i;
const NEUTERED = /(?:\|\|\s*(?:true|:|exit\s+0)|;\s*\s*(?:true|:)\s*$|--passWithNoTests)/i;

const git = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const show = (repo, ref, path) => { try { return git(repo, 'show', `${ref}:${path}`); } catch { return null; } };
const listFiles = (repo, ref) => git(repo, 'ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean);

/**
 * The executable part of a line: inline block comments removed, so a leading
 * `/* … *\/` cannot smuggle code past the scanner. Treating any line that
 * STARTS with `/*` as wholly a comment let `/* can't be right *\/ it.skip(…)`
 * through — and worse, it then registered only as a lost test, which is the
 * WAIVABLE finding, so a Tamper-Waiver would have excused the skip after all.
 */
export const codeOf = (l) => {
  const t = String(l).replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
  return !t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : t;
};
const isCode = (l) => codeOf(l) !== '';

/** Live vs skipped test declarations in one file's text. */
export function countTests(text) {
  let live = 0, skipped = 0;
  for (const raw of String(text).split('\n')) {
    const line = codeOf(raw);
    if (!line) continue;
    if (SKIP.some((re) => re.test(line))) { skipped++; continue; }
    if (TEST_DECL.test(line)) live++;
  }
  return { live, skipped };
}

/** The resolved test command surface at a ref: package.json + workflow steps. */
export function commandSurface(repo, ref) {
  const out = { npmTest: null, steps: [] };
  const pkg = show(repo, ref, 'package.json');
  if (pkg) { try { out.npmTest = JSON.parse(pkg).scripts?.test ?? null; } catch { out.npmTest = 'UNPARSEABLE'; } }
  for (const f of listFiles(repo, ref).filter((p) => /^\.github\/workflows\/.*\.ya?ml$/i.test(p))) {
    const text = show(repo, ref, f) ?? '';
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*(?:-\s*)?run:\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      // A `run:` may be a block scalar; take the following indented lines too.
      let body = m[1];
      if (/^[|>]/.test(body.trim())) {
        const ind = lines[i].search(/\S/);
        for (let j = i + 1; j < lines.length && (!lines[j].trim() || lines[j].search(/\S/) > ind); j++) body += '\n' + lines[j];
      }
      if (!TEST_VERB.test(body)) continue;
      // Walk back to the step's `- ` marker to read its guards.
      let guards = '';
      for (let j = i; j >= 0 && j > i - 25; j--) {
        guards = lines[j] + '\n' + guards;
        if (/^\s*-\s+\S/.test(lines[j])) break;
      }
      out.steps.push({
        file: f,
        body: body.replace(/\s+/g, ' ').trim(),
        guarded: /^\s*(?:-\s*)?(?:if|continue-on-error)\s*:/m.test(guards),
      });
    }
  }
  return out;
}

export function inventory(repo, ref) {
  const files = listFiles(repo, ref).filter(isTestFile);
  let live = 0, skipped = 0;
  const byFile = {};
  for (const f of files) {
    const c = countTests(show(repo, ref, f) ?? '');
    byFile[f] = c; live += c.live; skipped += c.skipped;
  }
  return { files: files.length, live, skipped, byFile, cmd: commandSurface(repo, ref) };
}

/**
 * Compare two inventories plus the added lines, and report weakenings.
 * UNWAIVABLE findings are computed first and independently of the waivable
 * ones, so an unrecognised weakening can never launder itself through the
 * waiver (review finding B3).
 */
export function compare(before, after, addedLines = []) {
  const hard = [], soft = [];

  // --- unwaivable: nobody has a good reason to do these ---
  const newSkips = after.skipped - before.skipped;
  if (newSkips > 0) hard.push({ kind: 'skip-added', detail: `${newSkips} more skipped/todo test(s) than at the base — a skipped test is not a passing test` });

  for (const { file, line: raw } of addedLines) {
    const line = codeOf(raw);
    if (!line) continue;
    if (isTestFile(file) && ONLY.test(line)) hard.push({ kind: 'only', detail: `${file}: an .only was added — it silently skips every other test in the file\n    ${line.trim().slice(0, 110)}` });
    if (isTestFile(file) && TAUTOLOGY.some((re) => re.test(line))) hard.push({ kind: 'tautology', detail: `${file}: an assertion was added that holds regardless of what the code does\n    ${line.trim().slice(0, 110)}` });
    if (isTestFile(file) && EMPTY_BODY.test(line)) hard.push({ kind: 'empty-test', detail: `${file}: a test with an EMPTY body was added — it keeps the count and asserts nothing\n    ${line.trim().slice(0, 110)}` });
  }

  // A test step that gained an `if:` or `continue-on-error:` is neutered, and
  // so is one whose command grew a `|| true`. Compared as VALUES, not lines.
  const key = (s) => `${s.file}::${s.body}`;
  const beforeSteps = new Map(before.cmd.steps.map((s) => [key(s), s]));
  for (const s of after.cmd.steps) {
    const was = beforeSteps.get(key(s));
    if (s.guarded && (!was || !was.guarded)) hard.push({ kind: 'step-guarded', detail: `${s.file}: a step that runs tests gained an \`if:\` or \`continue-on-error:\`\n    ${s.body.slice(0, 110)}` });
    if (NEUTERED.test(s.body) && !(was && NEUTERED.test(was.body))) hard.push({ kind: 'step-neutered', detail: `${s.file}: a test command was neutered so it cannot fail\n    ${s.body.slice(0, 110)}` });
  }
  if (before.cmd.npmTest && NEUTERED.test(after.cmd.npmTest ?? '') && !NEUTERED.test(before.cmd.npmTest)) {
    hard.push({ kind: 'script-neutered', detail: `package.json: the \`test\` script was neutered\n    ${after.cmd.npmTest}` });
  }

  // --- waivable: legitimate reasons exist, but say what they are ---
  const lostTests = before.live - after.live;
  if (lostTests > 0) soft.push({ kind: 'tests-removed', detail: `${lostTests} fewer LIVE test(s) than at the base (${before.live} → ${after.live}), across ${before.files} → ${after.files} test file(s)` });
  const lostSteps = before.cmd.steps.length - after.cmd.steps.length;
  if (lostSteps > 0) soft.push({ kind: 'test-step-removed', detail: `${lostSteps} fewer workflow step(s) that run tests` });
  if (before.cmd.npmTest !== null && after.cmd.npmTest !== before.cmd.npmTest) {
    soft.push({ kind: 'test-script-changed', detail: `package.json \`test\` changed:\n    was: ${before.cmd.npmTest}\n    now: ${after.cmd.npmTest}` });
  }
  return { hard, soft };
}

export function addedLinesOf(diff) {
  const out = []; let cur = null;
  for (const line of String(diff).split('\n')) {
    const m = /^\+\+\+ (?:b\/(.+)|\/dev\/null)$/.exec(line);
    if (m) { cur = m[1] ?? null; continue; }
    if (!cur || !line.startsWith('+') || line.startsWith('+++')) continue;
    out.push({ file: cur, line: line.slice(1) });
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const repo = arg('--repo', process.cwd());
  const head = arg('--head', 'HEAD');
  let base = arg('--base', null);
  if (!base) { try { base = git(repo, 'merge-base', 'origin/main', head).trim(); } catch { base = git(repo, 'rev-parse', `${head}^`).trim(); } }

  // FAIL CLOSED on a base we cannot resolve. The first version's CI wiring let a
  // failed fetch collapse the base to HEAD^, silently scanning one commit and
  // printing PASSED — a gate neutered by the very `|| true` it exists to refuse
  // (review finding M1).
  let baseSha, headSha;
  try { baseSha = git(repo, 'rev-parse', '--verify', `${base}^{commit}`).trim(); headSha = git(repo, 'rev-parse', '--verify', `${head}^{commit}`).trim(); }
  catch { console.error(`tamper-check FAILED — cannot resolve base "${base}" or head "${head}". Refusing to report a verdict on an unknown range.`); return 1; }
  if (baseSha === headSha) { console.error(`tamper-check FAILED — base and head are the same commit (${baseSha.slice(0, 7)}). There is nothing to compare, so a PASS here would be meaningless (review finding M2).`); return 1; }

  const before = inventory(repo, baseSha);
  const after = inventory(repo, headSha);
  const added = addedLinesOf(git(repo, 'diff', '--unified=0', `${baseSha}..${headSha}`));
  const msg = (() => { try { return git(repo, 'log', '--format=%B', `${baseSha}..${headSha}`); } catch { return ''; } })();
  const waiver = /^Tamper-Waiver:\s*(.+)$/im.exec(msg)?.[1]?.trim() ?? null;

  const { hard, soft } = compare(before, after, added);

  console.log(`tamper-check: ${baseSha.slice(0, 7)}..${headSha.slice(0, 7)}`);
  console.log(`  live tests ${before.live} → ${after.live} · skipped ${before.skipped} → ${after.skipped} · test files ${before.files} → ${after.files} · test steps ${before.cmd.steps.length} → ${after.cmd.steps.length}`);
  if (waiver) console.log(`  Tamper-Waiver: "${waiver}" (waives removals only — never a skip, a neutered command or a tautology)`);

  const blocking = [...hard, ...(waiver ? [] : soft)];
  if (!blocking.length) { console.log('tamper-check PASSED — the suite was not weakened'); return 0; }
  for (const f of blocking) console.error(`  TAMPER [${f.kind}] ${f.detail}`);
  console.error(`\ntamper-check FAILED (${blocking.length} finding(s)).`);
  if (!waiver && soft.length) console.error('Removing tests or changing the test command can be legitimate. If it is, say why:\n  Tamper-Waiver: <reason>');
  if (hard.length && waiver) console.error('NOTE: a Tamper-Waiver does not excuse the findings above.');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
