// FR-4 (ADR-0030) — engine identity, for the brain↔engine version stamp + doctor.
//
// SCHEMA_VERSION is the load-bearing compat signal: the .vfkb/entries.jsonl
// envelope version (ADR-0011). Bump it ONLY on a breaking envelope change; a brain
// stamped with a newer schema than the running engine is incompatible.
//
// ENGINE_VERSION / ENGINE_COMMIT identify the engine build. They are injected at
// bundle build time via esbuild `define` (scripts/build-bundles.mjs); the tsc/dist
// dev path has no define, so they fall back. `typeof <undeclared>` is safe (never
// throws), so the fallback works without the symbols existing at runtime.

export const SCHEMA_VERSION = 1;

declare const __VFKB_VERSION__: string;
declare const __VFKB_COMMIT__: string;

export const ENGINE_VERSION: string =
  typeof __VFKB_VERSION__ !== 'undefined' ? __VFKB_VERSION__ : '0.0.0-dev';
export const ENGINE_COMMIT: string =
  typeof __VFKB_COMMIT__ !== 'undefined' ? __VFKB_COMMIT__ : 'dev';
