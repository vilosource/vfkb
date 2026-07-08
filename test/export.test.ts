// ADR-0047 unit gate (RED first) — `vfkb export agents-md` + `vfkb export okf`.
// The determinism contract, the four-clause export predicate, the scoped sweep,
// the raw-record log.md, and OKF v0.1 conformance (TS checker port per ADR-0013).

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportAgentsMd, exportOkf, GENERATED_MARKER } from '../src/export.js';

let brain: string;
let out: string;

beforeEach(() => {
  brain = mkdtempSync(join(tmpdir(), 'vfkb-export-brain-'));
  out = mkdtempSync(join(tmpdir(), 'vfkb-export-out-'));
  process.env.VFKB_DATA_DIR = brain;
  process.env.VFKB_PROJECT = 'exporttest';
});

// Seed the brain by appending raw JSONL records — full control of every envelope
// field (provenance, zone, validity, updated), which the engine write path would
// partly own. normalizeEntry at the read boundary fills the gaps (ADR-0042).
type Seed = Record<string, unknown> & { id: string };
function seed(...records: Seed[]) {
  const lines = records
    .map((r) =>
      JSON.stringify({
        type: 'fact',
        text: `text of ${r.id}`,
        tags: [],
        zone: 'established',
        author: { role: 'human' },
        provenance: { status: 'verified' },
        validity: { valid_from: '2026-07-01' },
        created: '2026-07-01T00:00:00.000Z',
        updated: '2026-07-01T00:00:00.000Z',
        ...r,
      }),
    )
    .join('\n');
  appendFileSync(join(brain, 'entries.jsonl'), lines + '\n');
}

const tomb = (id: string, updated: string) => ({ id, deleted: true, updated }) as unknown as Seed;

// Read an exported tree into a comparable snapshot: relative path → content.
function treeSnapshot(dir: string): Record<string, string> {
  const snap: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(p).isDirectory()) walk(p, r);
      else snap[r] = readFileSync(p, 'utf8');
    }
  };
  walk(dir, '');
  return snap;
}

// --- TS port of validate_okf.py's checks (ADR-0013: no Python in the unit gate).
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
function checkOkfBundleStrict(dir: string): string[] {
  const violations: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(p).isDirectory()) {
        walk(p, r);
        continue;
      }
      if (!name.endsWith('.md')) continue;
      const text = readFileSync(p, 'utf8');
      if (name === 'index.md' || name === 'log.md') continue; // reserved: frontmatter optional
      const m = FM_RE.exec(text);
      if (!m) {
        violations.push(`${r}: missing YAML frontmatter at byte 0`);
        continue;
      }
      const fields = new Map<string, string>();
      for (const line of m[1].split('\n')) {
        const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
        if (kv) fields.set(kv[1], kv[2].trim());
      }
      if (!fields.get('type')) violations.push(`${r}: missing or empty required field 'type'`);
      for (const f of ['title', 'description', 'timestamp']) {
        if (!fields.get(f)) violations.push(`${r}: --strict requires non-empty '${f}'`);
      }
    }
  };
  walk(dir, '');
  return violations;
}

