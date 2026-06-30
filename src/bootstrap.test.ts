// ADR-0031 inner gate — the committed bootstrap guard resolves the engine via
// $VFKB_HOME and DEGRADES GRACEFULLY when it is unset: SessionStart informs the
// user (a valid hook payload), PreToolUse/Stop never block, and a resolved engine
// is run transparently. This is the guardrail for "VFKB_HOME not set".

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from './init.js';

let bootstrap: string;
let fakeHome: string;

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'vfkb-boot-'));
  initProject(root, { project: 'demo' });
  bootstrap = join(root, '.vfkb', 'bin', 'bootstrap.mjs');
  // a fake $VFKB_HOME whose "engines" just echo their argv so we can see passthrough
  fakeHome = mkdtempSync(join(tmpdir(), 'vfkb-fakehome-'));
  const stub = 'console.log("ENGINE " + process.argv.slice(2).join(" "));';
  writeFileSync(join(fakeHome, 'vfkb.mjs'), stub);
  writeFileSync(join(fakeHome, 'vfkb-mcp.mjs'), stub);
});

function run(args: string[], env: Record<string, string | undefined>) {
  return spawnSync('node', [bootstrap, ...args], {
    encoding: 'utf8',
    env: { ...process.env, VFKB_HOME: undefined, ...env },
  });
}

describe('bootstrap guard (ADR-0031)', () => {
  it('VFKB_HOME unset + session-start: emits a clear INACTIVE banner (exit 0)', () => {
    const r = run(['cli', 'hook', 'session-start'], { VFKB_HOME: undefined });
    expect(r.status).toBe(0);
    const payload = JSON.parse(r.stdout);
    expect(payload.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(payload.hookSpecificOutput.additionalContext).toContain('VFKB_HOME');
    expect(payload.hookSpecificOutput.additionalContext).toContain('INACTIVE');
  });

  it('VFKB_HOME unset + pre-tool-use: never blocks (exit 0, no stdout payload)', () => {
    const r = run(['cli', 'hook', 'pre-tool-use'], { VFKB_HOME: undefined });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
    expect(r.stderr).toContain('VFKB_HOME'); // informs on stderr
  });

  it('VFKB_HOME unset + mcp: exits cleanly (no crash)', () => {
    const r = run(['mcp'], { VFKB_HOME: undefined });
    expect(r.status).toBe(0);
  });

  it('VFKB_HOME set: runs the resolved engine transparently (passthrough)', () => {
    const r = run(['cli', 'hook', 'session-start'], { VFKB_HOME: fakeHome });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('ENGINE hook session-start');
  });

  it('VFKB_HOME set but bundles missing: degrades like unset', () => {
    const empty = mkdtempSync(join(tmpdir(), 'vfkb-empty-'));
    const r = run(['cli', 'hook', 'session-start'], { VFKB_HOME: empty });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.additionalContext).toContain('INACTIVE');
  });
});
