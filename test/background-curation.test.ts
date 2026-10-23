import { describe, it, expect, beforeEach } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ADR-0083 (accepts RFC-046): Tier 1 of background curation. A deterministic rule
// archives a live handoff-shaped fact only when (1) it is a pin candidate and not the
// pin, (2) it is handoff-shaped, (3) it was created >= 14 days before the pin, (4) >= 3
// live shaped pin candidates were created after it, (5) any topic tag it carries is
// shared by one of those newer handoffs, and (6) no line of its id carries
// `curation-kept`. Candidates are checked newest-first. Fixtures are raw JSONL lines
// with explicit timestamps, so ordering never depends on the wall clock.
let dir = '';
function freshBrain() {
  dir = mkdtempSync(join(tmpdir(), 'vfkb-bgc-'));
  process.env.VFKB_DIR = dir;
  delete process.env.VFKB_DATA_DIR;
  delete process.env.KB_SESSION_ID;
}

import { readAll, renderContextBundle } from '../src/engine.js';
import { archive, autoCurate, autoArchiveLog, restore, AUTO_ARCHIVED, CURATION_KEPT } from '../src/curator.js';

type Raw = { id: string; text?: string; tags?: string[]; zone?: string; created: string; updated?: string; type?: string };
function rec(r: Raw) {
  const line = {
    id: r.id,
    type: r.type ?? 'fact',
    text: r.text ?? `HANDOFF ${r.id}: what happened, what is next`,
    tags: r.tags ?? ['handoff', 'next'],
    zone: r.zone ?? 'established',
    author: { role: 'human' },
    provenance: { status: 'verified', date: r.created },
    validity: { valid_from: r.created },
    created: r.created,
    updated: r.updated ?? r.created,
  };
  appendFileSync(join(dir, 'entries.jsonl'), JSON.stringify(line) + '\n');
}
const brainBytes = () => readFileSync(join(dir, 'entries.jsonl'), 'utf8');
const byId = (id: string) => readAll().find((e) => e.id === id)!;
const day = (d: number) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString();
const TODAY = '2026-03-01';
const archivedIds = () => readAll().filter((e) => e.zone === 'archive').map((e) => e.id).sort();

// Pin at day 40, three newer shaped handoffs at days 30/35/40 (pin included).
function chain() {
  rec({ id: 'n1', created: day(30) });
  rec({ id: 'n2', created: day(35) });
  rec({ id: 'pin', created: day(40) });
}

