import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ADR-0057 step 1 — `vfkb --version` prints the package's OWN version, read
// from ITS OWN package.json at runtime (never hardcoded), and nothing else.
// This is the mechanism the npm install-path proof (scenarios/npm-install-path.mjs)
// asserts against a real `npm i -g` install; here it's the deterministic
// structural-invariant backstop (ADR-0023 — no scenario needed for this shape).

const CLI = resolve(__dirname, '../dist/cli.js');
const PKG_VERSION = (
  JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { version: string }
).version;

function fresh(): string {
  return mkdtempSync(join(tmpdir(), 'vfkb-version-'));
}

function run(brain: string, args: string[]): string {
  return execFileSync('node', [CLI, ...args], {
    env: { ...process.env, VFKB_DATA_DIR: brain },
    cwd: brain,
    encoding: 'utf8',
  });
}

describe('vfkb --version', () => {
  it('--version prints exactly the package.json version', () => {
    const out = run(fresh(), ['--version']);
    expect(out).toBe(`${PKG_VERSION}\n`);
  });

  it('-v prints exactly the package.json version', () => {
    const out = run(fresh(), ['-v']);
    expect(out).toBe(`${PKG_VERSION}\n`);
  });

  it('the `version` verb prints exactly the package.json version', () => {
    const out = run(fresh(), ['version']);
    expect(out).toBe(`${PKG_VERSION}\n`);
  });

  it('mentions --version in the usage string', () => {
    const out = run(fresh(), ['--help']);
    expect(out).toMatch(/--version/);
  });
});
