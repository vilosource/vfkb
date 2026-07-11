// FR-4 (ADR-0030) — engine identity, for the brain↔engine version stamp + doctor.
//
// SCHEMA_VERSION is the load-bearing compat signal: the .vfkb/entries.jsonl
// envelope version (ADR-0011). Bump it ONLY on a breaking envelope change; a brain
// stamped with a newer schema than the running engine is incompatible.
//
// ENGINE_VERSION / ENGINE_COMMIT identify the engine build. They are injected at
// bundle build time via esbuild `define` (scripts/build-bundles.mjs, kept as the
// primary); the tsc/dist path has no define, so ENGINE_VERSION falls back to the
// package's OWN package.json (resolved relative to this module — dist/version.js
// sits one level below package.json, same in the repo and inside an `npm i -g`
// install). The old literal '0.0.0-dev' fallback meant an npm-installed vfkb-mcp
// reported serverInfo.version 0.0.0-dev (observed — PR #122 review F4). `typeof
// <undeclared>` is safe (never throws), so the define check works without the
// symbols existing at runtime; the fs read is guarded so a missing/unreadable
// manifest still yields the honest dev sentinel instead of a crash.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const SCHEMA_VERSION = 1;

declare const __VFKB_VERSION__: string;
declare const __VFKB_COMMIT__: string;

function ownPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version || '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

export const ENGINE_VERSION: string =
  typeof __VFKB_VERSION__ !== 'undefined' ? __VFKB_VERSION__ : ownPackageVersion();
export const ENGINE_COMMIT: string =
  typeof __VFKB_COMMIT__ !== 'undefined' ? __VFKB_COMMIT__ : 'dev';
