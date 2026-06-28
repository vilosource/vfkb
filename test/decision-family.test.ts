import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshBrain() {
  process.env.VFKB_DIR = mkdtempSync(join(tmpdir(), 'vfkb-decision-'));
}

import {
  addEntry,
  deriveConstitution,
  effectiveStatus,
  isInjectable,
  readAll,
  renderContextBundle,
  stampOrdinals,
  supersede,
  supersededIds,
  transitionDecision,
  updateEntry,
} from '../src/engine.js';

beforeEach(freshBrain);

describe('RFC = a proposed decision (ADR-0007)', () => {
  it('a new decision defaults to status `proposed`', () => {
    const d = addEntry('decision', 'use TypeScript', { role: 'human' });
    expect(d.status).toBe('proposed');
  });
});

describe('supersession is an additive edge (ADR-0004)', () => {
  it('old is excluded + effectively superseded; new is live; old is never edited', () => {
    const old = addEntry('decision', 'use Python', { role: 'human', status: 'accepted' });
    const neu = supersede(old.id, 'use TypeScript instead', { role: 'human' });

    const live = readAll();
    expect(neu.refs?.supersedes).toBe(old.id);
    const sup = supersededIds(live);
    expect(sup.has(old.id)).toBe(true);
    expect(effectiveStatus(live.find((e) => e.id === old.id)!, sup)).toBe('superseded');

    // injection filter drops the superseded one, keeps the replacement
    const today = '2026-06-03';
    expect(isInjectable(live.find((e) => e.id === old.id)!, today, sup)).toBe(false);
    expect(isInjectable(neu, today, sup)).toBe(true);

    // the old entry's stored text is untouched (immutable content)
    expect(live.find((e) => e.id === old.id)!.text).toBe('use Python');
  });
});

describe('lifecycle transitions vs content-immutability', () => {
  it('proposed → accepted preserves content', () => {
    const d = addEntry('decision', 'adopt ADRs', { role: 'human' });
    const a = transitionDecision(d.id, 'accepted');
    expect(a.status).toBe('accepted');
    expect(a.text).toBe('adopt ADRs');
    expect(readAll().find((e) => e.id === d.id)!.status).toBe('accepted');
  });
  it('refuses to edit decision content (updateEntry) and to set superseded via transition', () => {
    const d = addEntry('decision', 'immutable body', { role: 'human', status: 'accepted' });
    expect(() => updateEntry(d.id, { text: 'sneaky' })).toThrow(/immutable|supersede/i);
    expect(() => transitionDecision(d.id, 'superseded')).toThrow(/superseded.*edge|supersede\(\)/i);
  });
});

describe('Constitution (ADR-0008)', () => {
  it('aggregates accepted constitutional decisions, drops superseded ones', () => {
    addEntry('decision', 'NEVER store secrets in the brain', {
      role: 'human',
      status: 'accepted',
      constitutional: true,
    });
    const c2 = addEntry('decision', 'all writes go through the engine', {
      role: 'human',
      status: 'accepted',
      constitutional: true,
    });
    addEntry('decision', 'a non-constitutional accepted decision', {
      role: 'human',
      status: 'accepted',
    });

    expect(deriveConstitution().map((e) => e.text).sort()).toEqual(
      ['NEVER store secrets in the brain', 'all writes go through the engine'].sort(),
    );

    // superseding a constitutional rule removes it from the live Constitution
    supersede(c2.id, 'all writes go through the engine v2', {
      role: 'human',
      constitutional: true,
    });
    const texts = deriveConstitution().map((e) => e.text);
    expect(texts).toContain('all writes go through the engine v2');
    expect(texts).not.toContain('all writes go through the engine');
  });

  it('renders a Constitution section at the head of the bundle', () => {
    addEntry('decision', 'CONSTITUTIONAL-RULE-X', {
      role: 'human',
      status: 'accepted',
      constitutional: true,
    });
    const block = renderContextBundle('demo');
    expect(block).toContain('## Constitution (always applies)');
    expect(block).toContain('CONSTITUTIONAL-RULE-X');
  });
});

describe('ADR ordinal stamping (ADR-0009)', () => {
  it('assigns monotonic adr_no in created order, idempotent', () => {
    const a = addEntry('decision', 'first', { role: 'human', status: 'accepted' });
    const b = addEntry('decision', 'second', { role: 'human', status: 'accepted' });
    const c = addEntry('decision', 'third', { role: 'human', status: 'accepted' });

    const n = stampOrdinals();
    expect(n).toBe(3);
    const byId = new Map(readAll().map((e) => [e.id, e.adr_no]));
    expect(byId.get(a.id)).toBe(1);
    expect(byId.get(b.id)).toBe(2);
    expect(byId.get(c.id)).toBe(3);

    // idempotent: a second pass stamps nothing and changes no ordinals
    expect(stampOrdinals()).toBe(0);
    const after = new Map(readAll().map((e) => [e.id, e.adr_no]));
    expect(after.get(a.id)).toBe(1);
    expect(after.get(c.id)).toBe(3);

    // a newly added decision gets the next ordinal, not a renumber
    const d = addEntry('decision', 'fourth', { role: 'human', status: 'accepted' });
    expect(stampOrdinals()).toBe(1);
    expect(readAll().find((e) => e.id === d.id)!.adr_no).toBe(4);
  });
});

describe('vision patterns (ADR-0010) are fluid + injected', () => {
  it('a vision-tagged pattern is editable and appears in the bundle', () => {
    const p = addEntry('pattern', 'taste: prefer boring tech', { role: 'human', tags: ['vision'] });
    updateEntry(p.id, { text: 'taste: prefer boring, proven tech' }); // fluid edit OK
    const block = renderContextBundle();
    expect(block).toContain('prefer boring, proven tech');
  });
});
