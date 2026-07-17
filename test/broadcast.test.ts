import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { broadcast } from '../src/broadcast.js';

// A valid broadcast target: a repo dir with an adopted brain (manifest present).
function makeTarget(schema: unknown = 1): string {
  const repo = mkdtempSync(join(tmpdir(), 'vfkb-bcast-target-'));
  mkdirSync(join(repo, '.vfkb'), { recursive: true });
  writeFileSync(join(repo, '.vfkb', 'manifest.json'), JSON.stringify({ schema_version: schema }));
  return repo;
}

const entriesOf = (repo: string) =>
  readFileSync(join(repo, '.vfkb', 'entries.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

beforeEach(() => {
  // The invoking session's own identity — origin must derive from HERE, not a target.
  process.env.VFKB_PROJECT = 'originproj';
  process.env.VFKB_DATA_DIR = mkdtempSync(join(tmpdir(), 'vfkb-bcast-origin-'));
  delete process.env.KB_SESSION_ID;
});

describe('vfkb broadcast (ADR-0063 §3)', () => {
  it('writes one engine-stamped record per target: marker, origin, date, cross-repo tag', () => {
    const repo = makeTarget();
    const [r] = broadcast('migrated the wiring; restart sessions', [repo], { op: 'wiring-migration', tags: ['plugin'] });
    expect(r.ok).toBe(true);
    expect(r.posture).toMatch(/uncommitted/);
    const entries = entriesOf(repo);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.id).toBe(r.id);
    expect(e.text).toMatch(/^CROSS-REPO WIRING-MIGRATION \(\d{4}-\d{2}-\d{2}, from originproj\): migrated the wiring/);
    expect(e.tags).toContain('cross-repo');
    expect(e.tags).toContain('plugin');
    expect(e.tags).not.toContain('handoff');
    expect(e.tags).not.toContain('next');
  });

  it('does not double-stamp a text that already carries the COMPLETE marker', () => {
    const repo = makeTarget();
    broadcast('CROSS-REPO CUSTOM (2026-07-17, from elsewhere): prestamped', [repo]);
    expect(entriesOf(repo)[0].text.match(/CROSS-REPO/g)).toHaveLength(1);
  });

  it('a bare CROSS-REPO prefix does NOT waive stamping — origin and date are never lost', () => {
    const repo = makeTarget();
    broadcast('CROSS-REPO sneaky text with no origin or date', [repo]);
    const e = entriesOf(repo)[0];
    expect(e.text).toMatch(/^CROSS-REPO OPERATION \(\d{4}-\d{2}-\d{2}, from originproj\): CROSS-REPO sneaky/);
  });

  it('duplicate targets (path spellings included) write exactly one record', () => {
    const repo = makeTarget();
    const results = broadcast('note', [repo, `${repo}/`, join(repo, '.vfkb')]);
    expect(results.map((r) => r.ok)).toEqual([true, false, false]);
    expect(results[1].reason).toMatch(/duplicate target/);
    expect(entriesOf(repo)).toHaveLength(1);
  });

  it('refuses a target with no brain and creates NOTHING there (never bootstrap)', () => {
    const bare = mkdtempSync(join(tmpdir(), 'vfkb-bcast-bare-'));
    const [r] = broadcast('note', [bare]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no brain/);
    expect(existsSync(join(bare, '.vfkb'))).toBe(false);
  });

  it('refuses an unsupported brain schema (doctor diagnostic promoted to hard refusal)', () => {
    const repo = makeTarget(99);
    const [r] = broadcast('note', [repo]);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/schema 99 unsupported/);
    expect(existsSync(join(repo, '.vfkb', 'entries.jsonl'))).toBe(false);
  });

  it('throws on handoff/next tags — the resident pin is not the visitor channel (ADR-0063 §1)', () => {
    const repo = makeTarget();
    expect(() => broadcast('note', [repo], { tags: ['handoff'] })).toThrow(/forbidden/);
    expect(() => broadcast('note', [repo], { tags: ['next'] })).toThrow(/forbidden/);
    expect(existsSync(join(repo, '.vfkb', 'entries.jsonl'))).toBe(false);
  });

  it('a partial broadcast is visible: good targets written, bad targets refused per-target', () => {
    const good = makeTarget();
    const bare = mkdtempSync(join(tmpdir(), 'vfkb-bcast-bare2-'));
    const results = broadcast('sweep note', [good, bare]);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(entriesOf(good)).toHaveLength(1);
  });

  it('restores the invoking session VFKB_DATA_DIR — the origin brain is untouched', () => {
    const before = process.env.VFKB_DATA_DIR;
    const repo = makeTarget();
    broadcast('note', [repo]);
    expect(process.env.VFKB_DATA_DIR).toBe(before);
    expect(existsSync(join(before!, 'entries.jsonl'))).toBe(false);
  });

  it('accepts an explicit .vfkb path as the target', () => {
    const repo = makeTarget();
    const [r] = broadcast('note', [join(repo, '.vfkb')]);
    expect(r.ok).toBe(true);
    expect(entriesOf(repo)).toHaveLength(1);
  });
});
