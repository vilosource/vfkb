import { describe, it, expect } from 'vitest';
import { compareTimestamps } from '../src/timestamp.js';
import { heuristicCompare, latestHandoff, retirementRefusal } from '../src/engine.js';
import { materialize } from '../src/storage.js';
import type { StoredRecord } from '../src/storage.js';
import type { KnowledgeEntry } from '../src/types.js';

// vfkb#374: `created`/`updated` were compared as strings. Lexical order is time order only
// when every value has the engine's shape (`YYYY-MM-DDTHH:MM:SS.sssZ`). An imported value
// without milliseconds or with an offset sorted wrongly against engine-written ones:
//  - "…10:00:00Z" > "…10:00:00.500Z" lexically ('Z' 0x5A > '.' 0x2E), though it is earlier;
//  - "…12:00:00.000+03:00" (09:00Z) > "…10:00:00.000Z" lexically, though it is earlier.

const NO_MS = '2026-10-22T10:00:00Z'; // 10:00:00.000Z
const WITH_MS = '2026-10-22T10:00:00.500Z'; // half a second later
const OFFSET = '2026-10-22T12:00:00.000+03:00'; // 09:00:00.000Z
const UTC_10 = '2026-10-22T10:00:00.000Z'; // an hour later than OFFSET

const handoff = (id: string, created: string, updated = created): KnowledgeEntry => ({
  id,
  type: 'fact',
  text: `HANDOFF ${id}`,
  tags: ['handoff', 'next'],
  zone: 'established',
  author: { role: 'human' },
  provenance: { status: 'verified', date: created },
  validity: { valid_from: created },
  created,
  updated,
});

describe('vfkb#374 — compareTimestamps orders by time, not by string', () => {
  it('a value without milliseconds sorts before a later one with them', () => {
    expect(compareTimestamps(NO_MS, WITH_MS)).toBeLessThan(0);
    expect(compareTimestamps(WITH_MS, NO_MS)).toBeGreaterThan(0);
  });
  it('an offset value sorts by its instant', () => {
    expect(compareTimestamps(OFFSET, UTC_10)).toBeLessThan(0);
  });
  it('the same instant in two shapes compares equal', () => {
    expect(compareTimestamps('2026-10-22T10:00:00Z', '2026-10-22T10:00:00.000Z')).toBe(0);
    expect(compareTimestamps('2026-10-22T13:00:00+03:00', '2026-10-22T10:00:00.000Z')).toBe(0);
  });
  it('an unparseable value falls back to string order, as before (never throws)', () => {
    expect(compareTimestamps('not-a-date', 'zzz')).toBeLessThan(0);
    expect(compareTimestamps('', UTC_10)).toBeLessThan(0);
    expect(compareTimestamps(UTC_10, UTC_10)).toBe(0);
  });
});

describe('vfkb#374 — the sites that decide the pin, retire and last-write-wins', () => {
  it('the pin goes to the later handoff when the earlier one has no milliseconds', () => {
    const pin = latestHandoff([handoff('later', WITH_MS), handoff('earlier', NO_MS)], '2026-10-22', new Set());
    expect(pin?.id).toBe('later');
  });

  it('the pin goes to the later handoff when the earlier one carries an offset', () => {
    const pin = latestHandoff([handoff('later', UTC_10), handoff('earlier', OFFSET)], '2026-10-22', new Set());
    expect(pin?.id).toBe('later');
  });

  it('retiring an earlier no-milliseconds handoff by a later one is allowed', () => {
    expect(retirementRefusal(handoff('old', NO_MS), handoff('new', WITH_MS), '2026-10-22', new Set())).toBeNull();
  });

  it('retiring by a handoff that is really older is still refused', () => {
    expect(retirementRefusal(handoff('old', UTC_10), handoff('new', OFFSET), '2026-10-22', new Set())).toMatch(
      /is older/,
    );
  });

  it('last-write-wins keeps the later update when the earlier one has no milliseconds', () => {
    const recs = [
      handoff('x', NO_MS, WITH_MS), // the later update, written first
      { ...handoff('x', NO_MS, NO_MS), text: 'stale copy' }, // an earlier update, appended later
    ] as unknown as StoredRecord[];
    const [e] = materialize(recs);
    expect(e.text).toBe('HANDOFF x');
  });

  it('the recency tiebreak ranks the later update first', () => {
    const a = handoff('a', NO_MS, NO_MS);
    const b = handoff('b', NO_MS, WITH_MS);
    expect([a, b].sort(heuristicCompare).map((e) => e.id)).toEqual(['b', 'a']);
  });
});