describe('export — determinism contract (ADR-0047)', () => {
  it('two runs over the same brain produce byte-identical trees; stale generated files are swept', () => {
    seed({ id: 'aaa1' }, { id: 'bbb2', type: 'gotcha' });
    exportOkf({ out });
    const first = treeSnapshot(out);

    // dirty the tree with a generated file from an "older brain state" + rerun
    writeFileSync(
      join(out, 'facts', 'zzz9.md'),
      `---\ntype: fact\n---\n<!-- ${GENERATED_MARKER} okf -->\nstale generated leftover\n`,
    );
    exportOkf({ out });
    expect(treeSnapshot(out)).toEqual(first);
    expect(existsSync(join(out, 'facts', 'zzz9.md'))).toBe(false);
  });

  it('REFUSES a non-empty output dir carrying no generated marker, deleting nothing', () => {
    seed({ id: 'aaa1' });
    const foreign = join(out, 'notes.md');
    writeFileSync(foreign, '# hand-written notes, no marker\n');
    expect(() => exportOkf({ out })).toThrow(/refus|generated/i);
    expect(readFileSync(foreign, 'utf8')).toContain('hand-written notes');
  });

  it('a hand-written doc that merely QUOTES the marker phrase neither defeats the refusal nor gets deleted', () => {
    // The reviewer's destructive probe: RFC-022 itself quotes the phrase mid-sentence.
    seed({ id: 'aaa1' });
    const quoting = join(out, 'design-doc.md');
    writeFileSync(
      quoting,
      `# Design notes\n\nEvery emitted file carries a marker (\`<!-- ${GENERATED_MARKER}\`) so the sweep can find it.\n`,
    );
    expect(() => exportOkf({ out })).toThrow(/refus|generated/i);
    expect(readFileSync(quoting, 'utf8')).toContain('Design notes');
  });

  it('agents-md refuses to overwrite a hand-written AGENTS.md, but overwrites a previous export', () => {
    seed({ id: 'aaa1' });
    const path = join(out, 'AGENTS.md');
    writeFileSync(path, `# My hand-written agents file\n(it even quotes "${GENERATED_MARKER}" in prose)\n`);
    expect(() => exportAgentsMd({ out: path })).toThrow(/refus/i);
    expect(readFileSync(path, 'utf8')).toContain('hand-written');
    rmSync(path);
    exportAgentsMd({ out: path }); // fresh export
    exportAgentsMd({ out: path }); // re-export over a previous export: allowed
    expect(readFileSync(path, 'utf8')).toContain(GENERATED_MARKER);
  });

  it('as-of purity: an entry whose validity closed between max(updated) and the wall clock still exports', () => {
    // asOf = max(updated) = 2026-07-01; window closes 2026-07-02 — expired by wall
    // clock (real today > 2026-07-02), open at asOf. A wall-clock implementation drops it.
    seed({ id: 'asof1', validity: { valid_from: '2026-07-01', valid_until: '2026-07-02' } });
    exportOkf({ out });
    expect(existsSync(join(out, 'facts', 'asof1.md'))).toBe(true);
    const agents = join(out, '..', 'AGENTS-asof.md');
    exportAgentsMd({ out: agents });
    expect(readFileSync(agents, 'utf8')).toContain('text of asof1');
  });
});

describe('export — the four-clause predicate (negative test, every clause)', () => {
  it('exports NONE of the ineligible seeds, on both targets', () => {
    seed(
      { id: 'ok1' }, // the eligible control
      { id: 'unv1', provenance: { status: 'unverified' } },
      { id: 'stale1', provenance: { status: 'stale' } },
      { id: 'exp1', provenance: { status: 'expired' } },
      { id: 'prop1', type: 'decision', status: 'proposed' },
      { id: 'old1', type: 'decision', status: 'accepted' }, // superseded via edge below
      { id: 'new1', type: 'decision', status: 'accepted', refs: { supersedes: 'old1' } },
      { id: 'dep1', type: 'decision', status: 'deprecated' },
      { id: 'arch1', zone: 'archive' }, // archived but still verified
      { id: 'window1', validity: { valid_from: '2026-06-01', valid_until: '2026-06-15' } }, // closed before asOf
    );
    exportOkf({ out });
    // The ratchet governs the PUBLISHED docs and indexes. log.md is exempt from the
    // no-content assertion by design: it is the departures record, and naming what
    // left (e.g. the superseded old1) is its whole job.
    const snap = treeSnapshot(out);
    const published = JSON.stringify(Object.fromEntries(Object.entries(snap).filter(([p]) => p !== 'log.md')));
    for (const bad of ['unv1', 'stale1', 'exp1', 'prop1', 'old1', 'dep1', 'arch1', 'window1']) {
      expect(published, `okf must not publish ${bad}`).not.toContain(`text of ${bad}`);
      expect(snap[`facts/${bad}.md`], `no doc file for ${bad}`).toBeUndefined();
      expect(snap[`decisions/${bad}.md`], `no doc file for ${bad}`).toBeUndefined();
    }
    expect(existsSync(join(out, 'facts', 'ok1.md'))).toBe(true);
    expect(existsSync(join(out, 'decisions', 'new1.md'))).toBe(true);

    const agents = join(out, '..', 'AGENTS-neg.md');
    exportAgentsMd({ out: agents });
    const md = readFileSync(agents, 'utf8');
    for (const bad of ['unv1', 'stale1', 'exp1', 'prop1', 'old1', 'dep1', 'arch1', 'window1']) {
      expect(md, `agents-md must not export ${bad}`).not.toContain(`text of ${bad}`);
    }
    expect(md).toContain('text of ok1');
  });
});

