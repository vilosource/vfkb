import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ADR-0080 (accepts RFC-044, v3 R1). Two things are guarded here.
//  1. A REGRESSION GUARD: stage 1 must beat the pre-BM25 index, and must not fall below
//     the level at which BM25 plus stopword pruning landed.
//  2. The STEP-2 GATE: R1's prompt-time injection may start only at recall@5 >= 0.6 (and
//     beating the pre-BM25 MRR). BM25 plus stopwords reached 0.5648, so the gate is
//     UNMET. The operator ruled (2026-10-21): land step 1, keep step 2 gated, no tuning
//     against these 18 prompts. The gate test below asserts it is unmet, so if a change
//     ever pushes recall over the bar, this tripwire fails and forces a deliberate update
//     (re-measure, record, then unblock step 2) instead of a silent flip.
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
const BASELINE_RECALL_AT_5 = 0.0139;
// Landed with BM25 + stopword pruning (ADR-0080 step 1): recall@5 0.5648, MRR 0.6393.
// The ratchet floors sit just below, so a regression goes red.
const LANDED_RECALL_AT_5_FLOOR = 0.56;
const LANDED_MRR_FLOOR = 0.63;
const RECALL_AT_5_BAR = 0.6; // the step-2 gate (ADR-0080 Q2)

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

  it('stage-1 beats the pre-BM25 index and does not regress below the landed level', () => {
    const { recall5, mrr, rows } = score();
    console.log(`recall@5 ${recall5.toFixed(4)}  MRR ${mrr.toFixed(4)}\n  ${rows.join('\n  ')}`);
    expect(recall5).toBeGreaterThan(BASELINE_RECALL_AT_5);
    expect(mrr).toBeGreaterThan(BASELINE_MRR);
    expect(recall5).toBeGreaterThanOrEqual(LANDED_RECALL_AT_5_FLOOR);
    expect(mrr).toBeGreaterThanOrEqual(LANDED_MRR_FLOOR);
  });

  it(`the step-2 gate (recall@5 >= ${RECALL_AT_5_BAR}) is recorded as UNMET — a tripwire, not a goal`, () => {
    // When this fails, recall has crossed the bar. Do not just delete the assertion:
    // re-measure, record the result (brain + ADR-0080 status), then let step 2 start.
    expect(score().recall5).toBeLessThan(RECALL_AT_5_BAR);
  });
});
