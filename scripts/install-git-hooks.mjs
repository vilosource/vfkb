#!/usr/bin/env node
// Points this clone's git hooks at the committed .githooks/ directory (the commit identity
// guard). Run by `npm install` via the `prepare` script. A no-op in CI, outside a git work
// tree, or when the package is installed as a dependency; never fails the install.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  if (process.env.CI) process.exit(0);
  if (!existsSync(join(repo, '.githooks', 'pre-commit'))) process.exit(0);
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (!existsSync(join(top, '.githooks', 'pre-commit'))) process.exit(0); // installed inside another repo
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: top, stdio: 'ignore' });
  console.log('vfkb: git hooks -> .githooks (commit identity guard)');
} catch {
  /* not a git checkout, or git missing: nothing to install */
}