describe('ADR-0083 §2 — the Tier-1 rule', () => {
  beforeEach(freshBrain);

  it('archives an old shaped handoff with >= 3 newer shaped handoffs, tagged with the rule and date', () => {
    rec({ id: 'old', created: day(0) });
    chain();
    const r = autoCurate(TODAY);
    expect(r.archived).toEqual(['old']);
    const e = byId('old');
    expect(e.zone).toBe('archive');
    expect(e.tags).toContain(`${AUTO_ARCHIVED}old-handoff@${TODAY}`);
  });

  it('never archives the pin', () => {
    rec({ id: 'a', created: day(0) });
    rec({ id: 'b', created: day(1) });
    rec({ id: 'c', created: day(2) });
    rec({ id: 'pin', created: day(100) });
    autoCurate(TODAY);
    expect(byId('pin').zone).toBe('established');
  });

  it('never archives a topical (unshaped) fact', () => {
    rec({ id: 'topical', text: 'SHIPPED 2026-01-01: PR #1 merged', created: day(0) });
    chain();
    rec({ id: 'n3', created: day(20) });
    autoCurate(TODAY);
    expect(byId('topical').zone).toBe('established');
  });

  it('never archives a shaped fact created less than 14 days before the pin', () => {
    rec({ id: 'young', created: day(27) }); // 13 days before the pin
    rec({ id: 'x1', created: day(28) });
    chain();
    autoCurate(TODAY);
    expect(byId('young').zone).toBe('established');
  });

  it('archives at exactly 14 days before the pin', () => {
    rec({ id: 'edge', created: day(26) });
    rec({ id: 'x1', created: day(28) });
    chain();
    expect(autoCurate(TODAY).archived).toContain('edge');
  });

  it('needs 3 newer LIVE shaped handoffs: an archived one does not count', () => {
    rec({ id: 'old', created: day(0) });
    rec({ id: 'n1', created: day(30), zone: 'archive' });
    rec({ id: 'n2', created: day(35) });
    rec({ id: 'pin', created: day(40) });
    autoCurate(TODAY);
    expect(byId('old').zone).toBe('established');
  });

  it('an unshaped pin does not count toward the 3 newer handoffs', () => {
    rec({ id: 'old', created: day(0) });
    rec({ id: 'n1', created: day(30) });
    rec({ id: 'n2', created: day(35) });
    rec({ id: 'pin', text: 'NEXT-SESSION TASK: a topical pin', created: day(40) });
    autoCurate(TODAY);
    expect(byId('old').zone).toBe('established');
  });

  it('same-stream guard: a topic tag no newer handoff shares holds it back', () => {
    rec({ id: 'jev', tags: ['handoff', 'next', 'jev'], created: day(0) });
    chain();
    autoCurate(TODAY);
    expect(byId('jev').zone).toBe('established');
  });

  it('same-stream guard: a newer handoff sharing one topic tag clears it', () => {
    rec({ id: 'jev', tags: ['handoff', 'next', 'jev', 'probe'], created: day(0) });
    rec({ id: 'n1', tags: ['handoff', 'next', 'jev'], created: day(30) });
    rec({ id: 'n2', created: day(35) });
    rec({ id: 'pin', created: day(40) });
    expect(autoCurate(TODAY).archived).toEqual(['jev']);
  });

  it('same-stream guard: generic tags (lifecycle and kind-of-work) are not a stream', () => {
    rec({ id: 'old', tags: ['handoff', 'next', 'status', 'v3', 'rfc', 'review', 'plugin'], created: day(0) });
    chain();
    expect(autoCurate(TODAY).archived).toEqual(['old']);
  });

  it('never archives an id with curation-kept on ANY line, even an older one', () => {
    rec({ id: 'kept', tags: ['handoff', 'next', CURATION_KEPT], created: day(0) });
    rec({ id: 'kept', tags: ['handoff', 'next'], created: day(0), updated: day(1) }); // newer line lacks it
    chain();
    autoCurate(TODAY);
    expect(byId('kept').zone).toBe('established');
  });

  it('checks newest-first: a handoff archived in this run does not clear an older one', () => {
    // oldest → newest: X[p12], Y[p12,q], Z[q], W[q], then n1/n2/pin.
    rec({ id: 'X', tags: ['handoff', 'next', 'p12'], created: day(0) });
    rec({ id: 'Y', tags: ['handoff', 'next', 'p12', 'q'], created: day(1) });
    rec({ id: 'Z', tags: ['handoff', 'next', 'q'], created: day(2) });
    rec({ id: 'W', tags: ['handoff', 'next', 'q'], created: day(3) });
    chain();
    const r = autoCurate(TODAY);
    expect(r.archived).toContain('Y');
    expect(byId('X').zone).toBe('established'); // Y, its only same-stream successor, went first
  });

  it('never touches text, and is idempotent', () => {
    rec({ id: 'old', created: day(0) });
    chain();
    const before = byId('old').text;
    autoCurate(TODAY);
    expect(byId('old').text).toBe(before);
    const bytes = brainBytes();
    expect(autoCurate(TODAY).archived).toEqual([]);
    expect(brainBytes()).toBe(bytes);
  });

  it('skips a candidate whose created does not parse', () => {
    rec({ id: 'bad', created: '' });
    rec({ id: 'old', created: day(0) });
    chain();
    expect(autoCurate(TODAY).archived).toEqual(['old']);
    expect(byId('bad').zone).toBe('established');
  });

  it('an unparseable created cannot scramble the newest-first order of the others', () => {
    // A NaN in the sort comparator misorders the valid entries; newest-first then
    // archives X, which Y (archived first) should have held back. File order matters.
    rec({ id: 'X', tags: ['handoff', 'next', 'p12'], created: day(0) });
    rec({ id: 'bad', tags: ['handoff', 'next', 'zz'], created: '' });
    rec({ id: 'Y', tags: ['handoff', 'next', 'p12', 'q'], created: day(1) });
    rec({ id: 'Z', tags: ['handoff', 'next', 'q'], created: day(2) });
    rec({ id: 'n1', created: day(30) });
    rec({ id: 'W', tags: ['handoff', 'next', 'q'], created: day(3) });
    rec({ id: 'n2', created: day(35) });
    rec({ id: 'pin', created: day(40) });
    expect(autoCurate(TODAY).archived.sort()).toEqual(['Y', 'Z']);
  });

  it('reports, rather than silently skips, a pin whose created does not parse', () => {
    rec({ id: 'old', created: day(0) });
    chain();
    rec({ id: 'odd', text: 'a topical fact', created: 'unknown' }); // string-max: becomes the pin
    const r = autoCurate(TODAY);
    expect(r.archived).toEqual([]);
    expect(r.skipped).toMatch(/pin odd has an unparseable created/);
  });

  it('compares created as instants: a timezone offset cannot make an older entry "newer"', () => {
    rec({ id: 'X', created: '2026-01-01T00:00:00.000Z' });
    // later as a string, but 2025-12-31T20:00Z as an instant — older than X
    rec({ id: 'A', created: '2026-01-01T01:00:00.000+05:00' });
    rec({ id: 'B', created: day(30) });
    rec({ id: 'pin', created: day(40) });
    autoCurate(TODAY);
    expect(byId('X').zone).toBe('established'); // only B and the pin are newer
  });

  it('a dry run writes nothing', () => {
    rec({ id: 'old', created: day(0) });
    chain();
    const bytes = brainBytes();
    expect(autoCurate(TODAY, { dryRun: true }).archived).toEqual(['old']);
    expect(brainBytes()).toBe(bytes);
  });
});

