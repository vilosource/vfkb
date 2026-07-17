import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test gets a throwaway brain; engine reads the data dir lazily per call.
function freshBrain() {
  process.env.VFKB_DATA_DIR = mkdtempSync(join(tmpdir(), 'vfkb-xrpin-'));
  delete process.env.KB_SESSION_ID;
}

import { addEntry, latestCrossRepo, latestHandoff, renderContextBundle } from '../src/engine.js';

// Long enough that the ADR-0012 tiering + 10k budget would drop it below the
// gotcha wall without the pin — the L4 delivery arm's unit twin (ADR-0063 §7).
const RECORD_TEXT =
  'CROSS-REPO WIRING-MIGRATION (2026-07-17, from vfkb): migrated this repo to the plugin; ' +
  'operation codename xr-sentinel-91. ' +
  'padding '.repeat(60);

function gotchaWall(n = 40) {
  for (let i = 1; i <= n; i++) {
    addEntry('gotcha', `wall lesson ${i}: ${'detail '.repeat(40)}`, { role: 'human' });
  }
}

describe('cross-repo operations pin (ADR-0063 §2)', () => {
  beforeEach(freshBrain);

  it('the pin survives budget pressure that drops every unpinned fact', () => {
    addEntry('fact', RECORD_TEXT, { role: 'executor', tags: ['cross-repo', 'plugin'] });
    gotchaWall();
    const out = renderContextBundle('t');
    expect(out).toContain('## Cross-repo operations');
    expect(out).toContain('xr-sentinel-91');
    expect(out.indexOf('xr-sentinel-91')).toBeLessThan(out.indexOf('wall lesson'));
  });

  it('newest cross-repo record wins', () => {
    addEntry('fact', 'CROSS-REPO OP-A: older record', { role: 'executor', tags: ['cross-repo'] });
    const newer = addEntry('fact', 'CROSS-REPO OP-B: newer record', { role: 'executor', tags: ['cross-repo'] });
    expect(latestCrossRepo()?.id).toBe(newer.id);
    expect(renderContextBundle('t')).toMatch(/## Cross-repo operations\n- \[fact [^\]]*\] CROSS-REPO OP-B/);
  });

  it('an entry also tagged handoff/next is EXCLUDED — it belongs to the resident pin (ADR-0063 §1)', () => {
    const both = addEntry('fact', 'mis-tagged visitor record', {
      role: 'executor',
      tags: ['cross-repo', 'handoff'],
    });
    expect(latestCrossRepo()).toBeNull();
    expect(latestHandoff()?.id).toBe(both.id); // renders once, in Last handoff only
    const out = renderContextBundle('t');
    expect(out).not.toContain('## Cross-repo operations');
    expect(out.match(/mis-tagged visitor record/g)).toHaveLength(1);
  });

  it('renders after Last handoff — resident continuity and visitor record each hold one slot', () => {
    addEntry('fact', 'resident handoff: step kappa-8', { role: 'human', tags: ['handoff'] });
    addEntry('fact', 'CROSS-REPO OP-C: visitor record lambda-9', { role: 'executor', tags: ['cross-repo'] });
    gotchaWall();
    const out = renderContextBundle('t');
    expect(out).toContain('step kappa-8'); // neither evicts the other
    expect(out).toContain('lambda-9');
    expect(out.indexOf('## Last handoff')).toBeLessThan(out.indexOf('## Cross-repo operations'));
    expect(out.indexOf('## Cross-repo operations')).toBeLessThan(out.indexOf('<vfkb-map>'));
  });

  it('no cross-repo entries → the section is omitted', () => {
    addEntry('gotcha', 'just a lesson', { role: 'human' });
    expect(renderContextBundle('t')).not.toContain('## Cross-repo operations');
  });

  it('the pinned entry is not duplicated in the ranked list when budget allows', () => {
    addEntry('fact', 'CROSS-REPO OP-D: tiny record mu-10', { role: 'executor', tags: ['cross-repo'] });
    expect(renderContextBundle('t').match(/mu-10/g)).toHaveLength(1);
  });

  it('a pathological record is truncated at the cap — the pin cannot unbound the render', () => {
    const huge = addEntry('fact', `CROSS-REPO OP-E: nu-11. ${'x'.repeat(16000)}`, {
      role: 'executor',
      tags: ['cross-repo'],
    });
    gotchaWall();
    const out = renderContextBundle('t');
    expect(out).toContain('nu-11');
    expect(out).toContain(`(truncated — kb_get ${huge.id} for the rest)`);
    expect(out.length).toBeLessThan(11000);
  });

  it('an expired record ages out via the validity window', () => {
    addEntry('fact', 'CROSS-REPO OP-F: stale record', {
      role: 'executor',
      tags: ['cross-repo'],
      validUntil: '2000-01-01T00:00:00.000Z',
    });
    expect(latestCrossRepo()).toBeNull();
    expect(renderContextBundle('t')).not.toContain('## Cross-repo operations');
  });
});
