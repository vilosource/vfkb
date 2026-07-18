import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test gets a throwaway brain; engine reads VFKB_DIR lazily per call.
function freshBrain() {
  process.env.VFKB_DIR = mkdtempSync(join(tmpdir(), 'vfkb-omit-'));
  delete process.env.KB_SESSION_ID;
}

import { addEntry, renderContextBundle } from '../src/engine.js';

const ENTRY_COUNT = 30;
function seed(n = ENTRY_COUNT) {
  for (let i = 1; i <= n; i++) {
    addEntry('gotcha', `lesson ${String(i).padStart(2, '0')}: ${'detail '.repeat(25)}`, {
      role: 'human',
    });
  }
}

const rendered = (out: string) => (out.match(/lesson \d\d:/g) ?? []).length;

describe('budget-drop omission note (#177)', () => {
  beforeEach(freshBrain);

  it('whenever entries are dropped, the note is present — at EVERY budget, including exactly-full ones', () => {
    seed();
    // Sweep budgets in small steps: some land where the old code's note no
    // longer fits after the body filled the budget, which silently omitted it —
    // the quiet-omission defect. The invariant must hold at every point.
    for (let budget = 900; budget <= 3000; budget += 7) {
      const out = renderContextBundle('t', budget);
      if (rendered(out) < ENTRY_COUNT) {
        expect(out, `budget=${budget}: entries were dropped but no omission note rendered`).toMatch(
          /lower-ranked entries omitted/,
        );
      }
    }
  });

  it('the note is actionable and counts what it dropped', () => {
    seed();
    const out = renderContextBundle('t', 1500);
    const kept = rendered(out);
    expect(kept).toBeLessThan(ENTRY_COUNT);
    const m = out.match(/\(\+ (\d+) lower-ranked entries omitted for the 1500-char budget — kb_search \/ kb_list pulls them\)/);
    expect(m, 'note must name the count and the pull action').not.toBeNull();
    expect(Number(m![1])).toBe(ENTRY_COUNT - kept);
  });

  it('no drops → no note', () => {
    seed(3);
    const out = renderContextBundle('t');
    expect(rendered(out)).toBe(3);
    expect(out).not.toMatch(/omitted/);
  });

  it('the render never exceeds its budget, note included', () => {
    seed();
    for (const budget of [1000, 1500, 2200, 3000]) {
      expect(renderContextBundle('t', budget).length).toBeLessThanOrEqual(budget);
    }
  });

  it('tiny-budget band (slack < note length): never renders FEWER entries than the note-less legacy would (review round-1 major)', () => {
    // Short entries so at least one line fits into the small slack above the
    // fixed sections. In the band where the note cannot fit even after full
    // eviction, the render must fall back to emitting the lines it had — not
    // an emptied body with no note (a strict regression vs stock).
    for (let i = 1; i <= 10; i++) addEntry('fact', `tiny ${String(i).padStart(2, '0')}`, { role: 'human' });
    const fixedOnly = renderContextBundle('t', 1).length; // fixed sections floor (never dropped)
    // Measure the real rendered line lengths from an unconstrained render, in
    // rank order — no format guessing.
    const full = renderContextBundle('t', 100_000);
    const lines = full.split('\n').filter((l) => /tiny \d\d/.test(l)).map((l) => l + '\n');
    for (let budget = fixedOnly; budget <= fixedOnly + 150; budget += 3) {
      const out = renderContextBundle('t', budget);
      const kept = (out.match(/tiny \d\d/g) ?? []).length;
      // Legacy-equivalent floor: greedy fit in rank order, no note reserved.
      let slack = budget - fixedOnly;
      let legacy = 0;
      for (const l of lines) {
        if (l.length <= slack) {
          slack -= l.length;
          legacy++;
        }
      }
      // The round-1 regression was the DOUBLE loss: fewer entries than the
      // note-less legacy AND no note saying so. Rendering fewer entries is
      // legitimate only as the visible price of the note itself.
      const noteless = !/omitted/.test(out);
      expect(
        !(noteless && kept < legacy),
        `budget=${budget}: fixed=${fixedOnly} kept=${kept} legacy=${legacy} noteless=${noteless}`,
      ).toBe(true);
    }
  });
});