describe('export okf — bundle shape (OKF v0.1)', () => {
  it('conforms to the strict tier (TS checker port), files named <id>.md under per-type dirs', () => {
    seed(
      { id: 'f1', tags: ['alpha', 'beta'] },
      { id: 'g1', type: 'gotcha' },
      { id: 'd1', type: 'decision', status: 'accepted' },
      { id: 'l1', type: 'link', text: 'spec doc https://example.com/spec.md for the thing' },
    );
    exportOkf({ out });
    expect(checkOkfBundleStrict(out)).toEqual([]);
    expect(existsSync(join(out, 'facts', 'f1.md'))).toBe(true);
    expect(existsSync(join(out, 'gotchas', 'g1.md'))).toBe(true);
    expect(existsSync(join(out, 'decisions', 'd1.md'))).toBe(true);
    expect(existsSync(join(out, 'links', 'l1.md'))).toBe(true);
    expect(existsSync(join(out, 'index.md'))).toBe(true);
    expect(existsSync(join(out, 'log.md'))).toBe(true);

    const f1 = readFileSync(join(out, 'facts', 'f1.md'), 'utf8');
    expect(f1.startsWith('---\n')).toBe(true); // frontmatter at byte 0
    expect(f1.indexOf(GENERATED_MARKER)).toBeGreaterThan(f1.indexOf('\n---\n')); // marker AFTER frontmatter
    expect(f1).toContain('generated_by:');
    expect(f1).toContain('tags:');
    expect(f1).toContain('timestamp:');
    // resource: only on a link entry with a real URL, never fabricated
    expect(readFileSync(join(out, 'links', 'l1.md'), 'utf8')).toContain('resource: "https://example.com/spec.md"');
    expect(f1).not.toContain('resource:');
  });

  it('log.md derives departures from the RAW record history, not the materialized view', () => {
    seed({ id: 'wasgood', updated: '2026-07-01T00:00:00.000Z' });
    // restamped verified→stale later (LWW hides the verified past in readAll)
    seed({ id: 'wasgood', provenance: { status: 'stale' }, updated: '2026-07-02T00:00:00.000Z' });
    seed({ id: 'gone', updated: '2026-07-01T00:00:00.000Z' });
    seed(tomb('gone', '2026-07-03T00:00:00.000Z')); // tombstoned formerly-published
    seed({ id: 'nevermind', provenance: { status: 'unverified' } }); // never publish-grade
    seed({ id: 'live1' }); // still published — must NOT be in the log
    exportOkf({ out });
    const log = readFileSync(join(out, 'log.md'), 'utf8');
    expect(log).toContain('wasgood');
    expect(log).toContain('gone');
    expect(log).not.toContain('nevermind');
    expect(log).not.toContain('live1');
  });
});

describe('export agents-md — structure', () => {
  it('marker present, Constitution leads, map is the export variant over the published subset only', () => {
    seed(
      { id: 'const1', type: 'decision', status: 'accepted', constitutional: true, adr_no: 1, text: 'the constitutional rule' },
      { id: 'k1', text: 'published knowledge one' },
      { id: 'k2', type: 'gotcha', text: 'published gotcha two' },
      { id: 'hidden1', provenance: { status: 'unverified' }, text: 'unpublished secret tagline', tags: ['secrettag'] },
    );
    const path = join(out, 'AGENTS.md');
    exportAgentsMd({ out: path });
    const md = readFileSync(path, 'utf8');
    expect(md).toContain(GENERATED_MARKER);
    // Constitution is the first section
    expect(md.indexOf('Constitution')).toBeGreaterThan(-1);
    expect(md.indexOf('Constitution')).toBeLessThan(md.indexOf('published knowledge one'));
    expect(md).toContain('the constitutional rule');
    // export-variant map: no live affordances, counts over the published subset only
    expect(md).not.toContain('<vfkb-map>');
    expect(md).not.toContain('pull more');
    expect(md).not.toContain('malformed');
    expect(md).not.toContain('secrettag'); // unpublished tags leak nothing
    expect(md).not.toContain('unpublished secret tagline');
    expect(md).toMatch(/3 published entr/); // const1 + k1 + k2, not 4
  });

  it('respects the budget with an explicit omission note', () => {
    const seeds: Seed[] = [];
    for (let i = 0; i < 50; i++) seeds.push({ id: `bulk${i}`, text: `bulk entry ${i} ${'x'.repeat(120)}` });
    seed(...seeds);
    const path = join(out, 'AGENTS.md');
    exportAgentsMd({ out: path, budget: 2000 });
    const md = readFileSync(path, 'utf8');
    expect(md.length).toBeLessThanOrEqual(2200); // budget + the omission note tolerance
    expect(md).toMatch(/omitted/i);
  });

  it('byte-identical across runs (agents-md determinism)', () => {
    seed({ id: 'aaa1' }, { id: 'bbb2' });
    const p1 = join(out, 'A1.md');
    const p2 = join(out, 'A2.md');
    exportAgentsMd({ out: p1 });
    exportAgentsMd({ out: p2 });
    expect(readFileSync(p1, 'utf8')).toEqual(readFileSync(p2, 'utf8'));
  });
});
