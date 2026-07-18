// #212 (stamping half) — the manifest is a PROVENANCE record, so engine identity
// must only ever ratchet UNKNOWN -> KNOWN.
//
// Altitude note (anti-vacuity): every assertion here reads the manifest.json file
// that was actually written, not the return value alone. A test that only checked
// the 'created'|'updated'|'skipped' verb would stay green if the stamp itself were
// wrong, which is precisely the defect under test.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManifest, readManifest, manifestNeedsStamp } from '../src/manifest.js';
import { SCHEMA_VERSION, ENGINE_COMMIT } from '../src/version.js';
import { broadcast } from '../src/broadcast.js';

// ENGINE_COMMIT is 'dev' under the test build (no esbuild define), so a "real
// sha" engine must be injected through the seam — the DoctorOpts.engineCommit
// precedent (src/doctor.ts:229).
const REAL = 'f08e893';
const OTHER = '81dae3d';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'vfkb-manifest-'));
  // The invoking session's own identity — broadcast derives origin from HERE.
  process.env.VFKB_PROJECT = 'originproj';
  process.env.VFKB_DATA_DIR = mkdtempSync(join(tmpdir(), 'vfkb-manifest-origin-'));
  delete process.env.KB_SESSION_ID;
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function brainWith(commit: string | undefined, version = '0.2.3'): string {
  const brain = join(tmp, '.vfkb');
  mkdirSync(brain, { recursive: true });
  const mf: Record<string, unknown> = { schema_version: SCHEMA_VERSION, engine_version: version };
  if (commit !== undefined) mf.engine_commit = commit;
  writeFileSync(join(brain, 'manifest.json'), JSON.stringify(mf, null, 2) + '\n');
  return brain;
}

function onDisk(brain: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(brain, 'manifest.json'), 'utf8'));
}

describe('#212 — the sentinel must never overwrite a known engine identity', () => {
  it('a dev-build writeManifest preserves an existing real sha (the `vfkb init` downgrade path)', () => {
    // init.ts:154 calls writeManifest UNCONDITIONALLY, so re-running
    // `node dist/cli.js init` in a consumer is a live overwrite path.
    const brain = brainWith(REAL, '0.4.0');
    const action = writeManifest(brain, { engineCommit: 'dev', engineVersion: '0.2.3' });

    expect(onDisk(brain).engine_commit).toBe(REAL);
    // The version must ride WITH the sha it belongs to — a real sha paired with a
    // different build's version would be a fresh lie, not a preserved truth.
    expect(onDisk(brain).engine_version).toBe('0.4.0');
    expect(action).toBe('skipped');
  });

  it('a dev build still CREATES a stamp when none exists (broadcast heal must not regress)', () => {
    const brain = join(tmp, '.vfkb');
    mkdirSync(brain, { recursive: true });
    const action = writeManifest(brain, { engineCommit: 'dev', engineVersion: '0.2.3' });

    expect(action).toBe('created');
    expect(onDisk(brain).schema_version).toBe(SCHEMA_VERSION);
    // 'dev' is the honest record of "this build did not know its own commit";
    // refusing to write at all would leave broadcast with an unreadable manifest.
    expect(onDisk(brain).engine_commit).toBe('dev');
  });
});

describe('#212 — a known identity upgrades an unknown one', () => {
  it('re-stamps a sentinel manifest when the running engine has a real sha', () => {
    const brain = brainWith('dev');
    const action = writeManifest(brain, { engineCommit: REAL, engineVersion: '0.4.0' });

    expect(onDisk(brain).engine_commit).toBe(REAL);
    expect(onDisk(brain).engine_version).toBe('0.4.0');
    expect(action).toBe('updated');
  });

  it('re-stamps a manifest that carries no engine_commit at all', () => {
    const brain = brainWith(undefined);
    writeManifest(brain, { engineCommit: REAL, engineVersion: '0.4.0' });
    expect(onDisk(brain).engine_commit).toBe(REAL);
  });

  it('does NOT churn-rewrite an identical real-sha manifest', () => {
    const brain = brainWith(REAL, '0.4.0');
    const before = readFileSync(join(brain, 'manifest.json'), 'utf8');
    const action = writeManifest(brain, { engineCommit: REAL, engineVersion: '0.4.0' });
    expect(action).toBe('skipped');
    expect(readFileSync(join(brain, 'manifest.json'), 'utf8')).toBe(before);
  });

  it('a genuinely different real sha still rewrites (real drift is not preserved)', () => {
    const brain = brainWith(OTHER, '0.4.0');
    const action = writeManifest(brain, { engineCommit: REAL, engineVersion: '0.5.0' });
    expect(action).toBe('updated');
    expect(onDisk(brain).engine_commit).toBe(REAL);
  });
});

