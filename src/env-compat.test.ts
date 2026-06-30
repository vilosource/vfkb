// ADR-0032 — env var rename with back-compat: VFKB_DATA_DIR is canonical,
// VFKB_DIR is a kept-working deprecated alias. (The bundle-var alias
// VFKB_BUNDLE_DIR/VFKB_HOME is covered by src/bootstrap.test.ts + doctor.test.ts.)

import { describe, it, expect, afterEach } from 'vitest';
import { brainDir } from './storage.js';

const saved = { data: process.env.VFKB_DATA_DIR, dir: process.env.VFKB_DIR };
const restore = (k: 'VFKB_DATA_DIR' | 'VFKB_DIR', v: string | undefined) =>
  v === undefined ? delete process.env[k] : (process.env[k] = v);

afterEach(() => {
  restore('VFKB_DATA_DIR', saved.data);
  restore('VFKB_DIR', saved.dir);
});

describe('env var back-compat (ADR-0032)', () => {
  it('VFKB_DATA_DIR is canonical and takes precedence over VFKB_DIR', () => {
    process.env.VFKB_DATA_DIR = '/canonical';
    process.env.VFKB_DIR = '/legacy';
    expect(brainDir()).toBe('/canonical');
  });

  it('VFKB_DIR still resolves the brain as a deprecated alias', () => {
    delete process.env.VFKB_DATA_DIR;
    process.env.VFKB_DIR = '/legacy';
    expect(brainDir()).toBe('/legacy');
  });
});