describe('ADR-0083 §2 — restore and the sticky repair', () => {
  beforeEach(freshBrain);

  it('restoring an auto-archived entry drops the rule tag, adds curation-kept, and the rule leaves it alone', () => {
    rec({ id: 'old', created: day(0) });
    chain();
    autoCurate(TODAY);
    restore('old');
    const e = byId('old');
    expect(e.zone).toBe('established');
    expect(e.tags.some((t) => t.startsWith(AUTO_ARCHIVED))).toBe(false);
    expect(e.tags).toContain(CURATION_KEPT);
    expect(autoCurate(TODAY).archived).toEqual([]);
  });

  it('restoring a hand-archived entry does NOT add curation-kept (ADR-0082 §4 unchanged)', () => {
    rec({ id: 'old', created: day(0) });
    chain();
    archive('old');
    restore('old');
    expect(byId('old').tags).not.toContain(CURATION_KEPT);
  });

  it('repairs a cross-branch re-archive of a kept entry', () => {
    // branch A: rule archive, then restore (kept); branch B (forked before): a later rule archive.
    rec({ id: 'old', created: day(0) });
    chain();
    rec({ id: 'old', zone: 'archive', tags: ['handoff', 'next', `${AUTO_ARCHIVED}old-handoff@2026-02-01`], created: day(0), updated: day(50) });
    rec({ id: 'old', tags: ['handoff', 'next', CURATION_KEPT], created: day(0), updated: day(51) });
    rec({ id: 'old', zone: 'archive', tags: ['handoff', 'next', `${AUTO_ARCHIVED}old-handoff@2026-02-10`], created: day(0), updated: day(52) });
    expect(byId('old').zone).toBe('archive');
    const r = autoCurate(TODAY);
    expect(r.repaired).toEqual(['old']);
    const e = byId('old');
    expect(e.zone).toBe('established');
    expect(e.tags).toContain(CURATION_KEPT);
    expect(e.tags.some((t) => t.startsWith(AUTO_ARCHIVED))).toBe(false);
  });

  it("does not repair when the operator's own later archive is the newest non-rule line", () => {
    rec({ id: 'old', created: day(0) });
    chain();
    rec({ id: 'old', tags: ['handoff', 'next', CURATION_KEPT], created: day(0), updated: day(50) });
    rec({ id: 'old', zone: 'archive', tags: ['handoff', 'next', CURATION_KEPT], created: day(0), updated: day(51) }); // operator archive
    rec({ id: 'old', zone: 'archive', tags: ['handoff', 'next', `${AUTO_ARCHIVED}old-handoff@2026-02-10`], created: day(0), updated: day(52) });
    expect(autoCurate(TODAY).repaired).toEqual([]);
    expect(byId('old').zone).toBe('archive');
  });

  it('newest means by `updated`, not file position', () => {
    rec({ id: 'old', created: day(0) });
    chain();
    // the operator archive is written LATER in the file but is OLDER by `updated`
    rec({ id: 'old', zone: 'archive', tags: ['handoff', 'next', `${AUTO_ARCHIVED}old-handoff@2026-02-10`], created: day(0), updated: day(52) });
    rec({ id: 'old', tags: ['handoff', 'next', CURATION_KEPT], created: day(0), updated: day(51) });
    rec({ id: 'old', zone: 'archive', tags: ['handoff', 'next'], created: day(0), updated: day(49) });
    expect(autoCurate(TODAY).repaired).toEqual(['old']);
  });
});

