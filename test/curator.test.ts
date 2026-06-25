import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshBrain() {
  process.env.VTFKB_DIR = mkdtempSync(join(tmpdir(), 'vtfkb-curator-'));
}

import { addEntry, readAll } from '../src/engine.js';
import { promote, archive, mergeDuplicate, findLexicalDuplicates } from '../src/curator.js';
import { query } from '../src/read.js';

const byId = (id: string) => readAll().find((e) => e.id === id)!;

describe('ACE curator — M2a safety foundation (ADR-0021 / IMPL-PLAN L12)', () => {
  beforeEach(freshBrain);

  // THE STRUCTURAL BRAKE: every curator op must leave entry TEXT byte-identical.
  // A regression here = a curator that can rewrite knowledge = a failed build.
  it('BRAKE: no curator op ever rewrites entry text', () => {
    const a = addEntry('gotcha', 'do not chown the live pod', { zone: 'incoming' });
    const b = addEntry('fact', 'the prod host is db-9', { zone: 'incoming' });
    const c = addEntry('pattern', 'evidence-gated builds', { zone: 'incoming' });

    const ta = a.text, tb = b.text, tc = c.text;
    promote(a.id);
    archive(b.id);
    mergeDuplicate(c.id, a.id);

    expect(byId(a.id).text).toBe(ta);
    expect(byId(b.id).text).toBe(tb);
    expect(byId(c.id).text).toBe(tc);
  });

  it('promote moves a fluid candidate incoming → established (zone only)', () => {
    const e = addEntry('gotcha', 'wait for MCP ready before the one-shot', { zone: 'incoming' });
    const out = promote(e.id);
    expect(out.zone).toBe('established');
    expect(out.text).toBe(e.text);
  });

  it('archive retires a fluid entry out of the injection set (zone only)', () => {
    const e = addEntry('fact', 'a stale fact', { zone: 'established' });
    expect(archive(e.id).zone).toBe('archive');
    expect(byId(e.id).text).toBe(e.text);
  });

  it('a decision is immutable to the curator — promote refuses, archive deprecates', () => {
    const d = addEntry('decision', 'adopt X', { role: 'human', status: 'accepted' });
    expect(() => promote(d.id)).toThrow(/fluid/);
    expect(archive(d.id).status).toBe('deprecated');
    expect(byId(d.id).text).toBe(d.text); // still never rewritten
  });

  it('mergeDuplicate archives the loser + records an auditable edge, keeps the winner', () => {
    const win = addEntry('gotcha', 'same lesson', { zone: 'established' });
    const lose = addEntry('gotcha', 'same lesson', { zone: 'incoming' });
    mergeDuplicate(lose.id, win.id);
    expect(byId(lose.id).zone).toBe('archive');
    expect(byId(lose.id).tags).toContain(`merged-into:${win.id}`);
    expect(byId(win.id).zone).toBe('established'); // winner untouched
    expect(byId(win.id).text).toBe(win.text);
  });

  it('findLexicalDuplicates proposes exact dup pairs but does not act', () => {
    const win = addEntry('gotcha', 'Use the engine, not direct writes');
    const lose = addEntry('gotcha', 'use the engine, not direct writes  '); // case/space variant
    addEntry('fact', 'unrelated');
    const dups = findLexicalDuplicates();
    expect(dups).toEqual([{ loser: lose.id, winner: win.id }]);
    // proposing did NOT change anything
    expect(byId(lose.id).zone).not.toBe('archive');
  });

  // RETRIEVAL-QUALITY REGRESSION: a curation pass must not LOWER retrieval quality.
  it('a curation pass (dedup) does not lower retrieval quality', () => {
    const keep = addEntry('gotcha', 'azure functionapp CLI hangs on the viloforge WG');
    const dup = addEntry('gotcha', 'Azure functionapp CLI hangs on the viloforge WG  ');
    addEntry('fact', 'totally unrelated noise about bicycles');

    const before = query({ text: 'azure functionapp wg' }).map((e) => e.id);
    expect(before).toContain(keep.id);

    // curate: merge the exact duplicate away.
    for (const { loser, winner } of findLexicalDuplicates()) mergeDuplicate(loser, winner);

    const after = query({ text: 'azure functionapp wg' }).map((e) => e.id);
    expect(after).toContain(keep.id); // the answer still surfaces — quality not lowered
    expect(after).not.toContain(dup.id); // the archived duplicate is gone from results
  });
});
