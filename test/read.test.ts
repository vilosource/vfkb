import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshBrain() {
  process.env.VTFKB_DIR = mkdtempSync(join(tmpdir(), 'vtfkb-read-'));
}

import { addEntry, supersede, buildContextMap, renderContextBundle } from '../src/engine.js';
import { query } from '../src/read.js';

beforeEach(freshBrain);

describe('query filters (D5c)', () => {
  beforeEach(() => {
    addEntry('fact', 'infra fact one', { role: 'human', tags: ['infra', 'net'] });
    addEntry('fact', 'agent fact two', { role: 'executor', tags: ['infra'] });
    addEntry('pattern', 'a deploy pattern', { role: 'architect', tags: ['deploy'] });
    addEntry('decision', 'a proposed decision', { role: 'human' }); // defaults proposed
    addEntry('gotcha', 'archived gotcha', { role: 'human', zone: 'archive', tags: ['infra'] });
  });

  it('filters by type', () => {
    expect(query({ type: 'fact' }).every((e) => e.type === 'fact')).toBe(true);
    expect(query({ type: ['pattern', 'gotcha'] }).every((e) => ['pattern', 'gotcha'].includes(e.type))).toBe(true);
  });
  it('filters by tag (must have ALL)', () => {
    const r = query({ tags: ['infra', 'net'] });
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('infra fact one');
  });
  it('filters by author role', () => {
    expect(query({ authorRole: 'architect' }).map((e) => e.text)).toEqual(['a deploy pattern']);
  });
  it('filters by effective status', () => {
    expect(query({ status: 'proposed' }).map((e) => e.text)).toEqual(['a proposed decision']);
  });
  it('excludes archived by default (freshness gate)', () => {
    expect(query({ type: 'gotcha' })).toHaveLength(0);
    expect(query({ type: 'gotcha', includeStale: true })).toHaveLength(1);
  });
  it('text search narrows candidates', () => {
    const r = query({ text: 'deploy' });
    expect(r.map((e) => e.text)).toContain('a deploy pattern');
    expect(r.map((e) => e.text)).not.toContain('infra fact one');
  });
  it('respects limit + tiered rerank order', () => {
    const r = query({ limit: 2 });
    // patterns/gotchas tier first
    expect(r[0].type === 'pattern' || r[0].type === 'gotcha').toBe(true);
    expect(r).toHaveLength(2);
  });
});

describe('Context Map (ADR-0006)', () => {
  it('summarizes topology incl. effective decision status + constitutional count', () => {
    addEntry('fact', 'f', { role: 'human', tags: ['x'] });
    const d = addEntry('decision', 'rule', { role: 'human', status: 'accepted', constitutional: true });
    addEntry('decision', 'rfc', { role: 'human' }); // proposed
    supersede(d.id, 'rule v2', { role: 'human', constitutional: true });

    const m = buildContextMap();
    expect(m.byType.fact).toBe(1);
    expect(m.byType.decision).toBe(3); // original + rfc + v2
    expect(m.decisions.superseded).toBe(1); // original
    expect(m.decisions.proposed).toBe(1); // rfc
    expect(m.decisions.accepted).toBe(1); // v2
    expect(m.decisions.constitutional).toBe(1); // v2 only (original superseded)
    expect(m.topTags.find((t) => t.tag === 'x')?.n).toBe(1);
  });
});

// THE regression test for the Stark-FQDN incident: a stale/corrected pair where
// the OLD value must never win injection, even under a budget that would otherwise
// drop the newer entry by load-order.
describe('Stark-FQDN characterization — corrected wins, stale never injects', () => {
  it('via supersession edge', () => {
    const old = addEntry('decision', 'host is stark-OLD.example.com', { role: 'human', status: 'accepted' });
    supersede(old.id, 'host is stark-NEW.example.com', { role: 'human' });
    const block = renderContextBundle('stark');
    expect(block).toContain('stark-NEW.example.com');
    expect(block).not.toContain('stark-OLD.example.com');
    // and the read API agrees
    const live = query({ type: 'decision' }).map((e) => e.text);
    expect(live).toContain('host is stark-NEW.example.com');
    expect(live).not.toContain('host is stark-OLD.example.com');
  });

  it('via valid_until expiry, under a tight budget (newest survives the cut)', () => {
    // expired stale fact + current fact; render with a budget big enough for ONE line
    addEntry('fact', 'FQDN was stark-OLD (decommissioned)', { role: 'human', validUntil: '2025-01-01' });
    addEntry('fact', 'FQDN is stark-NEW (current)', { role: 'human' });
    const block = renderContextBundle('stark');
    expect(block).toContain('stark-NEW');
    expect(block).not.toContain('stark-OLD'); // expired entry is filtered, not merely out-budgeted
  });
});

// ADR-0012 — for an EXPLICIT text query, relevance must be the primary sort.
// Regression guard for the live-turn finding (2026-06-06): query() reused the
// session-start/injection reranker (type -> trust -> recency) for text search,
// discarding the Stage-1 relevance score. At corpus scale a relevant-but-low-trust
// entry was buried ~rank 90 behind newer high-trust entries that merely shared a
// common token, so a `limit` excluded it.
describe('relevance ranking for text search (ADR-0012)', () => {
  const Q = 'az ARM command hangs silently no error';
  beforeEach(() => {
    // High-trust, freshest, type-5 entries that share only the common token "az" but
    // are NOT relevant to the symptom. Under the injection reranker these sort first.
    for (let i = 0; i < 12; i++) {
      addEntry('pattern', `az deployment runbook note number ${i}, unrelated to the symptom`, {
        role: 'human', // operator trust -> within-tier boost + verified
      });
    }
    // The one genuinely relevant entry: low-trust agent gotcha, distinctive terms.
    addEntry('gotcha', 'az ARM management command hangs silently producing no error output', {
      role: 'executor', // agent trust -> no within-tier boost, unverified
    });
  });

  it('surfaces the relevant entry within a small limit (not buried by trust/recency)', () => {
    // sanity: it is retrievable at all (freshness/filters do not drop it)
    expect(query({ text: Q }).some((e) => e.text.includes('hangs silently'))).toBe(true);
    // the bug: it must appear inside the top-5, ranked by RELEVANCE not trust/recency
    const top = query({ text: Q, limit: 5 }).map((e) => e.text);
    expect(top.some((t) => t.includes('hangs silently'))).toBe(true);
  });

  it('ranks the most relevant entry first', () => {
    expect(query({ text: Q, limit: 5 })[0].text).toContain('hangs silently');
  });
});
