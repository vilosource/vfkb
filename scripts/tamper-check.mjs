#!/usr/bin/env node
// ============================================================================
// TAMPER DETECTION (P12-a, ADR-0075 clause 3 / RFC-039 D8).
//
// Did this change make the test suite smaller or quieter? That is the ONLY
// question this answers, and the scope is narrow by operator ruling after five
// adversarial review rounds found 21, 10, 7, 3 and 8 defeat areas against
// successively larger versions.
//
// ── WHAT IT DOES ────────────────────────────────────────────────────────────
// Two observations at the merge BASE and at the HEAD, both from vitest itself
// rather than from parsing:
//   1. COLLECTED — `vitest list` plus a collect-only task-graph pass. Catches
//      every static skip spelling (.skip, .concurrent.skip, ['skip'],
//      .skipIf(true), .todo, xit, split across lines), config `exclude`s,
//      `-t` narrowing, deletions, and files renamed out of the test glob.
//   2. ACTUALLY RAN — a real `vitest run`. Collection CANNOT see a runtime
//      skip: vitest lists a test that calls ctx.skip(). Review round 5 showed
//      the worst case — a two-line setupFiles change silences the entire suite,
//      exits 0, and a collection-only gate called it unweakened.
//
// ── WHAT WAS DELETED, AND WHY THAT IS THE POINT ─────────────────────────────
// A whole workflow/`package.json` command-integrity half used to live here. It
// was hand-written regex over YAML and shell text, it survived three rewrites of
// the OTHER half untouched, and round 5 defeated it six ways (`vitest run | cat`,
// `npm test &`, job-level `if: false`, changing `on:` to workflow_dispatch…).
// A parse layer that cannot model a shell cannot be patched into modelling one,
// and shipping it would be advertising coverage that is not there. It is gone
// rather than green.
//
// THE `Tamper-Waiver:` TRAILER IS ALSO GONE. It leaked in FOUR consecutive
// rounds by four different routes, for one structural reason: free text in a
// commit message is writable by exactly the party being checked. There is now no
// self-service escape. A weakening that is legitimate is recorded where
// accountability already exists — an ADR-0052 review-record finding with
// `status: "accepted"` and an `acceptedBy` naming someone in reviews/OPERATORS,
// a file an agent may never add itself to.
//
// ── WHAT IT DELIBERATELY DOES NOT CATCH ─────────────────────────────────────
// Stated, because a gate that overstates its reach is read as coverage it does
// not have — which is what the deleted half was doing.
//   * Neutered CI wiring (`|| true`, `if: false`, a rewritten test script).
//     Not attempted any more. Review's job.
//   * A test weakened without changing what runs — a laxer assertion, a
//     try/catch. A counter cannot see it.
//   * An adversary who detects the gate. Collection and the run happen in a
//     temp worktree with distinctive env; a test that WANTS to behave
//     differently under observation can. No in-repo measurement closes this.
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
const git = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const show = (repo, ref, path) => { try { return git(repo, 'show', `${ref}:${path}`); } catch { return null; } };
const listFiles = (repo, ref) => git(repo, 'ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean);

/** Git's own rename pairs for the compared tree states (NUL-safe for paths). */
export function renamedFiles(repo, base, head) {
  const fields = git(repo, 'diff', '--name-status', '-z', '--find-renames', base, head, '--').split('\0');
  const out = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++];
    if (/^R\d+$/.test(status)) out.push({ from: fields[i++], to: fields[i++] });
    else if (/^C\d+$/.test(status)) i += 2;
    else i += 1;
  }
  return out;
}

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
export function collectTests(repo, ref, extraCandidates = []) {
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
    const filesAtRef = new Set(listFiles(repo, ref));
    const candidates = [...new Set([
      ...[...filesAtRef].filter((f) => /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(f)),
      ...extraCandidates.filter((f) => filesAtRef.has(f)),
    ])].filter((f) => !/^dist\//.test(f));
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
/**
 * How many tests ACTUALLY RAN, from a real `vitest run`.
 *
 * Collection cannot see a runtime skip, and that is not a bug to patch — it is
 * the limit of what collection means. `vitest list` omits STATICALLY skipped
 * tasks (which is what the collection inventory rests on) but happily lists a
 * test that calls `ctx.skip()` at runtime. Review round 5 showed the worst case:
 * a two-line `setupFiles` with `beforeEach((ctx) => ctx.skip())` silences the
 * ENTIRE suite, `vitest run` exits 0 with every test reported skipped, and a
 * collection-only gate printed "the suite was not weakened".
 *
 * So the suite is actually RUN at both refs and the counts compared. It is the
 * only observation that sees this family, and it costs a full test run per ref —
 * accepted, because the alternative is a gate blind to the cheapest total
 * shutdown available.
 */
export function runCounts(repo, ref) {
  const wt = mkdtempSync(join(tmpdir(), 'vfkb-inv-'));
  try {
    git(repo, 'worktree', 'add', '--detach', '--quiet', wt, ref);
    const nm = join(repo, 'node_modules');
    if (!existsSync(nm)) return { ok: false, detail: 'no node_modules to borrow — run `npm ci` before this gate' };
    if (!existsSync(join(wt, 'node_modules'))) symlinkSync(nm, join(wt, 'node_modules'), 'dir');
    const report = join(wt, '.run-report.json');
    const r = spawnSync('npx', ['vitest', 'run', '--reporter=json', '--outputFile', report], {
      cwd: wt, encoding: 'utf8', timeout: 20 * 60_000, env: { ...process.env, CI: '1' },
    });
    if (!existsSync(report)) {
      const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').slice(-12).join('\n');
      return { ok: false, detail: `vitest run produced no report (exit ${r.status})\n${tail}` };
    }
    try {
      const j = JSON.parse(readFileSync(report, 'utf8'));
      return { ok: true, total: j.numTotalTests ?? 0, passed: j.numPassedTests ?? 0, failed: j.numFailedTests ?? 0, skipped: (j.numPendingTests ?? 0) + (j.numTodoTests ?? 0) };
    } catch { return { ok: false, detail: 'vitest run produced unparseable JSON' }; }
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', wt); } catch { /* best effort */ }
    rmSync(wt, { recursive: true, force: true });
  }
}

export function inventory(repo, ref, extraCandidates = []) {
  return { collected: collectTests(repo, ref, extraCandidates), run: runCounts(repo, ref) };
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
export function compare(before, after, renames = []) {
  const findings = [];
  const B = before.collected.tests, A = after.collected.tests;

  const goneKeys = [...B.keys()].filter((k) => !A.has(k));
  const afterNames = new Set([...A.values()].map((t) => t.name));

  const identity = (t, file = t.file) => `${file}::${t.name}`;
  const counts = (m, normalizeFile = (f) => f) => {
    const out = new Map();
    for (const t of m.values()) {
      const id = identity(t, normalizeFile(t.file));
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  };
  const disabledCounts = (inv, normalizeFile) => {
    const declared = counts(inv.collected.declared, normalizeFile), runnable = counts(inv.collected.tests, normalizeFile), out = new Map();
    for (const [id, n] of declared) if (n > (runnable.get(id) ?? 0)) out.set(id, n - (runnable.get(id) ?? 0));
    return out;
  };
  // A rename changes the path component of task identity. Normalize HEAD's
  // destination back to its BASE source so an existing skip merely moved does
  // not look newly disabled. Git supplies the path relationship; Vitest still
  // supplies the authoritative declared-vs-runnable state at the destination.
  const sourceForDestination = new Map(renames.map((r) => [r.to, r.from]));
  const normalizeAfterFile = (file) => sourceForDestination.get(file) ?? file;
  const beforeDisabled = disabledCounts(before), afterDisabled = disabledCounts(after, normalizeAfterFile);
  const newlyDisabled = [];
  const emittedDisabled = new Map();
  for (const t of after.collected.declared.values()) {
    const id = identity(t, normalizeAfterFile(t.file));
    const added = (afterDisabled.get(id) ?? 0) - (beforeDisabled.get(id) ?? 0);
    if (added > (emittedDisabled.get(id) ?? 0)) {
      newlyDisabled.push(t);
      emittedDisabled.set(id, (emittedDisabled.get(id) ?? 0) + 1);
    }
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
    findings.push({
      kind: 'tests-disabled',
      detail: `${disabled.length} test(s) are still written but no longer RUN — skipped, excluded or filtered out:\n    ` +
        disabled.slice(0, 5).map((t) => `${t.file} › ${t.name}`).join('\n    ') + (disabled.length > 5 ? `\n    …and ${disabled.length - 5} more` : ''),
    });
  }
  if (deleted.length) {
    findings.push({
      kind: 'tests-removed',
      detail: `${deleted.length} test(s) no longer exist anywhere:\n    ` +
        deleted.slice(0, 5).map((t) => `${t.file} › ${t.name}`).join('\n    ') + (deleted.length > 5 ? `\n    …and ${deleted.length - 5} more` : ''),
    });
  }

  // A test that no longer RUNS is weakening, whatever made it stop — a runtime
  // ctx.skip(), a setupFile, a config change. Collection cannot see any of it.
  const bRun = before.run, aRun = after.run;
  if (bRun?.ok && aRun?.ok) {
    if (aRun.passed < bRun.passed) findings.push({ kind: 'fewer-tests-ran', detail: `${bRun.passed - aRun.passed} fewer test(s) actually RAN (${bRun.passed} → ${aRun.passed} passed). Collection cannot see a runtime skip; this can.` });
    if (aRun.skipped > bRun.skipped) findings.push({ kind: 'more-tests-skipped', detail: `${aRun.skipped - bRun.skipped} more test(s) were SKIPPED AT RUNTIME (${bRun.skipped} → ${aRun.skipped}) — e.g. a ctx.skip(), a setupFile, or a config change` });
  }

  return { findings, stats: { before: B.size, after: A.size, disabled: disabled.length, deleted: deleted.length, moved: moved.length } };
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
    console.error(`tamper-check FAILED — cannot resolve base "${base}" or head "${head}".`);
    return 1;
  }
  if (baseSha === headSha) { console.error(`tamper-check FAILED — base and head are the same commit (${baseSha.slice(0, 7)}); a PASS here would be meaningless.`); return 1; }

  const before = inventory(repo, baseSha);
  const after = inventory(repo, headSha);
  for (const [label, inv] of [['base', before], ['head', after]]) {
    if (!inv.collected.ok) {
      console.error(`tamper-check FAILED — vitest could not collect tests at the ${label}. That is not a pass; it is a broken comparison.`);
      console.error(inv.collected.detail);
      return 1;
    }
  }
  if (before.collected.tests.size === 0) { console.error('tamper-check FAILED — the BASE collected zero tests, so nothing can be compared against it.'); return 1; }
  for (const [label, inv] of [['base', before], ['head', after]]) {
    if (!inv.run?.ok) {
      console.error(`tamper-check FAILED — the suite could not be RUN at the ${label}. A run that did not happen is not evidence that nothing was weakened.`);
      console.error(inv.run?.detail ?? '');
      return 1;
    }
  }

  const { findings, stats } = compare(before, after);

  console.log(`tamper-check: ${baseSha.slice(0, 7)}..${headSha.slice(0, 7)}`);
  console.log(`  collected ${stats.before} → ${stats.after} · no longer collected ${stats.disabled + stats.deleted} · moved ${stats.moved}`);
  console.log(`  ACTUALLY RAN ${before.run.passed} → ${after.run.passed} passed · ${before.run.skipped} → ${after.run.skipped} skipped`);

  if (!findings.length) { console.log('tamper-check PASSED — the suite was not weakened'); return 0; }
  for (const f of findings) console.error(`  TAMPER [${f.kind}] ${f.detail}`);
  console.error(`\ntamper-check FAILED (${findings.length} finding(s)).`);
  console.error('');
  console.error('THERE IS NO COMMIT-TRAILER WAIVER. A free-text trailer is writable by anyone,');
  console.error('including the agent whose work is being checked, and it leaked in four');
  console.error('consecutive review rounds by four different routes. If this weakening is');
  console.error('legitimate, record it where accountability already exists: an ADR-0052 review');
  console.error('record finding with `status: "accepted"` and an `acceptedBy` naming someone in');
  console.error('reviews/OPERATORS. An agent may not add itself to that file.');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
