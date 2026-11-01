import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped .mjs scenario lib
import { engineRevFromBundle } from '../scenarios/lib/engine-rev.mjs';

describe('engineRevFromBundle (vfkb#395 decide: engineRev read off the bundle bytes)', () => {
  it('reads the v0.23.0 candidate stamp', () => {
    expect(engineRevFromBundle('x\nvar ENGINE_COMMIT = true ? "7a9348a" : "dev";\ny')).toBe('7a9348a');
  });
  it('reads the v0.22.0 stamp, so RED and GREEN records differ by engineRev alone', () => {
    expect(engineRevFromBundle('var ENGINE_COMMIT2 = true ? "e2ac6e9" : "dev";')).toBe('e2ac6e9');
  });
  it('returns null for a bundle without a stamp, or a dev-only stamp', () => {
    expect(engineRevFromBundle('console.log(1)')).toBeNull();
    expect(engineRevFromBundle('var ENGINE_COMMIT = true ? "dev" : "dev";')).toBeNull();
    expect(engineRevFromBundle(undefined)).toBeNull();
  });
});
