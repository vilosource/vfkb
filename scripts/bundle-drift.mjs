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

// Every bundle the engine BUILDS. Different consumers vendor different subsets:
// vfkb-claude-plugin ships the CLI + MCP pair; vfkb-pi-package (ADR-0066) ships those
// plus the pi pair. So this list is the universe, and `fingerprint` compares only the
// INTERSECTION actually present in the vendored dir.
//
// Hard-coding all four and throwing on a missing one broke the plugin's engine-delivery
// workflow the moment the pi bundles were added: the plugin vendors two, so the drift
// detector exited 2 ("comparison broke") on every push to main and stopped answering
// clean-or-drift at all. A detector that cannot run is worse than one that is narrow.
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

/**
 * { "vfkb.mjs": <sha256 of normalized bytes>, ... } for the bundles present in `dir`.
 *
 * `only` (optional) restricts the set — the CLI passes the VENDORED dir's contents so a
 * consumer that ships a subset is compared on exactly what it ships. A bundle the
 * consumer does not vendor is not drift; a bundle it vendors that the engine no longer
 * builds IS, and still throws.
 */
export function fingerprint(dir, only) {
  const names = (only ?? BUNDLES).filter((n) => (only ? true : existsSync(join(dir, n))));
  if (!names.length) throw new Error(`no known vfkb bundles found in ${dir}`);
  const out = {};
  for (const name of names) {
    const p = join(dir, name);
    if (!existsSync(p)) throw new Error(`missing bundle ${p}`);
    out[name] = createHash('sha256').update(normalizeBundle(readFileSync(p, 'utf8'))).digest('hex');
  }
  return out;
}

/** The bundles a consumer actually vendors — the set the comparison should cover. */
export function vendoredBundles(dir) {
  return BUNDLES.filter((n) => existsSync(join(dir, n)));
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
    // Compare on what the CONSUMER vendors, so a subset-vendoring repo (the Claude
    // plugin ships 2 of 4) is still answerable instead of erroring out.
    const names = vendoredBundles(vendoredDir);
    fresh = fingerprint(freshDir, names);
    vendored = fingerprint(vendoredDir, names);
  } catch (e) {
    console.error(`bundle-drift: ${e.message}`);
    process.exit(2);
  }
  let drift = false;
  // Iterate the COMPARED set, not the universe: a consumer that vendors a subset would
  // otherwise index undefined and crash the detector rather than report on it.
  for (const name of Object.keys(vendored)) {
    const same = fresh[name] === vendored[name];
    if (!same) drift = true;
    console.log(`${same ? 'CLEAN' : 'DRIFT'}  ${name}  fresh=${fresh[name].slice(0, 12)}  vendored=${vendored[name].slice(0, 12)}`);
  }
  console.log(drift
    ? '\nDRIFT — this consumer vendors a different engine than vfkb main builds (re-vendor due)'
    : '\nCLEAN — vendored bundles match (stamps normalized)');
  process.exit(drift ? 1 : 0);
}
