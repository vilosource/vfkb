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

export function currentManifest(): Manifest {
  return { schema_version: SCHEMA_VERSION, engine_version: ENGINE_VERSION, engine_commit: ENGINE_COMMIT };
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

// Write the stamp if absent or stale. Returns 'created' | 'updated' | 'skipped'.
export function writeManifest(brainDir: string): 'created' | 'updated' | 'skipped' {
  const p = manifestPath(brainDir);
  const existed = existsSync(p);
  const cur = readManifest(brainDir);
  const next = currentManifest();
  if (cur && JSON.stringify(cur) === JSON.stringify(next)) return 'skipped';
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2) + '\n');
  return existed ? 'updated' : 'created';
}
