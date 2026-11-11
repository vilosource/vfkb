import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
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

// #460 review M-1/m-2: Date.parse reads a zone-less date-time as LOCAL time and accepts
// non-dates. Only ISO values are instants, and a zone-less one is read as UTC, so every
// clone of a brain orders it the same way whatever the host timezone.
describe('compareTimestamps — host-independent, ISO only (#460 review)', () => {
  const ZONELESS = '2026-10-22T10:00:00'; // a naive Python isoformat()
  const HALF_PAST_NINE_Z = '2026-10-22T09:30:00.000Z';

  it('reads a zone-less date-time as UTC, and the same in every timezone', () => {
    const CLI = resolve(__dirname, '../dist/timestamp.js');
    const code = `import(${JSON.stringify(pathToFileURL(CLI).href)}).then((m) => console.log(m.compareTimestamps(${JSON.stringify(ZONELESS)}, ${JSON.stringify(HALF_PAST_NINE_Z)})))`;
    const out = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map(
      (tz) => spawnSync('node', ['-e', code], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).stdout.trim(),
    );
    expect(out).toEqual(['1800000', '1800000', '1800000']);
  });

  it('a space separator and a compact offset are ISO too', () => {
    expect(compareTimestamps('2026-10-22 10:00:00', HALF_PAST_NINE_Z)).toBe(1_800_000);
    expect(compareTimestamps('2026-10-22T12:00:00+0300', UTC_10)).toBeLessThan(0);
  });

  it('a non-date keeps the old string order instead of parsing as a date', () => {
    // Date.parse('1') is 2001-01-01 and Date.parse('hello 2026') is 2026-01-01.
    expect(compareTimestamps('1', UTC_10)).toBe(-1); // '1' < '2' as strings
    expect(compareTimestamps('hello 2026', UTC_10)).toBe(1); // 'h' > '2'
    expect(compareTimestamps('unknown', UTC_10)).toBe(1); // still above every ISO value
  });
});

// #460 review round 2 (M-2): background curation measured ages with Date.parse, so a zone-less
// `created` was local time and two clones in different timezones archived different entries.
describe('background curation archives the same entries in every timezone (#460 review)', () => {
  it('a zone-less handoff is ordered as UTC by the Tier-1 rule too', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vfkb-tz-'));
    const h = (id: string, created: string) =>
      JSON.stringify({ ...handoff(id, created), text: `HANDOFF ${id}: what happened, what is next` }) + '\n';
    // N3 is 30 minutes after E in UTC; Asia/Tokyo's local reading made it 8.5 h before E.
    writeFileSync(
      join(dir, 'entries.jsonl'),
      h('E', '2026-10-01T12:00:00.000Z') +
        h('N1', '2026-10-05T00:00:00.000Z') +
        h('N3', '2026-10-01T12:30:00') +
        h('P', '2026-11-01T00:00:00.000Z'),
    );
    const mod = pathToFileURL(resolve(__dirname, '../dist/curator.js')).href;
    const code = `import(${JSON.stringify(mod)}).then((m) => console.log(JSON.stringify(m.autoCurate('2026-11-02', { dryRun: true }).archived)))`;
    const out = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map((tz) => {
      const env: NodeJS.ProcessEnv = { ...process.env, TZ: tz, VFKB_DATA_DIR: dir };
      delete env.VFKB_DIR;
      return spawnSync('node', ['-e', code], { env, encoding: 'utf8' }).stdout.trim();
    });
    expect(out).toEqual(['["E"]', '["E"]', '["E"]']);
  });
});
