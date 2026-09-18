#!/usr/bin/env node
// ============================================================================
// REPRODUCTION GATE (P12-a, ADR-0075 clause 3 / RFC-039 D8).
//
// A change that CLAIMS to fix a bug must be able to prove the bug existed: at
// least one of its tests must go red against the merge base and green at the
// head. This is ADR-0070's can-fail requirement made mechanical for
// agent-authored work — a dispatched agent is an author whose mutation log is
// exactly as trustworthy as its self-report (RFC-039 D3).
//
// ── THE TRIGGER IS A CLAIM, NOT A DIFF SHAPE ────────────────────────────────
// The first version armed on "src/ changed AND tests added". Under the D10
// scope ruling (ADR-0075 cl. 7: dispatched work is cleanup, testing and
// refactoring ONLY — bug fixes stay human-dispatched) that fires on 100% of the
// factory's admitted work, whose tests HONESTLY pass at the base, with nearly no
// true-positive surface. And "this fixes a bug" is a claim made by whoever
// scoped the work; it is not derivable from a diff. So the gate arms on the
// claim itself:
//   1. the linked admitted issue carries the `bug` label (operator-applied at
//      admission; `--issue N`, `Closes/Fixes/Resolves #N` in a commit or the PR
//      body, or a `…issue-N…` branch name), or
//   2. failing that, a `fix:` conventional-commit type anywhere in base..head.
// Any other claim → SKIPPED, exit 0, and the claim is printed so a mislabelled
// fix is visible in the log rather than silently unarmed.
//
// ── THE REPLAY MEASURES A BUILT TREE, TWICE ─────────────────────────────────
// The base is checked out into a throwaway worktree and run through the
// project's OWN `npm test` with lifecycle scripts — `pretest` builds `dist/` —
// because a bare runner in a fresh worktree fails every test that resolves
// build output, and the first version counted those failures as PROOF (the
// same defect #307's round 6 found in tamper-check, pointing the other way).
// Two runs: a BASELINE of the base's own versions of the modified test files,
// then the REPLAY of the head's versions of every added or modified test file.
// The verdict is "at least one test is red in the replay that was not red in
// the baseline" — by name. A pre-existing red in a modified file proves nothing;
// a changed expectation with no new `it(` is still seen.
//
// ── A LINK FAILURE IS NOT A RED TEST ────────────────────────────────────────
// A test file that cannot import against the old tree (it tests a module the
// fix ADDED) produces zero countable tests. That is not proof the bug existed —
// counting it would make every fix-plus-new-helper trivially provable — and it
// is not inconclusive either: it is a determinate "this reproduction does not
// exercise the surface that had the bug". Such files are excluded and named;
// if nothing countable remains the gate FAILS and says what to write instead.
//
// ── THERE IS NO WAIVER ───────────────────────────────────────────────────────
// No trailer, no review-record escape, no label. A free-text trailer leaked in
// four consecutive review rounds of the sibling gate because the checked party
// can write it, and a claim trigger makes an escape almost never needed: by
// history (60 src-touching commits over 11 weeks, 44 with test changes replayed
// against a built base) zero honest changes passed at the base and five could
// only link-fail — about one per eleven weeks. That residue escalates per
// ADR-0070 §4; an operator merges it by relaxing branch protection under their
// own name (`main` has enforce_admins on — there is no admin bypass).
//
//   node scripts/reproduction-gate.mjs [--base <ref>] [--head <ref>] [--repo <dir>] [--issue <n>]
//   env: PR_BODY (scanned for Closes/Fixes #N), HEAD_REF (branch name in CI)
// ============================================================================
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(f) && /(^|\/)test(s)?\//i.test(f);
export const isSrcFile = (f) => /^src\//i.test(f);

const git = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Added/modified/deleted files between two refs, from git — not from a regex over diff text. */
export function changedFiles(repo, base, head) {
  const fields = git(repo, 'diff', '--name-status', '-z', '--find-renames', base, head, '--').split('\0');
  const out = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++];
    if (/^R\d+$/.test(status)) { out.push({ status: 'M', path: fields[i + 1], from: fields[i] }); i += 2; }
    else if (/^C\d+$/.test(status)) { out.push({ status: 'A', path: fields[i + 1] }); i += 2; }
    else out.push({ status: status[0], path: fields[i++] });
  }
  return out;
}

const ISSUE_REF = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)\b/i;

/** The issue a change says it addresses, if it says so anywhere the author writes. */
export function linkedIssue({ argIssue = null, messages = '', prBody = '', branch = '' } = {}) {
  if (argIssue && /^\d+$/.test(String(argIssue))) return { n: Number(argIssue), via: '--issue' };
  const b = ISSUE_REF.exec(prBody); if (b) return { n: Number(b[1]), via: 'PR body' };
  const m = ISSUE_REF.exec(messages); if (m) return { n: Number(m[1]), via: 'commit message' };
  const br = /(?:^|[\/_-])issue-(\d+)(?:$|[\/_-])/i.exec(branch); if (br) return { n: Number(br[1]), via: 'branch name' };
  return null;
}

