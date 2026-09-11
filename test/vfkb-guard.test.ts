import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Brake for ADR-0059's guard (.claude/vfkb-guard.mjs). The guard reads Claude
// Code's plugin registry to decide whether a DECLARED plugin is actually
// FULFILLED. It used to derive that path from $HOME alone — but Claude Code
// relocates its whole config dir via CLAUDE_CONFIG_DIR, and the wrapper
// launchers on this machine do exactly that (cldp -> ~/.claude-cldp). The guard
// therefore read a registry the session was not using, reported INACTIVE for a
// genuinely-installed plugin, and told the user to run an install that had
// already succeeded — a smoke alarm that cannot be silenced. Observed
// 2026-09-11 in vfkb's own repo.
//
// These tests execute the real guard as a subprocess (not a reimplementation of
// its logic) against synthetic config dirs, and include the can-fail arm: with
// nothing installed the banner MUST still appear.

const GUARD = join(__dirname, '..', '.claude', 'vfkb-guard.mjs');
const BANNER = 'vfkb INACTIVE';

let root: string;

function projectDir(declared: boolean): string {
  const dir = join(root, 'project');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(
    join(dir, '.claude', 'settings.json'),
    JSON.stringify(declared ? { enabledPlugins: { 'vfkb@vfkb': true } } : { enabledPlugins: {} }),
  );
  return dir;
}

function configDir(name: string, plugins: unknown): string {
  const dir = join(root, name);
  mkdirSync(join(dir, 'plugins'), { recursive: true });
  writeFileSync(
    join(dir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins }),
  );
  return dir;
}

function runGuard(env: Record<string, string | undefined>): string {
  return execFileSync(process.execPath, [GUARD], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: undefined, ...env },
  });
}

describe('.claude/vfkb-guard.mjs (ADR-0059 guard)', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vfkb-guard-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stays silent when the plugin is installed in the session CLAUDE_CONFIG_DIR', () => {
    // $HOME/.claude exists and is EMPTY — the exact shape of a wrapper-launched
    // session (cldp). If the guard consults it, this test banners.
    const home = join(root, 'home');
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: {} }),
    );
    const out = runGuard({
      CLAUDE_PROJECT_DIR: projectDir(true),
      CLAUDE_CONFIG_DIR: configDir('cldp', { 'vfkb@vfkb': [{ scope: 'user' }] }),
      HOME: home,
    });
    expect(out).toBe('');
  });

  it('CAN FAIL: banners when the plugin is declared but installed nowhere', () => {
    const out = runGuard({
      CLAUDE_PROJECT_DIR: projectDir(true),
      CLAUDE_CONFIG_DIR: configDir('cldp', {}),
      HOME: join(root, 'home'),
    });
    expect(out).toContain(BANNER);
  });

  it('falls back to $HOME/.claude when CLAUDE_CONFIG_DIR is unset', () => {
    const home = join(root, 'home');
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'vfkb@vfkb': [{ scope: 'user' }] } }),
    );
    const out = runGuard({ CLAUDE_PROJECT_DIR: projectDir(true), HOME: home });
    expect(out).toBe('');
  });

  it('honours a project-scope install only for THIS project', () => {
    const project = projectDir(true);
    const matching = runGuard({
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_CONFIG_DIR: configDir('cldp-a', {
        'vfkb@vfkb': [{ scope: 'project', projectPath: project }],
      }),
      HOME: join(root, 'home'),
    });
    expect(matching).toBe('');

    const other = runGuard({
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_CONFIG_DIR: configDir('cldp-b', {
        'vfkb@vfkb': [{ scope: 'project', projectPath: join(root, 'somewhere-else') }],
      }),
      HOME: join(root, 'home'),
    });
    expect(other).toContain(BANNER);
  });

  it('stays silent for a project that never declared the plugin', () => {
    const out = runGuard({
      CLAUDE_PROJECT_DIR: projectDir(false),
      CLAUDE_CONFIG_DIR: configDir('cldp', {}),
      HOME: join(root, 'home'),
    });
    expect(out).toBe('');
  });

  it('fails open (silent, exit 0) on an unreadable registry', () => {
    const out = runGuard({
      CLAUDE_PROJECT_DIR: projectDir(false),
      CLAUDE_CONFIG_DIR: join(root, 'does-not-exist'),
      HOME: join(root, 'home'),
    });
    expect(out).toBe('');
  });
});
