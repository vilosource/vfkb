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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
 *     remove tests from the list when they are part of the resolved test command;
 *   * a deleted, renamed or relocated file removes its tests.
 *
 * `vitest list` deliberately omits skipped tasks, so a second COLLECT-ONLY
 * Vitest pass records every declared task and its mode without running bodies.
 * The difference between declared and runnable is the reason a test left. This
 * is semantic data from Vitest itself: comments and decoy strings do not become
 * tasks, while generated `it.each` and template-literal names do.
 */
export function collectTests(repo, ref) {
  const empty = () => ({ ok: false, tests: new Map(), declared: new Map(), detail: '' });
  const nm = join(repo, 'node_modules');
  const vitestBin = join(nm, '.bin', 'vitest');
  if (!existsSync(nm) || !existsSync(vitestBin)) {
    return { ...empty(), detail: `no installed Vitest found at ${vitestBin}. Run \`npm ci\` before tamper-check; collection cannot be inferred by npx.` };
  }

  const wt = mkdtempSync(join(tmpdir(), 'vfkb-tamper-'));
  try {
    git(repo, 'worktree', 'add', '--detach', '--quiet', wt, ref);

    // npm prepends the worktree's node_modules/.bin to lifecycle PATH. Build a
    // local link farm so tests resolve every installed dependency, while our
    // vitest shim can turn the project's real `npm test` invocation into LIST.
    // This preserves positional file filters, -t, --exclude and --project.
    const wtNm = join(wt, 'node_modules');
    mkdirSync(join(wtNm, '.bin'), { recursive: true });
    for (const name of readdirSync(nm)) {
      if (name === '.bin') continue;
      symlinkSync(join(nm, name), join(wtNm, name), 'dir');
    }
    for (const name of readdirSync(join(nm, '.bin'))) {
      if (name === 'vitest') continue;
      symlinkSync(join(nm, '.bin', name), join(wtNm, '.bin', name));
    }

    const listFile = join(wt, '.tamper-vitest-list.json');
    const wrapperFile = join(wtNm, '.bin', 'vitest-wrapper.cjs');
    const wrapper = join(wtNm, '.bin', 'vitest');
    writeFileSync(wrapperFile, String.raw`const { spawnSync } = require('node:child_process');
let args = process.argv.slice(2);
if (args[0] === 'run') args.shift();
// Coverage changes reporting, not selection, and list must not require an
// optional coverage provider merely because the real suite uses one.
args = args.filter((a) => a !== '--coverage' && !a.startsWith('--coverage.'));
const r = spawnSync(process.env.TAMPER_REAL_VITEST, ['list', '--includeTaskLocation', '--json=' + process.env.TAMPER_LIST_FILE, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
`);
    writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${wrapperFile}" "$@"\n`);
    chmodSync(wrapper, 0o755);

    const env = { ...process.env, CI: '1', TAMPER_REAL_VITEST: vitestBin, TAMPER_LIST_FILE: listFile };
    const r = spawnSync('npm', ['test', '--ignore-scripts'], { cwd: wt, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024, env });
    if (r.status !== 0 || !existsSync(listFile)) {
      return { ...empty(), detail: `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-16).join('\n') };
    }
    let list;
    try { list = JSON.parse(readFileSync(listFile, 'utf8')); } catch { return { ...empty(), detail: 'the resolved test command produced unparseable vitest-list JSON' }; }
    // git ALWAYS answers with realpaths and so does vitest, while mkdtempSync
    // hands back whatever the caller spelled — on macOS /var is a symlink to
    // /private/var, so a naive prefix strip produced "/privatesrc/foo.test.ts".
    // The paths then never matched a git path, every vanished test was
    // misclassified as DELETED (waivable) rather than DISABLED (hard), and a
    // Tamper-Waiver silently excused an added skip. Same root cause as brain
    // gotcha on realpath-vs-spelling; strip BOTH spellings.
    const wtReal = (() => { try { return realpathSync(wt); } catch { return wt; } })();
    const strip = (p) => String(p ?? '').replace(`${wtReal}/`, '').replace(`${wt}/`, '');
    const toMap = (items) => {
      const out = new Map(), seen = new Map();
      for (const t of items) {
        const rel = strip(t.file);
        if (rel.startsWith('/')) throw new Error(`could not relativise a collected path: ${t.file} (worktree ${wt} / ${wtReal})`);
        if (/^dist\//.test(rel)) continue;              // build output duplicates src tests
        const identity = `${rel}::${t.name}`;
        const ordinal = (seen.get(identity) ?? 0) + 1;
        seen.set(identity, ordinal);
        out.set(`${identity}::${ordinal}`, { ...t, file: rel, name: t.name });
      }
      return out;
    };
    let tests;
    try { tests = toMap(list); } catch (e) { return { ...empty(), detail: `${e.message}. Refusing to compare paths that may not line up with git's.` }; }

    // Ask Vitest for its collected task graph. Unlike the list formatter, this
    // retains skip/todo tasks and the concrete names generated by `it.each`.
    // Direct specifications for conventional test files deliberately bypass a
    // newly narrowed include/exclude config, while still using the project's
    // transforms, aliases and environment.
    const declaredFile = join(wt, '.tamper-vitest-declared.json');
    const candidates = listFiles(repo, ref).filter((f) => /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(f) && !/^dist\//.test(f));
    const collector = String.raw`
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVitest } from 'vitest/node';
const v = await createVitest('test', { run: true, includeTaskLocation: true, allowOnly: true });
try {
  const specs = await v.globTestSpecifications();
  const present = new Set(specs.map((s) => s.moduleId));
  const project = v.projects[0];
  for (const rel of JSON.parse(process.env.TAMPER_TEST_FILES)) {
    const file = resolve(rel);
    if (!present.has(file)) { specs.push(project.createSpecification(file)); present.add(file); }
  }
  const result = await v.collectTests(specs);
  const out = [];
  for (const mod of result.testModules) for (const test of mod.children.allTests()) {
    out.push({ file: mod.moduleId, name: test.fullName, mode: test.options.mode, location: test.location });
  }
  writeFileSync(process.env.TAMPER_DECLARED_FILE, JSON.stringify(out));
} finally { await v.close(); }
`;
    const dr = spawnSync(process.execPath, ['--input-type=module', '--eval', collector], {
      cwd: wt, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024,
      env: { ...env, TAMPER_TEST_FILES: JSON.stringify(candidates), TAMPER_DECLARED_FILE: declaredFile },
    });
    if (dr.status !== 0 || !existsSync(declaredFile)) {
      return { ...empty(), detail: `Vitest could not collect declared tests:\n${dr.stdout ?? ''}${dr.stderr ?? ''}`.split('\n').slice(-16).join('\n') };
    }
    let declaredList;
    try { declaredList = JSON.parse(readFileSync(declaredFile, 'utf8')); } catch { return { ...empty(), detail: 'Vitest produced unparseable declared-task JSON' }; }
    let declared;
    try { declared = toMap(declaredList); } catch (e) { return { ...empty(), detail: `${e.message}. Refusing to compare paths that may not line up with git's.` }; }

    return { ok: true, tests, declared, detail: '' };
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
export function compare(before, after) {
  const hard = [], soft = [];
  const B = before.collected.tests, A = after.collected.tests;

  const goneKeys = [...B.keys()].filter((k) => !A.has(k));
  const afterNames = new Set([...A.values()].map((t) => t.name));

  const identity = (t) => `${t.file}::${t.name}`;
  const counts = (m) => {
    const out = new Map();
    for (const t of m.values()) out.set(identity(t), (out.get(identity(t)) ?? 0) + 1);
    return out;
  };
  const disabledCounts = (inv) => {
    const declared = counts(inv.collected.declared), runnable = counts(inv.collected.tests), out = new Map();
    for (const [id, n] of declared) if (n > (runnable.get(id) ?? 0)) out.set(id, n - (runnable.get(id) ?? 0));
    return out;
  };
  const beforeDisabled = disabledCounts(before), afterDisabled = disabledCounts(after);
  const newlyDisabled = [];
  for (const t of after.collected.declared.values()) {
    const id = identity(t);
    const added = (afterDisabled.get(id) ?? 0) - (beforeDisabled.get(id) ?? 0);
    if (added > newlyDisabled.filter((x) => identity(x) === id).length) newlyDisabled.push(t);
  }

  // Per-file COLLECTED counts distinguish an enabled rename (one name out and
  // one name in) from a deletion. Disabled tasks were already identified from
  // Vitest's declared-vs-runnable sets above, before this count-neutral rule.
  const perFile = (m) => { const c = {}; for (const t of m.values()) c[t.file] = (c[t.file] ?? 0) + 1; return c; };
  const bFiles = perFile(B), aFiles = perFile(A);

  const disabled = [...newlyDisabled], deleted = [], moved = [];
  const disabledAtHead = new Map(afterDisabled);
  for (const k of goneKeys) {
    const t = B.get(k);
    const id = identity(t);
    if ((disabledAtHead.get(id) ?? 0) > 0) {
      disabledAtHead.set(id, disabledAtHead.get(id) - 1);
      continue;
    }
    if (afterNames.has(t.name)) { moved.push(t); continue; }        // same test, new file
    if ((aFiles[t.file] ?? 0) >= (bFiles[t.file] ?? 0)) { moved.push(t); continue; }  // renamed in place
    deleted.push(t);
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

  const { hard, soft, stats } = compare(before, after);

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
