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
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(f) || /^(test|tests|scenarios)\//i.test(f) || /(^|\/)__tests__\//i.test(f);

// A skipped test in every spelling review found evading the first version:
// .skip/.todo/.failing, chained (.concurrent.skip), bracket access, x-prefix,
// and the conditional forms whose condition is a constant.
/** An empty test body asserts nothing while keeping the count intact. */
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
 * THE TEST INVENTORY COMES FROM VITEST, NOT FROM PARSING.
 *
 * Three review rounds killed three successive hand-written scanners. The last
 * one's remaining defeats all reduced to one root cause — counting and
 * pattern-matching over hand-stripped LINES of JavaScript — and no amount of
 * further regex patching fixes a scanner that cannot tell a regex literal from
 * a string. It failed in both directions at once: `it['skip']` became
 * unreachable dead code, one `/['"]/` blinded the rest of the line, and the
 * name tracker collapsed 577 real test names into 66 distinct ones.
 *
 * So the scanner is gone. `vitest list --json` reports every test it actually
 * COLLECTS, with its full `describe > it` name. That is authoritative by
 * construction, and it dissolves whole classes of defeat rather than patching
 * them — verified against vitest 4.1.11:
 *   * a SKIPPED test is not collected, in every spelling (.skip, .concurrent
 *     .skip, .todo, .skipIf(true), xit, bracket access) — so a skip is simply a
 *     test that left the list, and there is nothing left to pattern-match;
 *   * a `vitest.config` `exclude`, an `include` narrowing, and a `-t` filter all
 *     remove tests from the list;
 *   * a deleted, renamed or relocated file removes its tests.
 *
 * What the list cannot tell us is WHY a test left. A name that still appears in
 * the file's source was disabled (hard); a name gone from the tree was deleted
 * (waivable). That is one substring test on raw source — no parsing, no state.
 */
