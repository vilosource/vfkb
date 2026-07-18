// #212 (stamping half) — the manifest is a PROVENANCE record, so engine identity
// must only ever ratchet UNKNOWN -> KNOWN.
//
// Altitude note (anti-vacuity): every assertion here reads the manifest.json file
// that was actually written, not the return value alone. A test that only checked
// the 'created'|'updated'|'skipped' verb would stay green if the stamp itself were
// wrong, which is precisely the defect under test.

import { describe, expect, it, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildBundles } from '../scripts/build-bundles.mjs';
import { writeManifest, readManifest, manifestNeedsStamp } from '../src/manifest.js';
import { SCHEMA_VERSION, ENGINE_COMMIT } from '../src/version.js';
import { broadcast } from '../src/broadcast.js';
import { initProject } from '../src/init.js';

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

describe('#212 — the downgrade path through `vfkb init` itself', () => {
  // The issue's correction says "there is no overwrite path". That is true of
  // broadcast, but init.ts:154 calls writeManifest UNCONDITIONALLY and there is
  // no early return before it, so a re-run of `vfkb init` from a tsc/dist build
  // IS one. Asserted through initProject — the shipped entry point — rather than
  // through writeManifest, because the claim is about that call site.
  it('a dev-build `vfkb init` re-run does not clobber an existing real sha', () => {
    const root = join(tmp, 'consumer-init');
    mkdirSync(join(root, '.vfkb'), { recursive: true });
    writeFileSync(join(root, '.vfkb', 'entries.jsonl'), '');
    writeFileSync(
      join(root, '.vfkb', 'manifest.json'),
      JSON.stringify({ schema_version: SCHEMA_VERSION, engine_version: '0.4.0', engine_commit: REAL }, null, 2) + '\n',
    );

    // ENGINE_COMMIT is 'dev' under the test build, so this IS the dist-path case.
    expect(ENGINE_COMMIT).toBe('dev');
    initProject(root, { project: 'demo' });

    expect(onDisk(join(root, '.vfkb')).engine_commit).toBe(REAL);
    expect(onDisk(join(root, '.vfkb')).engine_version).toBe('0.4.0');
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

  // Review finding (major): the test ABOVE does not reach isUnknownCommit's
  // `!commit` half. writeManifest's preservation guard tests the INCOMING
  // identity (manifest.ts:79), which is a real sha here, so `cur.engine_commit`
  // is never passed to isUnknownCommit and the undefined branch never runs —
  // deleting `!commit ||` left the whole suite green. The branch is load-bearing
  // only through manifestNeedsStamp, so that is where it must be asserted.
  it('treats a MISSING engine_commit as unknown, so it is a re-stamp trigger', () => {
    expect(manifestNeedsStamp(brainWith(undefined), REAL)).toBe(true);
    // ...and a commit-less manifest is no upgrade for an equally unknown engine.
    expect(manifestNeedsStamp(brainWith(undefined), 'dev')).toBe(false);
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

  it('upgrades engine_commit "dev" to the running real sha, reported as an UPGRADE not a heal', () => {
    const repo = target('dev');
    const results = broadcast('hello', [repo], { op: 'TEST', engineCommit: REAL, engineVersion: '0.4.0' });

    expect(results[0].ok).toBe(true);
    expect(onDisk(join(repo, '.vfkb')).engine_commit).toBe(REAL);
    // The distinction is the whole point of the flag pair: this brain's manifest
    // was PRESENT throughout, so calling it `healed` (#193, "manifest-less")
    // would be an actively false audit line. Collapsing the two branches must
    // go red here.
    expect(results[0].upgraded).toBe(true);
    expect(results[0].healed).toBeFalsy();
  });

  it('upgrades a manifest that carries no engine_commit at all (the #212 symptom, end to end)', () => {
    const repo = target(undefined);
    const results = broadcast('hello', [repo], { op: 'TEST', engineCommit: REAL, engineVersion: '0.4.0' });

    expect(results[0].ok).toBe(true);
    expect(onDisk(join(repo, '.vfkb')).engine_commit).toBe(REAL);
    expect(results[0].upgraded).toBe(true);
    expect(results[0].healed).toBeFalsy();
  });

  it('names an upgrade failure as an UPGRADE failure, not a heal failure', () => {
    // Forcing writeManifest to throw on the PRESENT-manifest path. A directory
    // at manifest.json is deterministic and permission-independent (unlike a
    // chmod, which a root CI user would sail straight through): readManifest's
    // JSON.parse fails -> unknown provenance -> needsStamp; existsSync is true
    // -> not absent; writeFileSync then throws EISDIR.
    const repo = join(tmp, 'unwritable');
    const brain = join(repo, '.vfkb');
    mkdirSync(join(brain, 'manifest.json'), { recursive: true });
    writeFileSync(join(brain, 'entries.jsonl'), '');

    const results = broadcast('hello', [repo], { op: 'TEST', engineCommit: REAL, engineVersion: '0.4.0' });
    expect(results[0].ok).toBe(false);
    // "heal failed" would tell the operator the manifest was missing (#193)
    // when it was present and merely un-upgradable (#212).
    expect(results[0].reason).toContain('manifest provenance upgrade failed');
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

// The RENDERED surface — the review's blocking finding was that `upgraded` was
// set but never printed, so on the shipped CLI an upgrade was indistinguishable
// from an ordinary write. Asserting the BroadcastResult field alone cannot catch
// that: the renderer is a different file. So this drives the actual built
// bundle, over a real subprocess, and reads stdout.
//
// It also closes the review's UNVERIFIED item (a): every other test in this file
// injects a "real sha" through the StampOpts seam because the tsc/test build has
// ENGINE_COMMIT 'dev'. This one takes the sha from esbuild's `define` in
// scripts/build-bundles.mjs — the production identity path, exercised by nothing
// else in the suite. Which is also why the upgrade branch is UNREACHABLE via
// `node dist/cli.js`: that build genuinely does not know its own commit.
describe('#212 — the shipped CLI reports a provenance upgrade distinctly from a heal', () => {
  let outdir: string;
  let bundle: string;
  let headSha: string;

  beforeAll(async () => {
    outdir = mkdtempSync(join(tmpdir(), 'vfkb-manifest-bundle-'));
    ({ cli: bundle } = await buildBundles(outdir));
    headSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf8',
    }).trim();
  }, 120_000);

  afterAll(() => rmSync(outdir, { recursive: true, force: true }));

  function runBundle(target: string): { code: number; out: string } {
    const origin = mkdtempSync(join(tmpdir(), 'vfkb-manifest-cliorigin-'));
    try {
      const out = execFileSync('node', [bundle, 'broadcast', 'hello', '--to', target, '--op', 'TEST'], {
        env: { ...process.env, VFKB_DATA_DIR: origin, VFKB_PROJECT: 'originproj' },
        encoding: 'utf8',
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: Buffer | string };
      return { code: err.status ?? 1, out: err.stdout?.toString() ?? '' };
    }
  }

  function consumer(name: string, commit: string | undefined): string {
    const repo = join(tmp, name);
    const brain = join(repo, '.vfkb');
    mkdirSync(brain, { recursive: true });
    writeFileSync(join(brain, 'entries.jsonl'), '');
    const mf: Record<string, unknown> = { schema_version: SCHEMA_VERSION, engine_version: '0.2.3' };
    if (commit !== undefined) mf.engine_commit = commit;
    writeFileSync(join(brain, 'manifest.json'), JSON.stringify(mf, null, 2) + '\n');
    return repo;
  }

  it('prints an "upgraded" line — never the #193 heal wording — for a sentinel-stamped brain', () => {
    const repo = consumer('cli-dev', 'dev');
    const { code, out } = runBundle(repo);

    expect(code).toBe(0);
    // Precondition, asserted not assumed: without a genuine esbuild-injected
    // sha this bundle would be another 'dev' build, no upgrade would occur, and
    // every assertion below would pass vacuously.
    expect(headSha).not.toBe('dev');
    expect(onDisk(join(repo, '.vfkb')).engine_commit).toBe(headSha);

    expect(out).toContain('manifest provenance upgraded');
    expect(out).toContain('vfkb#212');
    // The false line the collapsed branch would emit about a brain that had a
    // manifest the whole time.
    expect(out).not.toContain('manifest healed');
    expect(out).not.toContain('vfkb#193');
  });

  it('still prints the #193 heal wording for a genuinely manifest-less brain', () => {
    const repo = join(tmp, 'cli-manifestless');
    mkdirSync(join(repo, '.vfkb'), { recursive: true });
    writeFileSync(join(repo, '.vfkb', 'entries.jsonl'), '');

    const { code, out } = runBundle(repo);
    expect(code).toBe(0);
    expect(out).toContain('manifest healed');
    expect(out).toContain('vfkb#193');
    expect(out).not.toContain('manifest provenance upgraded');
  });

  it('prints NEITHER note for an already-known, already-current manifest', () => {
    const repo = consumer('cli-known', headSha);
    const { code, out } = runBundle(repo);
    expect(code).toBe(0);
    expect(out).toContain('written\t');
    expect(out).not.toContain('manifest healed');
    expect(out).not.toContain('manifest provenance upgraded');
  });
});