describe('ADR-0083 §5 — the log and the briefing line (read-only)', () => {
  beforeEach(freshBrain);

  it('the briefing has no curation line when nothing was auto-archived', () => {
    rec({ id: 'old', created: day(0) });
    chain();
    expect(renderContextBundle('p')).not.toContain('Curation:');
  });

  it('the briefing reports recent auto-archives with the undo, and rendering writes nothing', () => {
    rec({ id: 'old', created: day(0) });
    chain();
    const today = new Date().toISOString().slice(0, 10);
    autoCurate(today);
    const bytes = brainBytes();
    const out = renderContextBundle('p');
    expect(out).toMatch(/Curation: auto-archived 1 old handoff in the last 7 days/);
    expect(out).toContain('vfkb curate log');
    expect(out).toContain('vfkb curate restore <id>');
    expect(out.indexOf('Curation:')).toBeGreaterThan(out.indexOf('## Last handoff'));
    expect(brainBytes()).toBe(bytes);
  });

  it('auto-archives dated after today are not counted', () => {
    rec({ id: 'old', zone: 'archive', tags: ['handoff', 'next', `${AUTO_ARCHIVED}old-handoff@2999-01-01`], created: day(0) });
    chain();
    expect(renderContextBundle('p')).not.toContain('Curation:');
  });

  it('auto-archives dated more than 7 days ago are not counted', () => {
    rec({ id: 'old', zone: 'archive', tags: ['handoff', 'next', `${AUTO_ARCHIVED}old-handoff@2020-01-01`], created: day(0) });
    chain();
    expect(renderContextBundle('p')).not.toContain('Curation:');
  });

  it('the log lists auto-archived entries with rule and date, and writes nothing', () => {
    rec({ id: 'old', created: day(0) });
    rec({ id: 'other', tags: ['handoff', 'next', 'jev'], created: day(1) }); // held by the stream guard
    chain();
    autoCurate(TODAY);
    archive('other'); // hand-archive: not in the log
    const bytes = brainBytes();
    const log = autoArchiveLog();
    expect(log.map((r) => r.id)).toEqual(['old']);
    expect(log[0]).toMatchObject({ rule: 'old-handoff', date: TODAY });
    expect(brainBytes()).toBe(bytes);
    expect(archivedIds()).toEqual(['old', 'other']);
  });
});
