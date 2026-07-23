#!/usr/bin/env node
// Engine-delivery drift signal (plugin#23 / ADR-0062) — does the plugin vendor
// the engine that vfkb main builds today?
//
// The comparison is over NORMALIZED bundle bytes. `scripts/build-bundles.mjs`
// stamps engine identity into the output via esbuild `define`:
//
//   ENGINE_COMMIT = true ? "<short-sha>" : "dev"            (vfkb.mjs)
//   ENGINE_VERSION = true ? "<pkg-version>" : ownPackageVersion(  (both bundles)
//
// Both stamps change WITHOUT any behavioral change — the commit on every vfkb
// commit, the version on every release-please bump — so raw hashes would fire
// the re-vendor signal on every push, forever. Normalizing exactly those two
// literals (and nothing else) means the signal fires only when bytes a consumer
// RUNS have changed. Deliberate consequence: a stamp-only lag (the vendored
// bundle reporting an older version/commit string in `vfkb --version`) does NOT
// trigger a re-vendor — cosmetic identity lag is `vfkb doctor` territory, not a
// delivery event.
//
// Usage:
//   node scripts/bundle-drift.mjs <freshBundlesDir> <vendoredBundlesDir>
// Exit: 0 = CLEAN (no drift) · 1 = DRIFT · 2 = error (missing files etc.)
// The distinct drift/error codes matter: a workflow must never read "the
// comparison itself broke" as either answer.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Every bundle a downstream repo vendors. The pi pair (ADR-0066) is vendored by
// vfkb-pi-package exactly as the first two are by vfkb-claude-plugin — omitting them
// would leave the stale-vendoring detector blind to half the artifacts it exists for.
export const BUNDLES = ['vfkb.mjs', 'vfkb-mcp.mjs', 'vfkb-pi.mjs', 'vfkb-pi-bridge.mjs'];

export function normalizeBundle(text) {
  // `\d*` on the identifiers: esbuild resolves name collisions by suffixing
  // (`join` → `join10`, observed in these bundles), so a future collision on
  // ENGINE_COMMIT/ENGINE_VERSION/ownPackageVersion must not silently stop the
  // normalization and turn every vfkb commit into a false DRIFT.
  return text
    .replace(/(ENGINE_COMMIT\d* = true \? ")[^"]*(" : "dev")/g, '$1__STAMP__$2')
    .replace(/(ENGINE_VERSION\d* = true \? ")[^"]*(" : ownPackageVersion\d*\()/g, '$1__STAMP__$2');
}

/** { "vfkb.mjs": <sha256 of normalized bytes>, ... } — throws on a missing file. */
export function fingerprint(dir) {
  const out = {};
  for (const name of BUNDLES) {
    const p = join(dir, name);
    if (!existsSync(p)) throw new Error(`missing bundle ${p}`);
    out[name] = createHash('sha256').update(normalizeBundle(readFileSync(p, 'utf8'))).digest('hex');
  }
  return out;
}

// CLI
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [freshDir, vendoredDir] = process.argv.slice(2);
  if (!freshDir || !vendoredDir) {
    console.error('usage: node scripts/bundle-drift.mjs <freshBundlesDir> <vendoredBundlesDir>');
    process.exit(2);
  }
  let fresh;
  let vendored;
  try {
    fresh = fingerprint(freshDir);
    vendored = fingerprint(vendoredDir);
  } catch (e) {
    console.error(`bundle-drift: ${e.message}`);
    process.exit(2);
  }
  let drift = false;
  for (const name of BUNDLES) {
    const same = fresh[name] === vendored[name];
    if (!same) drift = true;
    console.log(`${same ? 'CLEAN' : 'DRIFT'}  ${name}  fresh=${fresh[name].slice(0, 12)}  vendored=${vendored[name].slice(0, 12)}`);
  }
  console.log(drift
    ? '\nDRIFT — the plugin vendors a different engine than vfkb main builds (re-vendor due)'
    : '\nCLEAN — vendored bundles match (stamps normalized)');
  process.exit(drift ? 1 : 0);
}