/** Labels on an issue via `gh`; null when the lookup itself is unavailable (no gh, no token, no network). */
export function issueLabels(n, env = process.env) {
  const r = spawnSync('gh', ['issue', 'view', String(n), '--json', 'labels', '--jq', '.labels[].name'], { encoding: 'utf8', timeout: 30_000, env });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

const CONVENTIONAL = /^([a-z]+)(?:\([^)]*\))?!?:/;

/**
 * What this change claims to be. `bug` on the linked issue is authoritative
 * (operator-applied at admission); a `fix:` subject is the fallback. Everything
 * else is reported by its dominant conventional type so a mislabelled fix is
 * visible in the log.
 */
export function detectClaim({ subjects = [], issue = null, labels = undefined } = {}) {
  if (issue) {
    if (labels === null) { /* lookup unavailable — fall through to the subjects, and say so */ }
    else if (Array.isArray(labels) && labels.includes('bug')) return { kind: 'fix', source: `issue #${issue.n} (${issue.via}) is labelled bug` };
  }
  const types = subjects.map((s) => CONVENTIONAL.exec(s)?.[1] ?? 'untyped');
  if (types.includes('fix')) return { kind: 'fix', source: `a fix: commit in the range${issue && labels === null ? ` (issue #${issue.n} lookup unavailable)` : ''}` };
  const dominant = types.sort((a, b) => types.filter((t) => t === b).length - types.filter((t) => t === a).length)[0] ?? 'none';
  return { kind: dominant, source: issue ? (labels === null ? `issue #${issue.n} lookup unavailable; commits say ${dominant}` : `issue #${issue.n} is not labelled bug; commits say ${dominant}`) : `commits say ${dominant}` };
}

/**
 * Run the given test files inside a worktree through the project's own
 * `npm test`, and report every test by name with its status, plus the files
 * that failed to load at all. A runner that produced no report is `ok: false`.
 */
function runTests(wt, files) {
  const report = join(wt, '.repro-report.json');
  rmSync(report, { force: true });
  const r = spawnSync('npm', ['test', '--', '--reporter=json', '--outputFile', report, ...files], {
    cwd: wt, encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '1' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (!existsSync(report)) return { ok: false, detail: `the resolved test command produced no report (exit ${r.status})\n${out.split('\n').slice(-20).join('\n')}` };
  let j;
  try { j = JSON.parse(readFileSync(report, 'utf8')); } catch { return { ok: false, detail: 'the test run produced unparseable JSON' }; }
  const wtReal = (() => { try { return realpathSync(wt); } catch { return wt; } })();
  const rel = (p) => String(p ?? '').replace(`${wtReal}/`, '').replace(`${wt}/`, '');
  const tests = new Map(); const linkFailed = [];
  for (const f of j.testResults ?? []) {
    const file = rel(f.name);
    if (f.status === 'failed' && (f.assertionResults ?? []).length === 0) { linkFailed.push({ file, message: String(f.message ?? '').split('\n')[0] }); continue; }
    for (const a of f.assertionResults ?? []) tests.set(`${file}::${a.fullName}`, a.status);
  }
  return { ok: true, tests, linkFailed };
}

/**
 * Baseline the base's own versions of the modified files, then replay the
 * head's versions of every added or modified test file, all inside one
 * worktree at the base so `pretest` builds the OLD tree.
 */
export function replayAtBase(repo, base, head, files) {
  const wt = mkdtempSync(join(tmpdir(), 'vfkb-repro-'));
  try {
    git(repo, 'worktree', 'add', '--detach', '--quiet', wt, base);
    const nm = join(repo, 'node_modules');
    if (!existsSync(nm)) return { ok: false, detail: 'no node_modules to borrow — run `npm ci` before this gate' };
    if (!existsSync(join(wt, 'node_modules'))) symlinkSync(nm, join(wt, 'node_modules'), 'dir');

    const modified = files.filter((f) => f.status === 'M').map((f) => f.from ?? f.path).filter((p) => existsSync(join(wt, p)));
    const baseline = modified.length ? runTests(wt, modified) : { ok: true, tests: new Map(), linkFailed: [] };
    if (!baseline.ok) return { ok: false, detail: `baseline run: ${baseline.detail}` };

    for (const f of files) {
      if (f.from && f.from !== f.path) rmSync(join(wt, f.from), { force: true });
      const dest = join(wt, f.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, git(repo, 'show', `${head}:${f.path}`));  // the NEW test against the OLD source
    }
    const replay = runTests(wt, files.map((f) => f.path));
    if (!replay.ok) return { ok: false, detail: `replay run: ${replay.detail}` };

    const baseRed = new Set([...baseline.tests].filter(([, s]) => s === 'failed').map(([k]) => k));
    const newlyRed = [...replay.tests].filter(([k, s]) => s === 'failed' && !baseRed.has(k)).map(([k]) => k);
    return { ok: true, newlyRed, countable: replay.tests.size, preExistingRed: baseRed.size, linkFailed: replay.linkFailed };
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', wt); } catch { /* best effort */ }
    rmSync(wt, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const repo = resolve(arg('--repo', process.cwd()));
  const head = arg('--head', 'HEAD');
  let base = arg('--base', null);
  if (!base) { try { base = git(repo, 'merge-base', 'origin/main', head).trim(); } catch { base = null; } }
  if (!base) { console.error('reproduction-gate FAILED — no base given and no merge-base with origin/main. Refusing to report a verdict on an unknown range.'); return 1; }
  let baseSha, headSha;
  try {
    baseSha = git(repo, 'rev-parse', '--verify', `${base}^{commit}`).trim();
    headSha = git(repo, 'rev-parse', '--verify', `${head}^{commit}`).trim();
  } catch { console.error(`reproduction-gate FAILED — cannot resolve base "${base}" or head "${head}".`); return 1; }
  if (baseSha === headSha) { console.error(`reproduction-gate FAILED — base and head are the same commit (${baseSha.slice(0, 7)}); a verdict here would be meaningless.`); return 1; }

  const subjects = git(repo, 'log', '--format=%s', `${baseSha}..${headSha}`).split('\n').filter(Boolean);
  const messages = git(repo, 'log', '--format=%B', `${baseSha}..${headSha}`);
  const branch = env.HEAD_REF || (() => { try { return git(repo, 'rev-parse', '--abbrev-ref', head).trim(); } catch { return ''; } })();
  const issue = linkedIssue({ argIssue: arg('--issue', null), messages, prBody: env.PR_BODY ?? '', branch });
  const claim = detectClaim({ subjects, issue, labels: issue ? issueLabels(issue.n, env) : undefined });

  const changed = changedFiles(repo, baseSha, headSha);
  const srcTouched = changed.some((f) => isSrcFile(f.path) && f.status !== 'D');
  const files = changed.filter((f) => isTestFile(f.path) && (f.status === 'A' || f.status === 'M'));

  console.log(`reproduction-gate: ${baseSha.slice(0, 7)}..${headSha.slice(0, 7)}`);
  console.log(`  claim: ${claim.kind} — ${claim.source}`);
  console.log(`  src/ changed: ${srcTouched} · test files added/modified: ${files.length}`);

  if (claim.kind !== 'fix') { console.log(`reproduction-gate SKIPPED (claim: ${claim.kind}) — only a change that claims to fix a bug must prove the bug existed`); return 0; }
  if (!srcTouched) { console.log('reproduction-gate SKIPPED — a fix claim with no src/ change has nothing to prove here'); return 0; }
  if (!files.length) {
    console.log('reproduction-gate SKIPPED — this fix adds or changes NO test. Nothing here can prove the bug existed;');
    console.log('  the ADR-0052 review record must say why in `mutationsNote` (ADR-0070 §2).');
    return 0;
  }

  console.log(`  replaying ${files.map((f) => f.path).join(', ')} against the built merge base…`);
  const r = replayAtBase(repo, baseSha, headSha, files);
  if (!r.ok) {
    // FAIL CLOSED. A runner that could not produce results proves nothing, and
    // treating that as proof is exactly how the first version of this was broken.
    console.error('reproduction-gate INCONCLUSIVE — the base could not be built or run, so no verdict is possible.');
    console.error('That is NOT proof of a fix; it is a broken replay. Treating as a failure.');
    console.error(r.detail);
    return 1;
  }
  console.log(`  at base: ${r.countable} test(s) countable · ${r.newlyRed.length} newly red · ${r.preExistingRed} already red before this change · ${r.linkFailed.length} file(s) could not load`);
  for (const l of r.linkFailed) console.log(`    cannot load at base: ${l.file} — ${l.message}`);

  if (r.newlyRed.length) {
    console.log(`reproduction-gate PASSED — ${r.newlyRed.length} test(s) go red at the merge base, so the bug is demonstrated:`);
    for (const k of r.newlyRed.slice(0, 5)) console.log(`    ${k}`);
    return 0;
  }
  if (r.countable === 0 && r.linkFailed.length) {
    console.error('\nreproduction-gate FAILED — none of this fix\'s tests can run against the tree that had the bug:');
    console.error('every added or changed test file imports something that does not exist at the merge base, so');
    console.error('nothing here exercises the surface that was wrong. A test that cannot load is not a red test.');
    console.error('Write the reproduction against the surface the issue names — the old entry point, the old');
    console.error('output — so it fails there for the reason the bug did.');
  } else {
    console.error('\nreproduction-gate FAILED — every test this fix adds or changes ALREADY PASSES at the merge base.');
    console.error('The change claims to fix a bug but its tests do not demonstrate the old behaviour was wrong,');
    console.error('so nothing here proves the fix fixes anything. Add a test that goes red at the base.');
  }
  console.error('');
  console.error('THERE IS NO WAIVER. If the claim is wrong (this is not a fix), retype the commits; if the fix');
  console.error('is real but cannot be reproduced against the old tree, escalate (ADR-0070 §4) — an operator');
  console.error('merges it by relaxing branch protection under their own name. An agent cannot.');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
