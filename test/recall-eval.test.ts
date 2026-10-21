import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ADR-0080 (accepts RFC-044, v3 R1) step-1 bar: the stage-1 ranker must reach recall@5
// >= 0.6 on every real topical operator prompt, and beat the pre-BM25 index on MRR,
// before R1's prompt-time injection (step 2) may start.
//
// The labels were written by an independent agent with grep and judgement only, and
// committed BEFORE any new ranker existed (ADR-0080). They grade against a pinned brain
// snapshot (main at 9095dc4), so entries written later that QUOTE these prompts cannot
// game the eval. This test drives the REAL InMemoryIndex.searchScored, never a
// reimplementation.
const FIX = resolve(__dirname, 'fixtures/recall-eval');
const labels = JSON.parse(readFileSync(join(FIX, 'labels.json'), 'utf8')) as {
  topical: { prompt: string; relevant: string[]; flags?: string[] }[];
  noRecall: { prompt: string }[];
};

// Measured on the pre-BM25 index (occurrence counting, no IDF, no length normalisation,
// no stopwords) at the commit that introduced this test: recall@5 0.0139, MRR 0.0432.
// Frozen so the bar "beats the current index on MRR" survives the scorer being replaced.
const BASELINE_MRR = 0.0432;
const RECALL_AT_5_BAR = 0.6;

type Index = { searchScored(q: string, k?: number): { entry: { id: string } }[] };
let index: Index;

beforeAll(async () => {
  const brain = join(mkdtempSync(join(tmpdir(), 'vfkb-recall-eval-')), '.vfkb');
  mkdirSync(brain, { recursive: true });
  copyFileSync(join(FIX, 'brain-9095dc4.jsonl'), join(brain, 'entries.jsonl'));
  process.env.VFKB_DATA_DIR = brain;
  delete process.env.VFKB_DIR;
  const { InMemoryIndex } = await import('../src/index-store.js');
  index = new InMemoryIndex();
});

function score() {
  let recall = 0;
  let rr = 0;
  const rows: string[] = [];
  for (const t of labels.topical) {
    const ranked = index.searchScored(t.prompt, 100000).map((x) => x.entry.id);
    const rel = new Set(t.relevant);
    const r5 = ranked.slice(0, 5).filter((id) => rel.has(id)).length / Math.min(rel.size, 5);
    const first = ranked.findIndex((id) => rel.has(id));
    recall += r5;
    rr += first < 0 ? 0 : 1 / (first + 1);
    rows.push(`${r5.toFixed(2)}  first@${first < 0 ? '-' : first + 1}  ${t.prompt.slice(0, 60).replace(/\s+/g, ' ')}`);
  }
  return { recall5: recall / labels.topical.length, mrr: rr / labels.topical.length, rows };
}

describe('R1 recall eval (ADR-0080 step-1 bar)', () => {
  it('the labelled set is the one ADR-0080 describes', () => {
    expect(labels.topical.length).toBeGreaterThanOrEqual(18);
    for (const t of labels.topical) expect(t.relevant.length).toBeGreaterThan(0);
  });

  it(`stage-1 reaches recall@5 >= ${RECALL_AT_5_BAR} and beats the pre-BM25 MRR (${BASELINE_MRR})`, () => {
    const { recall5, mrr, rows } = score();
    console.log(`recall@5 ${recall5.toFixed(4)}  MRR ${mrr.toFixed(4)}\n  ${rows.join('\n  ')}`);
    expect(recall5).toBeGreaterThanOrEqual(RECALL_AT_5_BAR);
    expect(mrr).toBeGreaterThan(BASELINE_MRR);
  });
});
