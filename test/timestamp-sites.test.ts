import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { heuristicCompare, latestHandoff, retirementRefusal } from '../src/engine.js';
import { materialize } from '../src/storage.js';
import type { StoredRecord } from '../src/storage.js';
import type { KnowledgeEntry } from '../src/types.js';

// The reproduction half of vfkb#374: every test here drives a surface that existed before the
// fix (the pin, the retire check, materialize, the recency tiebreak, Tier-1 curation), so it
// loads and goes red against the tree that had the bug. The comparator's own unit tests import
// src/timestamp.ts, which that tree lacks, and live in timestamp-order.test.ts.

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
