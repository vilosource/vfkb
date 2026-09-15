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
// ── WHAT THIS DELIBERATELY DOES NOT CATCH ───────────────────────────────────
// Stated rather than implied, because a gate that overstates its reach is read
// as coverage it does not have. Weakening a test WITHOUT changing any count or
// name is invisible here: an early `return` in a body, an assertion swapped for
// a laxer one, a `try{}catch{}` wrapper, or deleting one real test and adding
// one junk test inside the SAME file. Those are review's job (ADR-0052), not a
// counter's. This Brake answers one narrow question — did the change make the
// suite smaller, quieter, or unable to fail — and nothing beyond it.
//
//   node scripts/tamper-check.mjs [--base <ref>] [--head <ref>] [--repo <dir>]
// ============================================================================
import { execFileSync } from 'node:child_process';

export const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(f) || /^(test|tests|scenarios)\//i.test(f) || /(^|\/)__tests__\//i.test(f);

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
const ONLY = [
  /\b(?:it|test|describe)\s*(?:\.\s*\w+\s*)*\.\s*only\s*[(`]/,
  /\b(?:it|test|describe)\s*(?:\.\s*\w+\s*)*\[\s*['"`]only['"`]\s*\]\s*\(/,
];
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
const TEST_VERB = /\b(?:(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:test|verify|check|lint)\b|npm\s+t\b|npx\s+\S*(?:vitest|jest|mocha)|vitest|jest|mocha|bun\s+test|make\s+test|tsc\b|eslint)|\.\/(?:scripts\/)?\S*test\S*\.(?:sh|mjs|js)/i;
// ANY `||` swallows the failure — `|| true`, `|| :`, `|| exit 0`, `|| echo
// skipped` are the same act. Applied PER COMMAND rather than to the whole step,
// so a legitimate `npm ci || npm install` line sitting above `npm test` in the
// same block scalar is not swept up.
const NEUTERED_CMD = /(?:\|\||;\s*(?:true|:)\s*$|--passWithNoTests|\bset\s+\+e\b)/i;
export const isNeutered = (body) => {
  const text = String(body);
  // `set +e` is STEP-scoped, not command-scoped: GitHub runs `run:` under
  // `bash -e`, so one `set +e` anywhere above disarms every command below it.
  if (/\bset\s+\+e\b/.test(text) && TEST_VERB.test(text)) return true;
  return text
    .split(/\n|&&|(?<!\|)\|(?!\|)/)
    .some((seg) => TEST_VERB.test(seg) && NEUTERED_CMD.test(seg));
};

const git = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const show = (repo, ref, path) => { try { return git(repo, 'show', `${ref}:${path}`); } catch { return null; } };
const listFiles = (repo, ref) => git(repo, 'ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean);

/**
 * Strip comments AND string literals from a whole FILE, preserving line
 * structure. File-stateful by necessity: a line-local version was defeated twice
 * over — `/* … *\/ it.skip(…)` slipped past when a leading `/*` marked the whole
 * line a comment, and then a MULTI-LINE block comment wrapping seven real tests
 * left them all still counted, because no single line looked like a comment.
 *
 * String-aware for the opposite reason: without it, a unit test for THIS Brake
 * becomes unmergeable, since any file quoting `"it.skip('x')"` as test data
 * registers a skip it does not have. A previous version deleted the string
 * handling and its selftest then pinned that false positive as correct.
 */
export function stripNonCode(text) {
  const out = [];
  let inBlock = false;
  for (const raw of String(text).split('\n')) {
    let line = '';
    let i = 0;
    while (i < raw.length) {
      if (inBlock) {
        const end = raw.indexOf('*/', i);
        if (end === -1) { i = raw.length; } else { inBlock = false; i = end + 2; }
        continue;
      }
      const ch = raw[i];
      if (ch === '/' && raw[i + 1] === '*') { inBlock = true; i += 2; continue; }
      if (ch === '/' && raw[i + 1] === '/') break;                       // rest is a comment
      if (ch === '"' || ch === "'" || ch === '`') {                      // skip the literal
        let j = i + 1;
        while (j < raw.length && raw[j] !== ch) j += raw[j] === '\\' ? 2 : 1;
        line += ch + ch;                                                  // keep an empty literal
        i = j + 1;
        continue;
      }
      line += ch;
      i += 1;
    }
    out.push(line);
  }
  return out;
}

/** Live vs skipped test declarations in one file's text. */
export function countTests(text) {
  let live = 0, skipped = 0;
  const names = [];
  for (const line of stripNonCode(text)) {
    if (!line.trim()) continue;
    if (SKIP.some((re) => re.test(line))) { skipped++; continue; }
    if (TEST_DECL.test(line)) {
      live++;
      // Names are what tell a MOVE from a count-neutral SWAP: moving a test
      // keeps its name somewhere, deleting one and adding junk does not. The
      // literal is stripped by stripNonCode, so read it from the raw line.
      const n = /\b(?:it|test)\s*(?:\.\s*\w+\s*(?:\([^)]*\)\s*)?)*\(\s*(['"`])([\s\S]*?)\1/.exec(
        String(text).split('\n')[stripNonCode(text).indexOf(line)] ?? '',
      );
      if (n) names.push(n[2]);
    }
  }
  return { live, skipped, names };
}

/**
 * Workflow steps that actually run tests, parsed as BLOCKS.
 *
 * The previous version walked BACKWARDS from the `run:` line to the nearest
 * `- ` marker and read guards from what it passed. That misses the only shape
 * this repo actually uses — `      - run: npm test`, where the marker IS the run
 * line, so the walk read one line and never looked below it. Appending
 * `continue-on-error: true` underneath was invisible. It could also inherit a
 * guard from an ADJACENT step and raise a false positive. A step is a block;
 * read the whole block.
 */
export function workflowSteps(text, file) {
  const lines = String(text).split('\n');
  const steps = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)-\s/.exec(lines[i]);
    if (!m) continue;
    const ind = m[1].length;
    const block = [lines[i]];
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) { block.push(lines[j]); continue; }
      const cur = lines[j].search(/\S/);
      if (cur <= ind) break;              // next step, or dedent out of the list
      block.push(lines[j]);
    }
    const text2 = block.join('\n');
    const runs = [...text2.matchAll(/(?:^|\n)\s*(?:-\s*)?(?:run|uses)\s*:\s*([\s\S]*?)(?=\n\s*\w[\w-]*\s*:|$)/g)]
      .map((x) => x[1].trim());
    const body = runs.join(' ; ').replace(/\s+/g, ' ').trim();
    if (!TEST_VERB.test(body)) continue;
    steps.push({
      file,
      body: body.slice(0, 400),
      raw: runs.join('\n').slice(0, 800),
      // Guards read from ANYWHERE in the step block, not from a backward walk.
      guarded: /(?:^|\n)\s*(?:-\s*)?(?:if|continue-on-error)\s*:/.test(text2),
    });
  }
  return steps;
}

