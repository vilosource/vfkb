import { describe, it, expect, beforeEach } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ADR-0082 (R7, accepts RFC-045): the pin is the newest-CREATED injectable handoff/next
// FACT (§1), it renders its id (§3), `retires` / `curate retire` archive a predecessor
// handoff under a scope check (§4), and the curate reports are read-only (§6).
// Fixtures are raw JSONL lines with explicit timestamps, so ordering never depends on
// the wall clock (consecutive addEntry calls can share a millisecond).
let dir = '';
function freshBrain() {
  dir = mkdtempSync(join(tmpdir(), 'vfkb-r7-'));
  process.env.VFKB_DIR = dir;
  delete process.env.VFKB_DATA_DIR;
  delete process.env.KB_SESSION_ID;
}

import { addEntry, latestHandoff, readAll, renderContextBundle, updateEntry } from '../src/engine.js';
import { archive, promote, retire, restore, handoffReport, staleReport } from '../src/curator.js';

type Raw = {
  id: string;
  type?: string;
  text?: string;
  tags?: string[];
  zone?: string;
  created: string;
  updated?: string;
  status?: string;
  role?: string;
};
function rec(r: Raw) {
  const line = {
    id: r.id,
    type: r.type ?? 'fact',
    text: r.text ?? `text of ${r.id}`,
    tags: r.tags ?? ['handoff'],
    zone: r.zone ?? 'established',
    author: { role: r.role ?? 'human' },
    provenance: { status: 'verified', date: r.created },
    validity: { valid_from: r.created },
    status: r.status,
    created: r.created,
    updated: r.updated ?? r.created,
  };
  appendFileSync(join(dir, 'entries.jsonl'), JSON.stringify(line) + '\n');
}
const brainBytes = () => readFileSync(join(dir, 'entries.jsonl'), 'utf8');
const byId = (id: string) => readAll().find((e) => e.id === id)!;

describe('§1 pin selection — newest-created injectable handoff fact', () => {
  beforeEach(freshBrain);

  it('a zone edit of an OLD handoff does not move the pin', () => {
    rec({ id: 'old', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'new', created: '2026-02-01T00:00:00.000Z' });
    updateEntry('old', { zone: 'incoming' }); // bumps `updated` to now
    expect(latestHandoff()?.id).toBe('new');
  });

  it('promoting an old incoming handoff does not move the pin', () => {
    rec({ id: 'old', zone: 'incoming', role: 'executor', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'new', created: '2026-02-01T00:00:00.000Z' });
    promote('old');
    expect(latestHandoff()?.id).toBe('new');
  });

  it('archive-then-restore of an old handoff does not move the pin', () => {
    rec({ id: 'old', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'new', created: '2026-02-01T00:00:00.000Z' });
    archive('old');
    restore('old');
    expect(byId('old').zone).toBe('established');
    expect(latestHandoff()?.id).toBe('new');
  });

  it('a NEWER decision or link tagged handoff never pins', () => {
    rec({ id: 'fact1', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'dec1', type: 'decision', status: 'accepted', created: '2026-03-01T00:00:00.000Z' });
    rec({ id: 'link1', type: 'link', tags: ['next'], created: '2026-04-01T00:00:00.000Z' });
    expect(latestHandoff()?.id).toBe('fact1');
  });

  it('a created tie goes to the later write (append position)', () => {
    rec({ id: 'first', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'second', created: '2026-01-01T00:00:00.000Z' });
    expect(latestHandoff()?.id).toBe('second');
  });
});