describe('#212 — manifestNeedsStamp', () => {
  it('is true when absent, true when the stored commit is unknown and the engine knows its own', () => {
    const empty = join(tmp, 'none');
    mkdirSync(empty, { recursive: true });
    expect(manifestNeedsStamp(empty, REAL)).toBe(true);
    expect(manifestNeedsStamp(brainWith('dev'), REAL)).toBe(true);
  });

  it('is false when the stamp is already known, and false when the ENGINE is the unknown one', () => {
    expect(manifestNeedsStamp(brainWith(REAL), REAL)).toBe(false);
    expect(manifestNeedsStamp(brainWith(OTHER), REAL)).toBe(false); // drift is doctor's job, not a re-stamp trigger
    expect(manifestNeedsStamp(brainWith('dev'), 'dev')).toBe(false); // unknown -> unknown is no upgrade
  });

  it('defaults to the running engine identity when no commit is injected', () => {
    // Guards the seam: the default must be the module constant, not a literal.
    expect(manifestNeedsStamp(brainWith(ENGINE_COMMIT))).toBe(false);
  });
});

describe('#212 — broadcast repairs a sentinel-stamped consumer brain', () => {
  // The shipped surface: ViloGate's committed manifest reads engine_commit:"dev"
  // and nothing ever corrects it, because the heal fires only on ABSENCE.
  function target(commit: string | undefined): string {
    const repo = join(tmp, 'consumer');
    const brain = join(repo, '.vfkb');
    mkdirSync(brain, { recursive: true });
    writeFileSync(join(brain, 'entries.jsonl'), '');
    const mf: Record<string, unknown> = { schema_version: SCHEMA_VERSION, engine_version: '0.2.3' };
    if (commit !== undefined) mf.engine_commit = commit;
    writeFileSync(join(brain, 'manifest.json'), JSON.stringify(mf, null, 2) + '\n');
    return repo;
  }

  it('upgrades engine_commit "dev" to the running real sha', () => {
    const repo = target('dev');
    const results = broadcast('hello', [repo], { op: 'TEST', engineCommit: REAL, engineVersion: '0.4.0' });

    expect(results[0].ok).toBe(true);
    expect(onDisk(join(repo, '.vfkb')).engine_commit).toBe(REAL);
  });

  it('leaves a real-sha manifest byte-identical (no churn on every broadcast)', () => {
    const repo = target(REAL);
    const path = join(repo, '.vfkb', 'manifest.json');
    const before = readFileSync(path, 'utf8');
    const results = broadcast('hello', [repo], { op: 'TEST', engineCommit: REAL, engineVersion: '0.2.3' });
    expect(results[0].ok).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(results[0].healed).toBeFalsy();
  });

  it('still heals a genuinely missing manifest (#193 must not regress)', () => {
    const repo = join(tmp, 'plugin-born');
    const brain = join(repo, '.vfkb');
    mkdirSync(brain, { recursive: true });
    writeFileSync(join(brain, 'entries.jsonl'), '');

    const results = broadcast('hello', [repo], { op: 'TEST', engineCommit: REAL, engineVersion: '0.4.0' });
    expect(results[0].ok).toBe(true);
    expect(results[0].healed).toBe(true);
    expect(existsSync(join(brain, 'manifest.json'))).toBe(true);
    expect(readManifest(brain)?.engine_commit).toBe(REAL);
  });

  it('a dev-build broadcast does not downgrade a consumer real sha', () => {
    const repo = target(REAL);
    broadcast('hello', [repo], { op: 'TEST', engineCommit: 'dev', engineVersion: '0.2.3' });
    expect(onDisk(join(repo, '.vfkb')).engine_commit).toBe(REAL);
  });
});
