import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareTimestamps } from '../src/timestamp.js';

// vfkb#374: `created`/`updated` were compared as strings. Lexical order is time order only
// when every value has the engine's shape (`YYYY-MM-DDTHH:MM:SS.sssZ`). An imported value
// without milliseconds or with an offset sorted wrongly against engine-written ones:
//  - "…10:00:00Z" > "…10:00:00.500Z" lexically ('Z' 0x5A > '.' 0x2E), though it is earlier;
//  - "…12:00:00.000+03:00" (09:00Z) > "…10:00:00.000Z" lexically, though it is earlier.

const NO_MS = '2026-10-22T10:00:00Z'; // 10:00:00.000Z
const WITH_MS = '2026-10-22T10:00:00.500Z'; // half a second later
const OFFSET = '2026-10-22T12:00:00.000+03:00'; // 09:00:00.000Z
const UTC_10 = '2026-10-22T10:00:00.000Z'; // an hour later than OFFSET

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
