#!/usr/bin/env node
// ============================================================================
// REPRODUCTION GATE (P12-a, ADR-0075 clause 3 / RFC-039 D8).
//
// A fix must be able to prove the bug existed. This Brake checks out the merge
// base, drops the branch's NEW test files into it, runs them, and requires that
// at least one newly-added test FAILS there — the mechanical form of "observed
// red before green" (ADR-0070 §1), applied to work an agent produced rather
// than to a guard a human wrote.
//
// SCOPE IS THE WHOLE DESIGN HERE, because the naive rule is wrong. NOT every new
// test is a regression test: adding coverage for behaviour that already works is
// honest, valuable, and passes at the merge base by definition. A gate demanding
// every new test go red would block exactly that, and a gate that blocks honest
// work is a defect (ADR-0052). So the rule is narrower and matches what a fix
// actually claims:
//
//   IF the diff changes src/ AND adds test cases,
//   THEN at least ONE added test must fail at the merge base.
//
// A pure refactor that adds coverage trips this legitimately, so there is a real
// escape: a `Reproduction-Waiver: <reason>` commit trailer. Same shape as
// tamper-check's, and for the same reason — it forces the claim into a durable
// place instead of letting an unproven fix through quietly.
//
//   node scripts/reproduction-gate.mjs [--base <ref>] [--head <ref>]
// ============================================================================
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

export const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(f) && /(^|\/)test(s)?\//i.test(f);
export const isSrcFile = (f) => /^src\//i.test(f);

/** Added test declarations per file, from a unified diff. */
export function addedTests(diff) {
  const out = new Map();
  let cur = null;
  for (const line of String(diff).split('\n')) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) { cur = m[1]; continue; }
    if (!cur || !line.startsWith('+') || line.startsWith('+++')) continue;
    if (!isTestFile(cur)) continue;
    const t = line.slice(1).trim();
    if (t.startsWith('//') || t.startsWith('*')) continue;
    // A declaration that will actually RUN. `.skip` is tamper-check's problem.
    if (/\b(?:it|test)\s*(?:\.\s*(?:concurrent|sequential|each|for)\s*)*\(/.test(t)) {
      out.set(cur, (out.get(cur) ?? 0) + 1);
    }
  }
  return out;
}

export function changedFiles(diff) {
  return [...String(diff).matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
}

const git = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });

/**
 * Run the given test files at `base`, with each file's HEAD content, and report
 * whether anything failed. Returns {ran, failed, detail}.
 */
export function runAtBase(repo, base, head, files) {
  const wt = mkdtempSync(join(tmpdir(), 'vfkb-repro-'));
  try {
    git(repo, 'worktree', 'add', '--detach', '--quiet', wt, base);
    // The base worktree has no deps of its own; borrow the checkout's.
    const nm = join(repo, 'node_modules');
    if (existsSync(nm) && !existsSync(join(wt, 'node_modules'))) symlinkSync(nm, join(wt, 'node_modules'), 'dir');

    for (const f of files) {
      const dest = join(wt, f);
      mkdirSync(dirname(dest), { recursive: true });
      // The NEW test, against the OLD source.
      const content = execFileSync('git', ['-C', repo, 'show', `${head}:${f}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      writeFileSync(dest, content);
    }

    // A NON-ZERO EXIT IS NOT PROOF. vitest exits non-zero when a test fails AND
    // when it cannot start at all — a bad flag, a missing dep, a module that
    // will not resolve against the old tree. Reading the exit code alone makes
    // a CRASHED runner look like a demonstrated bug, which is the ADR-0051 §3
    // quiet-success trap inside the gate that exists to enforce it. (Observed:
    // an invalid `--reporter` made every run "prove" the fix.) So the verdict
    // comes from COUNTED TEST RESULTS, and anything else is INCONCLUSIVE.
    const report = join(wt, '.repro-report.json');
    const r = spawnSync('npx', ['vitest', 'run', '--reporter=json', '--outputFile', report, ...files], {
      cwd: wt, encoding: 'utf8', timeout: 10 * 60_000,
      env: { ...process.env, CI: '1' },
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const tail = out.split('\n').slice(-25).join('\n');

    let counts = null;
    try {
      if (existsSync(report)) {
        const j = JSON.parse(readFileSync(report, 'utf8'));
        counts = { total: j.numTotalTests ?? 0, failed: j.numFailedTests ?? 0, passed: j.numPassedTests ?? 0 };
      }
    } catch { /* falls through to inconclusive */ }

    if (!counts || counts.total === 0) {
      return { ran: false, failed: false, counts, detail: `the runner produced no countable results (exit ${r.status}).\n${tail}` };
    }
    return { ran: true, failed: counts.failed > 0, counts, detail: tail };
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', wt); } catch { /* best effort */ }
    rmSync(wt, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2)) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  // NB: `argv.indexOf(x) + 1` is 0 when x is absent, which silently reads argv[0]
  // as the value. Always go through `arg`.
  const repo = resolve(arg('--repo', process.cwd()));
  const head = arg('--head', 'HEAD');
  let base = arg('--base', null);
  if (!base) { try { base = git(repo, 'merge-base', 'origin/main', head).trim(); } catch { base = git(repo, 'rev-parse', `${head}^`).trim(); } }

  const diff = git(repo, 'diff', '--unified=0', `${base}..${head}`);
  const msg = (() => { try { return git(repo, 'log', '--format=%B', `${base}..${head}`); } catch { return ''; } })();
  const waiver = /^Reproduction-Waiver:\s*(.+)$/im.exec(msg)?.[1]?.trim() ?? null;

  const srcTouched = changedFiles(diff).some(isSrcFile);
  const added = addedTests(diff);
  const files = [...added.keys()];
  const total = [...added.values()].reduce((a, b) => a + b, 0);

  console.log(`reproduction-gate: ${base.slice(0, 7)}..${head}`);
  console.log(`  src/ changed: ${srcTouched} · test files with added cases: ${files.length} (${total} case(s))`);

  if (!srcTouched) { console.log('reproduction-gate SKIPPED — no src/ change, so nothing claims to fix anything'); return 0; }
  if (!files.length) { console.log('reproduction-gate SKIPPED — no test cases added'); return 0; }
  if (waiver) { console.log(`reproduction-gate WAIVED — "${waiver}"`); return 0; }

  console.log(`  replaying ${files.join(', ')} against the merge base…`);
  const { ran, failed, counts, detail } = runAtBase(repo, base, head, files);
  if (!ran) {
    // FAIL CLOSED. A runner that could not produce results proves nothing, and
    // treating that as proof is exactly how this gate was broken when written.
    console.error('reproduction-gate INCONCLUSIVE — the runner produced no countable test results at the base.');
    console.error('That is NOT proof of a fix; it is a broken replay. Treating as a failure.');
    console.error(detail);
    return 1;
  }
  console.log(`  at base: ${counts.total} test(s) ran, ${counts.failed} failed, ${counts.passed} passed`);
  if (failed) { console.log('reproduction-gate PASSED — an added test FAILS at the merge base, so the fix is proven'); return 0; }

  console.error('\nreproduction-gate FAILED — every added test ALREADY PASSES at the merge base.');
  console.error('This change touches src/ but its new tests do not demonstrate the old behaviour was wrong,');
  console.error('so nothing here proves the fix fixes anything. Either add a test that goes red at the base,');
  console.error('or, if these are coverage tests for a refactor rather than a fix, say so in a commit trailer:');
  console.error('  Reproduction-Waiver: <why these tests are not expected to fail at the base>');
  console.error(detail);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