export function collectTests(repo, ref) {
  const wt = mkdtempSync(join(tmpdir(), 'vfkb-tamper-'));
  try {
    git(repo, 'worktree', 'add', '--detach', '--quiet', wt, ref);
    const nm = join(repo, 'node_modules');
    if (existsSync(nm) && !existsSync(join(wt, 'node_modules'))) symlinkSync(nm, join(wt, 'node_modules'), 'dir');
    const r = spawnSync('npx', ['vitest', 'list', '--json'], { cwd: wt, encoding: 'utf8', timeout: 10 * 60_000, env: { ...process.env, CI: '1' } });
    const out = `${r.stdout ?? ''}`;
    const start = out.indexOf('[');
    if (start === -1) return { ok: false, tests: new Map(), detail: `${out}${r.stderr ?? ''}`.split('\n').slice(-12).join('\n') };
    let list;
    try { list = JSON.parse(out.slice(start)); } catch { return { ok: false, tests: new Map(), detail: 'vitest list produced unparseable JSON' }; }
    // git ALWAYS answers with realpaths and so does vitest, while mkdtempSync
    // hands back whatever the caller spelled — on macOS /var is a symlink to
    // /private/var, so a naive prefix strip produced "/privatesrc/foo.test.ts".
    // The paths then never matched a git path, every vanished test was
    // misclassified as DELETED (waivable) rather than DISABLED (hard), and a
    // Tamper-Waiver silently excused an added skip. Same root cause as brain
    // gotcha on realpath-vs-spelling; strip BOTH spellings.
    const wtReal = (() => { try { return realpathSync(wt); } catch { return wt; } })();
    const strip = (p) => String(p ?? '').replace(`${wtReal}/`, '').replace(`${wt}/`, '');
    const tests = new Map();
    for (const t of list) {
      const rel = strip(t.file);
      if (rel.startsWith('/')) return { ok: false, tests: new Map(), detail: `could not relativise a collected path: ${t.file} (worktree ${wt} / ${wtReal}). Refusing to compare paths that may not line up with git's.` };
      if (/^dist\//.test(rel)) continue;              // build output duplicates src tests
      tests.set(`${rel}::${t.name}`, { file: rel, name: t.name });
    }
    return { ok: true, tests, detail: '' };
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', wt); } catch { /* best effort */ }
    rmSync(wt, { recursive: true, force: true });
  }
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
  const collected = collectTests(repo, ref);
  return { collected, cmd: commandSurface(repo, ref) };
}

/**
 * Compare two inventories and report weakenings.
 *
 * UNWAIVABLE findings are computed first and independently of the waivable
 * ones. Twice now, an unrecognised weakening fell through to the removal count
 * — the one waivable finding — so `Tamper-Waiver:` silently excused an added
 * skip, the opposite of what the waiver printed about itself. Separating the
 * computation is what makes the printed scope true rather than merely stated.
 */
export function compare(before, after, srcAt) {
  const hard = [], soft = [];
  const B = before.collected.tests, A = after.collected.tests;

  const goneKeys = [...B.keys()].filter((k) => !A.has(k));
  const afterNames = new Set([...A.values()].map((t) => t.name));

  // Per-file COLLECTED counts. A file that still collects as many tests as
  // before has not lost any: one name out and one name in is a RENAME, and the
  // substring check below cannot tell that apart on its own — it reads
  // "alpha" → "alpha renamed" as the old test still being present, i.e.
  // disabled. The count is what separates them, on authoritative data.
  const perFile = (m) => { const c = {}; for (const t of m.values()) c[t.file] = (c[t.file] ?? 0) + 1; return c; };
  const bFiles = perFile(B), aFiles = perFile(A);

  const disabled = [], deleted = [], moved = [];
  for (const k of goneKeys) {
    const t = B.get(k);
    if (afterNames.has(t.name)) { moved.push(t); continue; }        // same test, new file
    if ((aFiles[t.file] ?? 0) >= (bFiles[t.file] ?? 0)) { moved.push(t); continue; }  // renamed in place
    // The file collects FEWER tests than before, and this one's name is still
    // written down => it is still there but no longer runs.
    const src = srcAt(t.file);
    const leaf = t.name.split(' > ').pop() ?? t.name;
    if (src !== null && src.includes(leaf)) disabled.push(t);
    else deleted.push(t);
  }

  if (disabled.length) {
    hard.push({
      kind: 'tests-disabled',
      detail: `${disabled.length} test(s) are still written but no longer RUN — skipped, excluded or filtered out:\n    ` +
        disabled.slice(0, 5).map((t) => `${t.file} › ${t.name}`).join('\n    ') + (disabled.length > 5 ? `\n    …and ${disabled.length - 5} more` : ''),
    });
  }
  if (deleted.length) {
    soft.push({
      kind: 'tests-removed',
      detail: `${deleted.length} test(s) no longer exist anywhere:\n    ` +
        deleted.slice(0, 5).map((t) => `${t.file} › ${t.name}`).join('\n    ') + (deleted.length > 5 ? `\n    …and ${deleted.length - 5} more` : ''),
    });
  }

  // A test step that gained an `if:` or `continue-on-error:` is neutered, and so
  // is one whose command grew a `||`. Compared as VALUES, not lines.
  const key = (s) => `${s.file}::${s.body}`;
  const beforeSteps = new Map(before.cmd.steps.map((s) => [key(s), s]));
  const beforeGuardedAnywhere = before.cmd.steps.some((s) => s.guarded);
  for (const s of after.cmd.steps) {
    const was = beforeSteps.get(key(s));
    // If the body changed, `was` is undefined and a PRE-EXISTING guard would read
    // as newly gained — a false positive review found. Only flag when no step in
    // the base carried a guard at all.
    if (s.guarded && !was && !beforeGuardedAnywhere) hard.push({ kind: 'step-guarded', detail: `${s.file}: a step that runs tests is guarded by \`if:\` or \`continue-on-error:\`\n    ${s.body.slice(0, 110)}` });
    else if (s.guarded && was && !was.guarded) hard.push({ kind: 'step-guarded', detail: `${s.file}: a step that runs tests gained an \`if:\` or \`continue-on-error:\`\n    ${s.body.slice(0, 110)}` });
    if (isNeutered(s.raw ?? s.body) && !(was && isNeutered(was.raw ?? was.body))) hard.push({ kind: 'step-neutered', detail: `${s.file}: a test command was neutered so it cannot fail\n    ${s.body.slice(0, 110)}` });
  }

  const wasCmd = before.cmd.npmTest, nowCmd = after.cmd.npmTest;
  if (wasCmd && TEST_VERB.test(wasCmd)) {
    if (nowCmd === null) hard.push({ kind: 'script-removed', detail: 'package.json: the `test` script was DELETED' });
    else if (!TEST_VERB.test(nowCmd)) hard.push({ kind: 'script-neutered', detail: `package.json: the \`test\` script no longer runs any test command\n    was: ${wasCmd}\n    now: ${nowCmd}` });
    else if (isNeutered(nowCmd) && !isNeutered(wasCmd)) hard.push({ kind: 'script-neutered', detail: `package.json: the \`test\` script was neutered\n    ${nowCmd}` });
  }
  if (before.cmd.steps.length > 0 && after.cmd.steps.length === 0) {
    hard.push({ kind: 'all-test-steps-removed', detail: 'every workflow step that runs tests was removed' });
  }
  const lostSteps = before.cmd.steps.length - after.cmd.steps.length;
  if (lostSteps > 0 && after.cmd.steps.length > 0) soft.push({ kind: 'test-step-removed', detail: `${lostSteps} fewer workflow step(s) that run tests` });

  return { hard, soft, stats: { before: B.size, after: A.size, disabled: disabled.length, deleted: deleted.length, moved: moved.length } };
}

export function main(argv = process.argv.slice(2)) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const repo = arg('--repo', process.cwd());
  const head = arg('--head', 'HEAD');
  let base = arg('--base', null);
  if (!base) { try { base = git(repo, 'merge-base', 'origin/main', head).trim(); } catch { base = null; } }
  if (!base) { console.error('tamper-check FAILED — no base given and no merge-base with origin/main. Refusing to report a verdict on an unknown range.'); return 1; }

  let baseSha, headSha;
  try {
    baseSha = git(repo, 'rev-parse', '--verify', `${base}^{commit}`).trim();
    headSha = git(repo, 'rev-parse', '--verify', `${head}^{commit}`).trim();
  } catch {
    console.error(`tamper-check FAILED — cannot resolve base "${base}" or head "${head}". Refusing to report a verdict on an unknown range.`);
    return 1;
  }
  if (baseSha === headSha) { console.error(`tamper-check FAILED — base and head are the same commit (${baseSha.slice(0, 7)}); a PASS here would be meaningless.`); return 1; }

  const before = inventory(repo, baseSha);
  const after = inventory(repo, headSha);

  // FAIL CLOSED. A collection that did not run proves nothing, and treating it
  // as proof is exactly how the sibling reproduction gate was broken: it read an
  // exit code, so a CRASHED runner read as evidence (ADR-0051 §3).
  for (const [label, inv] of [['base', before], ['head', after]]) {
    if (!inv.collected.ok) {
      console.error(`tamper-check FAILED — vitest could not collect tests at the ${label}. That is not a pass; it is a broken comparison.`);
      console.error(inv.collected.detail);
      return 1;
    }
  }
  if (before.collected.tests.size === 0) { console.error('tamper-check FAILED — the BASE collected zero tests, so nothing can be compared against it.'); return 1; }

  const srcAt = (f) => { try { return git(repo, 'show', `${headSha}:${f}`); } catch { return null; } };
  const { hard, soft, stats } = compare(before, after, srcAt);

  const msg = (() => { try { return git(repo, 'log', '--format=%B', `${baseSha}..${headSha}`); } catch { return ''; } })();
  const waiver = /^Tamper-Waiver:\s*(.+)$/im.exec(msg)?.[1]?.trim() ?? null;

  console.log(`tamper-check: ${baseSha.slice(0, 7)}..${headSha.slice(0, 7)}`);
  console.log(`  tests COLLECTED BY VITEST ${stats.before} → ${stats.after} · disabled ${stats.disabled} · deleted ${stats.deleted} · moved ${stats.moved} · test steps ${before.cmd.steps.length} → ${after.cmd.steps.length}`);
  if (waiver) console.log(`  Tamper-Waiver: "${waiver}" — waives DELETIONS only. Tests that still exist but no longer run, and neutered or removed test commands, are never waived.`);

  const blocking = [...hard, ...(waiver ? [] : soft)];
  if (!blocking.length) { console.log('tamper-check PASSED — the suite was not weakened'); return 0; }
  for (const f of blocking) console.error(`  TAMPER [${f.kind}] ${f.detail}`);
  console.error(`\ntamper-check FAILED (${blocking.length} finding(s)).`);
  if (!waiver && soft.length) console.error('Deleting a genuinely obsolete test is legitimate. If that is what this is, say why:\n  Tamper-Waiver: <reason>');
  if (hard.length && waiver) console.error('NOTE: a Tamper-Waiver does not excuse the findings above.');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
