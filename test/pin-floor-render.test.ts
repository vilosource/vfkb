// RFC-043 Part A (ADR-0084 §5; vfkb#386) — the engine half, git-free: a fake provider
// stands in for src/pin-staleness.ts. Decide D4 (layout, bounds), D5 (constitutional).
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addEntry,
  boundedCommits,
  COMMITS_SINCE_SLICE_CHARS,
  renderCommitsSince,
  renderContextBundle,
  type StaleCommit,
} from '../src/engine.js';
import type { KnowledgeEntry } from '../src/types.js';

function freshBrain() {
  process.env.VFKB_DIR = mkdtempSync(join(tmpdir(), 'vfkb-floor-'));
  delete process.env.VFKB_DATA_DIR;
  delete process.env.KB_SESSION_ID;
}

const c = (i: number, subject = `fix: change ${i}`): StaleCommit => ({
  hash: `${i % 10}`.repeat(40),
  short: `${i % 10}`.repeat(7),
  subject,
});
const section = (out: string) => out.slice(out.indexOf('## Last handoff'), out.indexOf('<vfkb-map>'));

describe('the Part A block (decide D4)', () => {
  it('exact bytes: flush-left count line, two-space-indented sha7 + subject, newest first', () => {
    expect(renderCommitsSince([c(2), c(1)])).toBe(
      'Commits since this handoff was recorded (2):\n  2222222 fix: change 2\n  1111111 fix: change 1\n',
    );
  });
  it('empty S → nothing', () => {
    expect(renderCommitsSince([])).toBe('');
  });
  it('subjects are cut to 100 characters plus "…"', () => {
    const b = renderCommitsSince([c(1, 'a'.repeat(150))]);
    expect(b).toContain(`  1111111 ${'a'.repeat(100)}…\n`);
    expect(b).not.toContain('a'.repeat(101));
  });
  it('bounded at 400 characters; at least three max-length lines always fit; (+k more) = N − shown', () => {
    const many = Array.from({ length: 30 }, (_, i) => c(i, `s${i} ` + 'z'.repeat(300)));
    const b = renderCommitsSince(many);
    expect(b.length).toBeLessThanOrEqual(COMMITS_SINCE_SLICE_CHARS);
    const { shown, more } = boundedCommits(many);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(more).toBe(30 - shown.length);
    expect(b).toContain(`  (+${more} more)\n`);
    expect(b.startsWith('Commits since this handoff was recorded (30):\n')).toBe(true);
  });
  it('the count line always survives and N is |S|, not the shown count', () => {
    const many = Array.from({ length: 999 }, (_, i) => c(i, 'q'.repeat(100)));
    expect(renderCommitsSince(many)).toMatch(/^Commits since this handoff was recorded \(999\):\n/);
  });
  it('is neutral: no call to action', () => {
    const b = renderCommitsSince([c(1), c(2)]);
    for (const w of ['must', 'should', 'write', 'record a', 'kb_add', 'handoff now', 'out of date', 'stale'])
      expect(b.toLowerCase(), w).not.toContain(w);
  });
});

describe('renderContextBundle with a pinStaleness provider (Part A)', () => {
  beforeEach(freshBrain);

  it('the block sits directly under the pin bullet', () => {
    const pin = addEntry('fact', 'HANDOFF: next is step omega', { role: 'human', tags: ['handoff'] });
    const out = renderContextBundle('t', undefined, { pinStaleness: () => [c(1)] });
    expect(section(out)).toContain(
      `## Last handoff\n- [fact ✓operator · ${pin.id}] HANDOFF: next is step omega\n` +
        'Commits since this handoff was recorded (1):\n  1111111 fix: change 1\n\n',
    );
  });

  it('the provider is asked about the rendered pin', () => {
    const pin = addEntry('fact', 'the pin', { role: 'human', tags: ['next'] });
    const seen: string[] = [];
    renderContextBundle('t', undefined, {
      pinStaleness: (p: KnowledgeEntry) => {
        seen.push(p.id);
        return [];
      },
    });
    expect(seen).toEqual([pin.id]);
  });

  it('no provider, null, undefined, [] or a throwing provider → byte-identical to today', () => {
    addEntry('fact', 'HANDOFF text', { role: 'human', tags: ['handoff'] });
    const base = renderContextBundle('t');
    for (const p of [() => null, () => undefined, () => [], () => {
      throw new Error('git exploded');
    }])
      expect(renderContextBundle('t', undefined, { pinStaleness: p })).toBe(base);
  });

  it('the pin text gives up exactly the slice the block used, with the existing marker', () => {
    const pin = addEntry('fact', 'L'.repeat(3000), { role: 'human', tags: ['handoff'] });
    const commits = [c(1), c(2)];
    const block = renderCommitsSince(commits);
    const out = renderContextBundle('t', undefined, { pinStaleness: () => commits });
    expect(out).toContain(`${'L'.repeat(2000 - block.length)}… (truncated — kb_get ${pin.id} for the rest)\n${block}\n`);
    expect(out).not.toContain('L'.repeat(2000 - block.length + 1));
  });

  it('a short pin is not truncated by the block', () => {
    addEntry('fact', 'short pin', { role: 'human', tags: ['handoff'] });
    expect(renderContextBundle('t', undefined, { pinStaleness: () => [c(1)] })).not.toContain('truncated');
  });

  // decide D5: no `## Last handoff`, no annotation — and the provider is never called.
  it('a constitutional handoff-tagged decision gets no section and no annotation', () => {
    addEntry('decision', 'constitutional rule tagged handoff', {
      role: 'human',
      status: 'accepted',
      constitutional: true,
      tags: ['handoff'],
    });
    let called = 0;
    const out = renderContextBundle('t', undefined, {
      pinStaleness: () => {
        called++;
        return [c(1), c(2), c(3)];
      },
    });
    expect(out).toContain('## Constitution');
    expect(out).not.toContain('## Last handoff');
    expect(out).not.toContain('Commits since');
    expect(called).toBe(0);
  });
  it('…and its positive twin: add a fact pin and the annotation renders once', () => {
    addEntry('decision', 'constitutional rule tagged handoff', {
      role: 'human',
      status: 'accepted',
      constitutional: true,
      tags: ['handoff'],
    });
    addEntry('fact', 'the real pin', { role: 'human', tags: ['handoff'] });
    const out = renderContextBundle('t', undefined, { pinStaleness: () => [c(1)] });
    expect(out.match(/Commits since this handoff was recorded/g)).toHaveLength(1);
  });
});