describe('§3 the pin renders its id', () => {
  beforeEach(freshBrain);

  it('the Last handoff line names the pinned entry id', () => {
    rec({ id: 'abc123def456', text: 'HANDOFF: next is step omega', created: '2026-01-01T00:00:00.000Z' });
    const out = renderContextBundle('t');
    expect(out).toMatch(/## Last handoff\n- \[fact [^\]]*abc123def456\] HANDOFF: next is step omega/);
  });
});

describe('§4 retirement scope checks — refusals append nothing', () => {
  beforeEach(freshBrain);

  function brainWithPair() {
    rec({ id: 'old', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'new', created: '2026-02-01T00:00:00.000Z' });
  }

  it('curate retire refuses a non-fact <old>', () => {
    rec({ id: 'dec', type: 'decision', status: 'accepted', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'new', created: '2026-02-01T00:00:00.000Z' });
    const before = brainBytes();
    expect(() => retire('dec', 'new')).toThrow(/fact/);
    expect(brainBytes()).toBe(before);
  });

  it('curate retire refuses an <old> not tagged handoff/next', () => {
    rec({ id: 'plain', tags: ['status'], created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'new', created: '2026-02-01T00:00:00.000Z' });
    const before = brainBytes();
    expect(() => retire('plain', 'new')).toThrow(/handoff/);
    expect(brainBytes()).toBe(before);
  });

  it('curate retire refuses an archived <old>', () => {
    rec({ id: 'old', zone: 'archive', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'new', created: '2026-02-01T00:00:00.000Z' });
    const before = brainBytes();
    expect(() => retire('old', 'new')).toThrow(/live/);
    expect(brainBytes()).toBe(before);
  });

  it('curate retire refuses an archived or non-handoff <new>', () => {
    rec({ id: 'old', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'gone', zone: 'archive', created: '2026-02-01T00:00:00.000Z' });
    rec({ id: 'topic', type: 'decision', status: 'accepted', created: '2026-03-01T00:00:00.000Z' });
    const before = brainBytes();
    expect(() => retire('old', 'gone')).toThrow(/live/);
    expect(() => retire('old', 'topic')).toThrow(/fact/);
    expect(brainBytes()).toBe(before);
  });

  it('curate retire refuses <new> = <old>', () => {
    brainWithPair();
    const before = brainBytes();
    expect(() => retire('old', 'old')).toThrow(/itself/);
    expect(brainBytes()).toBe(before);
  });

  it('curate retire refuses a <new> older than <old> (cannot move the pin back)', () => {
    brainWithPair();
    const before = brainBytes();
    expect(() => retire('new', 'old')).toThrow(/older/);
    expect(brainBytes()).toBe(before);
  });

  it('curate retire refuses unknown ids', () => {
    brainWithPair();
    const before = brainBytes();
    expect(() => retire('nope', 'new')).toThrow(/no such entry/);
    expect(() => retire('old', 'nope')).toThrow(/no such entry/);
    expect(brainBytes()).toBe(before);
  });

  it('add --retires refuses the whole write when any <old> fails, appending nothing', () => {
    rec({ id: 'old', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'dec', type: 'decision', status: 'accepted', created: '2026-01-02T00:00:00.000Z' });
    const before = brainBytes();
    expect(() =>
      addEntry('fact', 'HANDOFF: new', { role: 'human', tags: ['handoff'], retires: ['old', 'dec'] }),
    ).toThrow(/fact/);
    expect(brainBytes()).toBe(before);
  });

  it('add --retires refuses when the NEW entry is not a handoff fact', () => {
    rec({ id: 'old', created: '2026-01-01T00:00:00.000Z' });
    const before = brainBytes();
    expect(() => addEntry('fact', 'not a handoff', { role: 'human', tags: ['status'], retires: ['old'] })).toThrow(
      /handoff/,
    );
    expect(() =>
      addEntry('fact', 'HANDOFF archived on write', {
        role: 'human',
        tags: ['handoff'],
        zone: 'archive',
        retires: ['old'],
      }),
    ).toThrow(/live/);
    expect(brainBytes()).toBe(before);
  });
});

describe('§4 retirement success — the edge is a tag, text is byte-identical', () => {
  beforeEach(freshBrain);

  it('curate retire archives <old>, tags retired-by:<new>, leaves its text intact', () => {
    rec({ id: 'old', text: 'HANDOFF: old words  exactly\n\nwith spacing', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'new', created: '2026-02-01T00:00:00.000Z' });
    retire('old', 'new');
    const o = byId('old');
    expect(o.zone).toBe('archive');
    expect(o.tags).toContain('retired-by:new');
    expect(o.tags).toContain('handoff');
    expect(o.text).toBe('HANDOFF: old words  exactly\n\nwith spacing');
    expect(o.refs).toBeUndefined(); // no Refs field — the tag is the edge
  });

  it('add --retires writes the new entry and retires each named old in the same call', () => {
    rec({ id: 'old1', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'old2', created: '2026-01-02T00:00:00.000Z' });
    const n = addEntry('fact', 'HANDOFF: newest', { role: 'human', tags: ['handoff', 'next'], retires: ['old1', 'old2'] });
    expect(byId('old1').zone).toBe('archive');
    expect(byId('old2').zone).toBe('archive');
    expect(byId('old1').tags).toContain(`retired-by:${n.id}`);
    expect(byId('old2').tags).toContain(`retired-by:${n.id}`);
    expect(latestHandoff()?.id).toBe(n.id);
  });

  it('curate restore moves it back to established and removes the retired-by tag', () => {
    rec({ id: 'old', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'new', created: '2026-02-01T00:00:00.000Z' });
    retire('old', 'new');
    restore('old');
    const o = byId('old');
    expect(o.zone).toBe('established');
    expect(o.tags.some((t) => t.startsWith('retired-by:'))).toBe(false);
    expect(o.tags).toContain('handoff');
    expect(latestHandoff()?.id).toBe('new'); // restore cannot move the pin (§1)
  });

  it('curate restore refuses an entry that is not archived', () => {
    rec({ id: 'live', created: '2026-01-01T00:00:00.000Z' });
    const before = brainBytes();
    expect(() => restore('live')).toThrow(/not archived/);
    expect(brainBytes()).toBe(before);
  });

  it('a concurrent handoff not named stays live; the pin is the newer-created of the two', () => {
    rec({ id: 'old', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'peer', created: '2026-02-01T00:00:00.000Z' }); // another session's handoff
    rec({ id: 'mine', created: '2026-02-02T00:00:00.000Z' });
    retire('old', 'mine');
    expect(byId('peer').zone).toBe('established');
    expect(latestHandoff()?.id).toBe('mine');
  });
});

describe('§6 reports — read-only', () => {
  beforeEach(freshBrain);

  function mixedBrain() {
    rec({ id: 'h1', text: 'HANDOFF: first', created: '2026-01-01T00:00:00.000Z' });
    rec({ id: 'h2', text: 'topical note about handoffs', created: '2026-01-05T00:00:00.000Z' });
    rec({ id: 'h3', text: 'SESSION HANDOFF: the pin', created: '2026-02-01T00:00:00.000Z' });
    rec({ id: 'gone', zone: 'archive', created: '2026-01-02T00:00:00.000Z' });
    rec({ id: 'd1', type: 'decision', status: 'accepted', created: '2026-01-03T00:00:00.000Z' });
    rec({ id: 'p1', type: 'decision', status: 'proposed', tags: [], created: '2025-01-01T00:00:00.000Z' });
    rec({ id: 'i1', zone: 'incoming', role: 'executor', tags: [], created: '2025-01-01T00:00:00.000Z' });
    rec({ id: 's1', tags: ['status'], created: '2025-01-01T00:00:00.000Z' });
    rec({ id: 's2', tags: ['status', 'handoff'], created: '2025-01-01T00:00:00.000Z' });
    rec({ id: 'fresh', type: 'decision', status: 'proposed', tags: [], created: '2026-10-21T00:00:00.000Z' });
  }

  it('curate handoffs lists non-pin live handoff facts oldest first, shape-flagged, plus unpinnable non-facts', () => {
    mixedBrain();
    const r = handoffReport('2026-10-22');
    expect(r.pin?.id).toBe('h3');
    expect(r.candidates.map((c) => c.id)).toEqual(['s2', 'h1', 'h2']);
    expect(r.candidates.find((c) => c.id === 'h1')?.shaped).toBe(true);
    expect(r.candidates.find((c) => c.id === 'h2')?.shaped).toBe(false);
    expect(r.unpinnable.map((c) => c.id)).toEqual(['d1']);
  });

  it('curate stale lists old proposed decisions, unpromoted incoming, and non-handoff status facts', () => {
    mixedBrain();
    const r = staleReport(30, '2026-10-22');
    expect(r.proposed.map((c) => c.id)).toEqual(['p1']);
    expect(r.incoming.map((c) => c.id)).toEqual(['i1']);
    expect(r.status.map((c) => c.id)).toEqual(['s1']);
  });

  it('neither report writes — entries.jsonl is byte-identical', () => {
    mixedBrain();
    const before = brainBytes();
    handoffReport();
    staleReport();
    expect(brainBytes()).toBe(before);
  });
});
