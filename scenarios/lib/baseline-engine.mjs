// Build (or reuse) the engine bundles for a fixed `main` commit, for an L4's RED run and its
// contrast arm (vfkb#386 decide step D6, ruling 54802539cda7): the contrast is the
// capability's ABSENCE — the pre-build engine on every face — never a production flag.
//
// The bundles are built from a clean detached worktree of `rev` with that worktree's own
// scripts/build-bundles.mjs (which stamps the commit into the bundle), cached by full sha
// under the OS temp dir, and identified in the record by sha256. `rev` must be a `main`
// commit (never a topic-branch sha that a rebase could orphan).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o }).trim();
export const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

/** The default baseline: the merge-base of HEAD with origin/main (the last main commit before this branch). */
export function defaultBaselineRev(repo) {
  return sh('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: repo });
}

/**
 * → { rev, cli, mcp, cliSha256, mcpSha256, dirty: false }
 * `cli`/`mcp` are vfkb.mjs / vfkb-mcp.mjs built from `rev`.
 */
export function baselineEngine(repo, rev) {
  const full = sh('git', ['rev-parse', `${rev}^{commit}`], { cwd: repo });
  // realpath: build-bundles.mjs only runs when argv[1] equals its own (real) module path,
  // and macOS's tmpdir is a symlink (/var → /private/var).
  const tmp = realpathSync(tmpdir());
  const out = join(tmp, `vfkb-baseline-${full}`);
  const cli = join(out, 'vfkb.mjs');
  const mcp = join(out, 'vfkb-mcp.mjs');
  if (!existsSync(cli) || !existsSync(mcp)) {
    const wt = join(tmp, `vfkb-baseline-wt-${full}`);
    rmSync(wt, { recursive: true, force: true });
    try { sh('git', ['worktree', 'prune'], { cwd: repo }); } catch { /* best effort */ }
    sh('git', ['worktree', 'add', '-q', '--detach', wt, full], { cwd: repo });
    try {
      // The build needs esbuild; the worktree borrows this checkout's node_modules.
      const nm = join(repo, 'node_modules');
      if (existsSync(nm) && !existsSync(join(wt, 'node_modules'))) symlinkSync(nm, join(wt, 'node_modules'));
      mkdirSync(out, { recursive: true });
      sh('node', [join(wt, 'scripts', 'build-bundles.mjs'), out], { cwd: wt });
      if (!existsSync(cli) || !existsSync(mcp)) throw new Error(`baseline build at ${full} produced no bundles in ${out}`);
    } finally {
      try { sh('git', ['worktree', 'remove', '--force', wt], { cwd: repo }); } catch { rmSync(wt, { recursive: true, force: true }); }
    }
  }
  return { rev: full, cli, mcp, cliSha256: sha256(cli), mcpSha256: sha256(mcp), dirty: false };
}
