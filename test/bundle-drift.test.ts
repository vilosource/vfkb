// Deterministic backstop for the engine-delivery drift signal (ADR-0062).
//
// The signal compares STAMP-NORMALIZED bundle bytes; these tests pin the
// normalization against the exact literals esbuild `define` emits
// (scripts/build-bundles.mjs). If the stamp shape ever changes there, these go
// red deterministically — instead of the normalization silently missing the new
// shape and the workflow false-firing a re-vendor PR on every vfkb commit.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs module without type declarations
import { normalizeBundle, fingerprint, BUNDLES, vendoredBundles } from '../scripts/bundle-drift.mjs';

// The real emitted shapes, verbatim from built bundles (observed 2026-07-16).
const stamped = (commit: string, version: string) =>
  `#!/usr/bin/env node\n` +
  `var ENGINE_VERSION = true ? "${version}" : ownPackageVersion();\n` +
  `var ENGINE_COMMIT = true ? "${commit}" : "dev";\n` +
  `console.log("engine body");\n`;

describe('bundle-drift normalization (ADR-0062)', () => {
  it('identical source under different stamps normalizes equal', () => {
    expect(normalizeBundle(stamped('c73cf8e', '0.2.1'))).toBe(normalizeBundle(stamped('b1d5d11', '0.2.3')));
  });

  it('a real body change still differs after normalization (the signal can fire)', () => {
    const changed = stamped('c73cf8e', '0.2.1').replace('engine body', 'engine body CHANGED');
    expect(normalizeBundle(changed)).not.toBe(normalizeBundle(stamped('c73cf8e', '0.2.1')));
  });

  it('normalization touches ONLY the two stamp literals', () => {
    const text = stamped('abc1234', '9.9.9');
    const normalized = normalizeBundle(text);
    expect(normalized).toContain('__STAMP__');
    expect(normalized).not.toContain('abc1234');
    expect(normalized).not.toContain('9.9.9');
    // everything that is not a stamp is byte-preserved
    expect(normalized).toContain('console.log("engine body");');
    expect(normalized).toContain('#!/usr/bin/env node');
  });

  it('fingerprint covers every bundle present, and throws when an EXPECTED one is missing', () => {
    // The contract changed with ADR-0066: consumers vendor different SUBSETS (the Claude
    // plugin ships 2 of 4, the pi package 4 of 4). So bare `fingerprint(dir)` auto-detects
    // what is there, while `fingerprint(dir, names)` — the form the CLI uses, passing the
    // vendored dir's own contents — still THROWS on a name it was told to expect.
    // Hard-coding all four and throwing unconditionally broke the plugin's
    // engine-delivery workflow: it exited 2 ("comparison broke") on every push.
    const dir = mkdtempSync(join(tmpdir(), 'drift-test-'));
    try {
      for (const name of BUNDLES) writeFileSync(join(dir, name), stamped('aaaaaaa', '1.0.0'));
      expect(Object.keys(fingerprint(dir)).sort()).toEqual([...BUNDLES].sort());

      rmSync(join(dir, BUNDLES[0]));
      // Auto-detect: a subset is a legitimate consumer, not an error.
      expect(Object.keys(fingerprint(dir)).sort()).toEqual(BUNDLES.slice(1).sort());
      // Explicit expectation: still an error, which is what keeps a vendored bundle
      // that silently vanished from passing as "clean".
      expect(() => fingerprint(dir, [...BUNDLES])).toThrow(/missing bundle/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('vendoredBundles reports exactly what a consumer ships', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drift-subset-'));
    try {
      // Mimic the Claude plugin: the CLI + MCP pair only.
      for (const name of ['vfkb.mjs', 'vfkb-mcp.mjs']) writeFileSync(join(dir, name), stamped('aaaaaaa', '1.0.0'));
      expect(vendoredBundles(dir).sort()).toEqual(['vfkb-mcp.mjs', 'vfkb.mjs']);
      expect(() => fingerprint(dir, vendoredBundles(dir))).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The load-bearing case (review of vfkb#182, minor finding): the synthetic
  // cases above pin the regexes against HAND-COPIED literals — if a toolchain
  // upgrade changes the REAL emitted stamp shape, they stay green while the
  // normalization silently misses and every vfkb commit becomes a false DRIFT
  // (re-vendor PR churn). So build the real bundles and assert the regexes
  // actually bite them, in the observed per-bundle counts.
  it('the REAL build emits stamps the normalization actually matches', async () => {
    // @ts-expect-error — plain .mjs module without type declarations
    const { buildBundles } = await import('../scripts/build-bundles.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'drift-real-'));
    try {
      await buildBundles(dir);
      const cli = readFileSync(join(dir, 'vfkb.mjs'), 'utf8');
      const mcp = readFileSync(join(dir, 'vfkb-mcp.mjs'), 'utf8');
      const commitRe = /ENGINE_COMMIT\d* = true \? "[^"]*" : "dev"/g;
      const versionRe = /ENGINE_VERSION\d* = true \? "[^"]*" : ownPackageVersion\d*\(/g;
      // Observed shape 2026-07-16: CLI carries both stamps once; MCP only the
      // version stamp (ENGINE_COMMIT is tree-shaken out of that entry).
      expect(cli.match(commitRe)?.length ?? 0).toBe(1);
      expect(cli.match(versionRe)?.length ?? 0).toBe(1);
      expect(mcp.match(versionRe)?.length ?? 0).toBe(1);
      // ...and normalization genuinely rewrites every bundle that carries a stamp.
      expect(normalizeBundle(cli)).not.toBe(cli);
      expect(normalizeBundle(mcp)).not.toBe(mcp);
      // A commit-stamp reappearing in MCP would also be normalized, not missed.
      // (Sentinel must be collision-proof: 'fffffff' occurs naturally in the
      // bundle's own hex constants and failed exactly this assertion.)
      const sentinel = 'probe0commit0zz';
      expect(mcp).not.toContain(sentinel); // precondition, so the assert below is meaningful
      expect(normalizeBundle(mcp + stamped(sentinel, '0.0.1'))).not.toContain(sentinel);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
