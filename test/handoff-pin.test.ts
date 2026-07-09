import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test gets a throwaway brain; engine reads VFKB_DIR lazily per call.
function freshBrain() {
  process.env.VFKB_DIR = mkdtempSync(join(tmpdir(), 'vfkb-handoff-'));
  delete process.env.KB_SESSION_ID;
}

import { addEntry, supersede, latestHandoff, renderContextBundle } from '../src/engine.js';

// Long enough that the ADR-0012 tiering + 10k budget would drop it below the
// gotcha wall without the pin — the observed 2026-07-09 failure shape (issue #96).
const HANDOFF_TEXT =
  'HANDOFF: previous session shipped the ingest refactor; the single next step is ' +
  'the migration codenamed sentinel-step-77. ' +
  'padding '.repeat(60);

function gotchaWall(n = 40) {
  for (let i = 1; i <= n; i++) {
    addEntry('gotcha', `wall lesson ${i}: ${'detail '.repeat(40)}`, { role: 'human' });
  }
}

describe('last-handoff pin (ADR-0049)', () => {
  beforeEach(freshBrain);

  it('the pin survives budget pressure that drops every unpinned fact', () => {
    addEntry('fact', HANDOFF_TEXT, { role: 'human', tags: ['handoff', 'next', 'status'] });
    addEntry('fact', 'ordinary fact that the tiering may drop', { role: 'human' });
    gotchaWall();
    const out = renderContextBundle('t');
    expect(out).toContain('## Last handoff');
    expect(out).toContain('sentinel-step-77');
    // pinned section leads: before the map and before any ranked gotcha line
    expect(out.indexOf('## Last handoff')).toBeLessThan(out.indexOf('<vfkb-map>'));
    expect(out.indexOf('sentinel-step-77')).toBeLessThan(out.indexOf('wall lesson'));
  });

  it('newest handoff wins; `next` tag qualifies too', () => {
    addEntry('fact', 'old handoff: step alpha-1', { role: 'human', tags: ['handoff'] });
    const newer = addEntry('fact', 'new handoff: step beta-2', { role: 'human', tags: ['next'] });
    expect(latestHandoff()?.id).toBe(newer.id);
    expect(renderContextBundle('t')).toMatch(/## Last handoff\n- \[fact [^\]]*\] new handoff: step beta-2/);
  });

  it('a superseded or expired handoff is not pinned', () => {
    // decision-family supersession removes the old target from injection
    const d = addEntry('decision', 'handoff decision: do X', {
      role: 'human',
      status: 'accepted',
      tags: ['handoff'],
    });
    supersede(d.id, 'replacement decision without handoff tag', { role: 'human' });
    expect(latestHandoff()).toBeNull();

    // an expired handoff fact ages out via the validity window
    addEntry('fact', 'stale handoff: step gamma-3', {
      role: 'human',
      tags: ['handoff'],
      validUntil: '2000-01-01T00:00:00.000Z',
    });
    expect(latestHandoff()).toBeNull();
    expect(renderContextBundle('t')).not.toContain('## Last handoff');
  });

  it('no handoff-tagged entries → the section is omitted, render unchanged in shape', () => {
    addEntry('gotcha', 'just a lesson', { role: 'human' });
    const out = renderContextBundle('t');
    expect(out).not.toContain('## Last handoff');
    expect(out).toContain('just a lesson');
  });

  it('the pinned entry is not duplicated in the ranked list when budget allows', () => {
    addEntry('fact', 'tiny handoff: step delta-4', { role: 'human', tags: ['handoff'] });
    const out = renderContextBundle('t');
    expect(out.match(/step delta-4/g)).toHaveLength(1);
  });

  it('the pin renders after the Constitution section (ADR-0049 placement)', () => {
    addEntry('decision', 'constitutional rule: never do Z', {
      role: 'human',
      status: 'accepted',
      constitutional: true,
    });
    addEntry('fact', 'handoff: step epsilon-5', { role: 'human', tags: ['handoff'] });
    const out = renderContextBundle('t');
    expect(out.indexOf('## Constitution')).toBeGreaterThan(-1);
    expect(out.indexOf('## Constitution')).toBeLessThan(out.indexOf('## Last handoff'));
  });

  it('a pathological handoff is truncated at the cap — the pin cannot unbound the render', () => {
    const huge = addEntry('fact', `HANDOFF: step zeta-6. ${'x'.repeat(16000)}`, {
      role: 'human',
      tags: ['handoff'],
    });
    gotchaWall();
    const out = renderContextBundle('t');
    expect(out).toContain('step zeta-6'); // the head survives
    expect(out).toContain(`(truncated — kb_get ${huge.id} for the rest)`);
    // bounded: cap (2000) + marker + map + budgeted ranked remainder — never 16k+
    expect(out.length).toBeLessThan(11000);
  });

  it('a constitutional handoff-tagged decision is not pinned twice', () => {
    addEntry('decision', 'constitutional handoff: do W next', {
      role: 'human',
      status: 'accepted',
      constitutional: true,
      tags: ['handoff'],
    });
    const out = renderContextBundle('t');
    expect(out).not.toContain('## Last handoff'); // already leads in the Constitution
    expect(out.match(/do W next/g)).toHaveLength(1);
  });
});
