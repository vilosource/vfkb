// FR-4 (ADR-0030) — the brain↔engine version stamp: .vfkb/manifest.json.
//
// A small COMMITTED file (ADR-0030 locks it as committed, distinct from the
// derived/gitignored index-meta.json) recording which engine a brain targets, so a
// consumer can't silently bind to a stale/incompatible engine. Engine-written only
// (the write-gate applies); never hand-edited.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SCHEMA_VERSION, ENGINE_VERSION, ENGINE_COMMIT } from './version.js';

export interface Manifest {
  schema_version: number;
  engine_version: string;
  engine_commit: string;
}

export function manifestPath(brainDir: string): string {
  return join(brainDir, 'manifest.json');
}

/** Injectable engine identity — the DoctorOpts.engineCommit precedent (doctor.ts). */
export interface StampOpts {
  engineCommit?: string;
  engineVersion?: string;
}

// #212 — `dev` is version.ts's honest sentinel for "this build has no esbuild
// define, so it does not know its own commit" (the tsc/dist path, i.e. the
// documented `node dist/cli.js` fallback). A missing commit says the same thing.
export function isUnknownCommit(commit: string | undefined): boolean {
  return !commit || commit === 'dev';
}

export function currentManifest(opts: StampOpts = {}): Manifest {
  return {
    schema_version: SCHEMA_VERSION,
    engine_version: opts.engineVersion ?? ENGINE_VERSION,
    engine_commit: opts.engineCommit ?? ENGINE_COMMIT,
  };
}

export function readManifest(brainDir: string): Manifest | undefined {
  const p = manifestPath(brainDir);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Manifest;
  } catch {
    return undefined;
  }
}

// #212 — would writing the stamp materially IMPROVE this brain's provenance?
//
// True when there is no stamp at all, or when the stored identity is unknown and
// the running engine knows its own. A stored sha that merely DIFFERS is not a
// re-stamp trigger: that is drift, and reporting drift is doctor's job — silently
// overwriting the evidence would destroy the very signal doctor reads.
export function manifestNeedsStamp(brainDir: string, engineCommit: string = ENGINE_COMMIT): boolean {
  const cur = readManifest(brainDir);
  if (!cur) return true;
  return isUnknownCommit(cur.engine_commit) && !isUnknownCommit(engineCommit);
}

// Write the stamp if absent or stale. Returns 'created' | 'updated' | 'skipped'.
//
// #212 (stamping half) — engine identity is a PROVENANCE record, so it only ever
// ratchets UNKNOWN -> KNOWN. A build that does not know its own commit must not
// overwrite a brain that does: `vfkb init` calls this unconditionally, so a
// re-run from the tsc/dist path is a live downgrade path. A dev build may still
// CREATE a stamp (broadcast's heal depends on it, and a manifest's load-bearing
// field is schema_version); recording `dev` there is honest — it is a brain whose
// provenance genuinely is unknown, and doctor says exactly that.
export function writeManifest(brainDir: string, opts: StampOpts = {}): 'created' | 'updated' | 'skipped' {
  const p = manifestPath(brainDir);
  const existed = existsSync(p);
  const cur = readManifest(brainDir);
  const next = currentManifest(opts);
  if (cur && isUnknownCommit(next.engine_commit) && !isUnknownCommit(cur.engine_commit)) {
    // Preserve the pair, not just the sha: a real commit carrying some other
    // build's version number would be a fresh falsehood, not a preserved truth.
    next.engine_commit = cur.engine_commit;
    next.engine_version = cur.engine_version;
  }
  if (cur && JSON.stringify(cur) === JSON.stringify(next)) return 'skipped';
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2) + '\n');
  return existed ? 'updated' : 'created';
}
