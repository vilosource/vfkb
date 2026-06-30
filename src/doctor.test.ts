// FR-4 (ADR-0030) inner gate — `vfkb doctor` catches the failure modes a consumer
// trips over: incompatible/stale engine binding, missing/inconsistent wiring.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from './init.js';
import { runDoctor } from './doctor.js';
import { SCHEMA_VERSION } from './version.js';

let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vfkb-doctor-'));
  // a fake $VFKB_HOME with the two bundle files present
  home = mkdtempSync(join(tmpdir(), 'vfkb-home-'));
  writeFileSync(join(home, 'vfkb.mjs'), '');
  writeFileSync(join(home, 'vfkb-mcp.mjs'), '');
});

const doctor = (env: Record<string, string | undefined>) =>
  runDoctor({ root, brainDir: join(root, '.vfkb'), env });

const status = (r: ReturnType<typeof runDoctor>, name: string) =>
  r.checks.find((c) => c.name === name)?.status;

describe('vfkb doctor (FR-4)', () => {
  it('a freshly init-ed repo with $VFKB_HOME set is healthy (ok)', () => {
    initProject(root, { project: 'demo' });
    const r = doctor({ VFKB_HOME: home });
    expect(r.ok).toBe(true);
    expect(status(r, 'brain↔engine compat')).toBe('ok');
    expect(status(r, '$VFKB_HOME')).toBe('ok');
    expect(status(r, '.mcp.json')).toBe('ok');
    expect(status(r, '.claude/settings.json')).toBe('ok');
    expect(status(r, 'VFKB_PROJECT')).toBe('ok');
  });

  it('warns (not fails) on a bare repo with no wiring and no $VFKB_HOME', () => {
    const r = doctor({ VFKB_HOME: undefined });
    expect(r.ok).toBe(true); // warnings don't fail
    expect(status(r, '$VFKB_HOME')).toBe('warn');
    expect(status(r, '.mcp.json')).toBe('warn');
    expect(status(r, 'brain manifest')).toBe('warn');
  });

  it('FAILS when the brain schema is newer than the engine (incompatible)', () => {
    initProject(root, { project: 'demo' });
    writeFileSync(
      join(root, '.vfkb', 'manifest.json'),
      JSON.stringify({ schema_version: SCHEMA_VERSION + 1, engine_version: '9.9.9', engine_commit: 'x' }),
    );
    const r = doctor({ VFKB_HOME: home });
    expect(r.ok).toBe(false);
    expect(status(r, 'brain↔engine compat')).toBe('fail');
  });

  it('FAILS on a VFKB_PROJECT mismatch between .mcp.json and settings', () => {
    initProject(root, { project: 'demo' });
    // corrupt .mcp.json to a different project than the settings hooks
    const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
    mcp.mcpServers.vfkb.env.VFKB_PROJECT = 'other';
    writeFileSync(join(root, '.mcp.json'), JSON.stringify(mcp));
    const r = doctor({ VFKB_HOME: home });
    expect(r.ok).toBe(false);
    expect(status(r, 'VFKB_PROJECT')).toBe('fail');
  });

  it('warns when $VFKB_HOME is set but the bundles are missing', () => {
    initProject(root, { project: 'demo' });
    const r = doctor({ VFKB_HOME: mkdtempSync(join(tmpdir(), 'empty-home-')) });
    expect(status(r, '$VFKB_HOME')).toBe('warn');
  });
});