/** The resolved test command surface at a ref: package.json + workflow steps. */
export function commandSurface(repo, ref) {
  const out = { npmTest: null, steps: [], excludes: [] };
  const pkg = show(repo, ref, 'package.json');
  if (pkg) { try { out.npmTest = JSON.parse(pkg).scripts?.test ?? null; } catch { out.npmTest = 'UNPARSEABLE'; } }
  for (const f of listFiles(repo, ref)) {
    if (/^\.github\/workflows\/.*\.ya?ml$/i.test(f)) out.steps.push(...workflowSteps(show(repo, ref, f) ?? '', f));
    // A test-runner config can exclude whole files without changing any count.
    if (/^(vitest|vite|jest)\.config\.[cm]?[jt]s$/i.test(f)) {
      const t = show(repo, ref, f) ?? '';
      for (const x of t.matchAll(/exclude\s*:\s*\[([^\]]*)\]/g)) out.excludes.push(`${f}: ${x[1].replace(/\s+/g, ' ').trim()}`);
    }
  }
  return out;
}

export function inventory(repo, ref) {
  const files = listFiles(repo, ref).filter(isTestFile);
  let live = 0, skipped = 0;
  const byFile = {};
  const allNames = new Set();
  for (const f of files) {
    const c = countTests(show(repo, ref, f) ?? '');
    byFile[f] = c; live += c.live; skipped += c.skipped;
    for (const n of c.names ?? []) allNames.add(n);
  }
  return { files: files.length, live, skipped, byFile, names: allNames, cmd: commandSurface(repo, ref) };
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
    // Added lines arrive out of file context, so block-comment state is unknown.
    // Strip what CAN be stripped line-locally; the file-stateful scanner owns
    // the counts, and these line checks only ever ADD hard findings.
    const [line = ''] = stripNonCode(raw);
    if (!line.trim()) continue;
    if (isTestFile(file) && ONLY.some((re) => re.test(line))) hard.push({ kind: 'only', detail: `${file}: an .only was added — it silently skips every other test in the file\n    ${line.trim().slice(0, 110)}` });
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
    if (isNeutered(s.raw ?? s.body) && !(was && isNeutered(was.raw ?? was.body))) hard.push({ kind: 'step-neutered', detail: `${s.file}: a test command was neutered so it cannot fail\n    ${s.body.slice(0, 110)}` });
  }

  // Replacing the test script with something that no longer RUNS TESTS is not a
  // "change" to be waived — it is the same act as `|| true`, spelled
  // differently. The waiver's printed scope says it never excuses a neutered
  // command; this is what makes that true rather than merely stated.
  const wasCmd = before.cmd.npmTest, nowCmd = after.cmd.npmTest;
  if (wasCmd && TEST_VERB.test(wasCmd)) {
    if (nowCmd === null) hard.push({ kind: 'script-removed', detail: 'package.json: the `test` script was DELETED' });
    else if (!TEST_VERB.test(nowCmd)) hard.push({ kind: 'script-neutered', detail: `package.json: the \`test\` script no longer runs any test command\n    was: ${wasCmd}\n    now: ${nowCmd}` });
    else if (isNeutered(nowCmd) && !isNeutered(wasCmd)) hard.push({ kind: 'script-neutered', detail: `package.json: the \`test\` script was neutered\n    ${nowCmd}` });
  }
  // Losing the LAST step that runs tests leaves nothing running. Waiving that
  // would waive the whole suite.
  if (before.cmd.steps.length > 0 && after.cmd.steps.length === 0) {
    hard.push({ kind: 'all-test-steps-removed', detail: 'every workflow step that runs tests was removed' });
  }
  // A runner config can exclude whole files without moving any count.
  for (const x of after.cmd.excludes) {
    if (!before.cmd.excludes.includes(x)) hard.push({ kind: 'tests-excluded', detail: `a test-runner exclusion was added — files can vanish from the run with every count unchanged\n    ${x}` });
  }

  // --- waivable: legitimate reasons exist, but say what they are ---
  const lostTests = before.live - after.live;
  if (lostTests > 0) soft.push({ kind: 'tests-removed', detail: `${lostTests} fewer LIVE test(s) than at the base (${before.live} → ${after.live}), across ${before.files} → ${after.files} test file(s)` });

  // PER-FILE, and by NAME. `byFile` was computed and thrown away, so deleting a
  // real test file while adding the same number of junk passing tests kept the
  // total level and passed clean. Counting per file alone would then flag an
  // honest MOVE, so what is reported is tests whose names left the repo
  // entirely — a move keeps its names, a swap does not.
  const afterNames = after.names ?? new Set();
  for (const [file, was] of Object.entries(before.byFile)) {
    const now = after.byFile[file];
    // A file whose live COUNT held is not losing tests — renaming a test title
    // makes its old name vanish too, and blocking that is blocking honest work.
    // The count says whether tests left; the NAMES then say whether they left
    // the repo (a real removal) or merely moved (still present elsewhere).
    if (now && now.live >= was.live) continue;
    const gone = (was.names ?? []).filter((n) => !afterNames.has(n));
    if (gone.length) {
      soft.push({ kind: 'file-tests-removed', detail: `${file}: ${gone.length} test(s) no longer exist anywhere${now ? '' : ' (file gone)'} — e.g. "${gone.slice(0, 3).join('", "')}"` });
    }
  }

  const lostSteps = before.cmd.steps.length - after.cmd.steps.length;
  if (lostSteps > 0 && after.cmd.steps.length > 0) soft.push({ kind: 'test-step-removed', detail: `${lostSteps} fewer workflow step(s) that run tests` });
  // A test script that CHANGED but still runs tests and is not neutered is
  // ordinary work — adding `--coverage` is the obvious case. The dangerous
  // shapes (removed, neutered, no longer a test command) are all HARD above, so
  // reporting this as a finding only blocked honest changes.
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
  if (waiver) console.log(`  Tamper-Waiver: "${waiver}" — waives REMOVALS only. Skips, neutered or deleted test commands, exclusions and tautologies are never waived.`);

  const blocking = [...hard, ...(waiver ? [] : soft)];
  if (!blocking.length) { console.log('tamper-check PASSED — the suite was not weakened'); return 0; }
  for (const f of blocking) console.error(`  TAMPER [${f.kind}] ${f.detail}`);
  console.error(`\ntamper-check FAILED (${blocking.length} finding(s)).`);
  if (!waiver && soft.length) console.error('Removing tests or changing the test command can be legitimate. If it is, say why:\n  Tamper-Waiver: <reason>');
  if (hard.length && waiver) console.error('NOTE: a Tamper-Waiver does not excuse the findings above.');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
