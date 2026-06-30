// FR-3 (ADR-0030) inner gate — `vfkb import` maps mykb / ADRs / markdown into vfkb
// envelopes through the engine (role=import, lossy), skipping malformed input.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromMykb, fromAdr, fromMarkdown } from './import.js';
import { readAll } from './engine.js';

beforeEach(() => {
  process.env.VFKB_DIR = mkdtempSync(join(tmpdir(), 'vfkb-import-'));
});

const jl = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';

describe('vfkb import (FR-3)', () => {
  it('maps a mykb area into vfkb envelopes (lossy), folding why/resolution/url', () => {
    const area = mkdtempSync(join(tmpdir(), 'mykb-area-'));
    writeFileSync(join(area, 'decisions.jsonl'), jl({ type: 'decision', text: 'D1', tags: ['arch'], why: 'because', provenance: { status: 'verified' } }));
    writeFileSync(join(area, 'gotchas.jsonl'), jl({ type: 'gotcha', text: 'G1', resolution: 'fixed it' }));
    writeFileSync(join(area, 'links.jsonl'), jl({ type: 'link', text: 'L1', url: 'https://x/y' }));
    writeFileSync(join(area, 'facts.jsonl'), 'not json\n' + jl({ type: 'fact', text: 'F1' }));

    const res = fromMykb(area);
    expect(res.length).toBe(4); // the malformed line is skipped

    const all = readAll();
    const decision = all.find((e) => e.type === 'decision')!;
    expect(decision.text).toContain('D1');
    expect(decision.text).toContain('Why: because');
    expect(decision.author.role).toBe('import');
    expect(decision.tags).toContain('imported');
    expect(decision.provenance.status).toBe('verified'); // mykb verified preserved

    expect(all.find((e) => e.type === 'gotcha')!.text).toContain('Resolution: fixed it');
    expect(all.find((e) => e.type === 'link')!.text).toBe('L1 → https://x/y');
    expect(all.find((e) => e.type === 'fact')!.provenance.status).toBe('unverified');
  });

  it('from-adr creates one link per ADR markdown, skipping README', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-'));
    writeFileSync(join(dir, 'ADR-0001-foo.md'), '# ADR-0001: Foo decision\n\nbody');
    writeFileSync(join(dir, 'ADR-0002-bar.md'), '# ADR-0002: Bar decision\n');
    writeFileSync(join(dir, 'README.md'), '# index');

    const res = fromAdr(dir);
    expect(res.length).toBe(2);
    const all = readAll();
    expect(all.every((e) => e.type === 'link' && e.author.role === 'import')).toBe(true);
    expect(all.find((e) => e.text.includes('Foo decision'))!.text).toContain('ADR-0001-foo.md');
  });

  it('from-markdown attaches a single referenced source', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'md-')), 'NOTES.md');
    writeFileSync(f, '# Historical notes\n\nstuff');
    const res = fromMarkdown(f);
    expect(res.length).toBe(1);
    expect(readAll()[0].text).toBe(`Historical notes → ${f}`);
  });

  it('throws a clear error on a missing source', () => {
    expect(() => fromAdr('/no/such/dir')).toThrow(/ADR dir not found/);
  });
});
