// Auto-distill write side (M2b — ADR-0021 pt 1 / RFC-006 / D7b). Turns a session's
// captured signals into CANDIDATE knowledge written ONLY to `incoming` / `unverified` /
// agent-trust. CONTAINMENT is the safety property: the trusted set is never polluted by
// machine extraction — a deterministic test asserts every distilled entry is
// incoming+unverified+agent (test/distiller.test.ts). v1 is a DETERMINISTIC distiller;
// an optional off-hot-path LLM distiller slots behind the same `Distiller` seam
// (ADR-0013: opt-in, graceful-degrade, NEVER on the always-on inject path).
//
// Signal v1 (the realistic deterministic lesson): a captured tool call whose bounded
// outcome (M2b sub-decision b) is `error` → a candidate gotcha "Tool X can fail: …".
// RECURRENCE = CORROBORATION: a second session re-distilling the same error SIGNATURE
// does NOT duplicate — it records a corroborating counter signal on the existing
// candidate, which is what drives corroborated promotion (ADR-0021 pt 4).

import { createHash } from 'node:crypto';
import { addEntry, readAll } from './engine.js';
import { recordSignal } from './counters.js';
import type { KnowledgeEntry, ProvenanceOrigin } from './types.js';

const SIG_PREFIX = 'distill-sig:';
const DISTILLED_TAG = 'distilled';

// A captured error fact carries tag `capture:error`, origin.tool, and text
// "Tool X invoked: … → error: <summary>". Normalize the summary to an error CLASS so
// transient specifics (paths, ids, timestamps) don't fragment the signature.
function errorClass(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/0x[0-9a-f]+|\b[0-9a-f]{8,}\b/g, '#') // hashes / hex ids
    .replace(/\b\d+\b/g, '#') // numbers
    .replace(/[\/\\][^\s'"]+/g, '/path') // file paths
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function toolOf(e: KnowledgeEntry): string {
  return e.provenance.origin?.kind === 'tool_call' ? e.provenance.origin.tool : 'unknown';
}

// The bounded error summary as captured after the "→ error:" marker.
function summaryOf(e: KnowledgeEntry): string {
  const m = e.text.match(/→ error:\s*(.*)$/);
  return (m ? m[1] : e.text).trim();
}

function signature(tool: string, summary: string): string {
  const basis = `${tool}::${errorClass(summary)}`;
  return SIG_PREFIX + createHash('sha256').update(basis).digest('hex').slice(0, 12);
}

export interface DistillCandidate {
  sig: string;
  tool: string;
  text: string;
  sourceIds: string[];
  origin: ProvenanceOrigin;
}

// Select the captured ERROR facts this distiller acts on. `capturedIds` (a session's
// signals) restricts the set; absent it, all `capture:error`-tagged live facts. We read
// from the brain, so already-skipped self-tool calls never appear (the 31f4266 skip
// holds end-to-end); a defensive guard re-asserts it.
function errorCaptures(capturedIds?: string[], all: KnowledgeEntry[] = readAll()): KnowledgeEntry[] {
  const idSet = capturedIds && capturedIds.length ? new Set(capturedIds) : null;
  return all.filter(
    (e) =>
      e.type === 'fact' &&
      e.tags.includes('capture:error') &&
      e.provenance.origin?.kind === 'tool_call' &&
      !/^kb_|vtfkb/i.test(toolOf(e)) &&
      (!idSet || idSet.has(e.id)),
  );
}

// PROPOSE (does not write): the candidate gotchas implied by the error captures, one per
// distinct signature. Deterministic: same captures → same candidates (stable sigs).
export function distillCandidates(
  capturedIds?: string[],
  all: KnowledgeEntry[] = readAll(),
): DistillCandidate[] {
  const bySig = new Map<string, DistillCandidate>();
  for (const e of errorCaptures(capturedIds, all)) {
    const tool = toolOf(e);
    const summary = summaryOf(e);
    const sig = signature(tool, summary);
    const cur = bySig.get(sig);
    if (cur) {
      cur.sourceIds.push(e.id);
      continue;
    }
    bySig.set(sig, {
      sig,
      tool,
      text: `Tool ${tool} can fail: ${summary} — auto-distilled from a captured failure (unverified)`,
      sourceIds: [e.id],
      origin: { kind: 'tool_call', tool },
    });
  }
  return [...bySig.values()];
}

export interface DistillResult {
  created: KnowledgeEntry[];
  corroborated: string[]; // ids of existing candidates that got a recurrence signal
}

// WRITE side. For each candidate signature: if no live (non-archive) distilled gotcha
// with that signature exists, create one in incoming/unverified/agent-trust
// (CONTAINMENT — explicit, not relying on defaults). If one already exists, this is a
// recurrence → record a corroborating counter signal, never a duplicate.
export function distill(capturedIds?: string[]): DistillResult {
  const all = readAll();
  const existingBySig = new Map<string, KnowledgeEntry>();
  for (const e of all) {
    if (e.zone === 'archive') continue;
    const sigTag = e.tags.find((t) => t.startsWith(SIG_PREFIX));
    if (sigTag) existingBySig.set(sigTag, e);
  }

  const created: KnowledgeEntry[] = [];
  const corroborated: string[] = [];
  for (const c of distillCandidates(capturedIds, all)) {
    const existing = existingBySig.get(c.sig);
    if (existing) {
      recordSignal(existing.id, 'helpful', 'distill:recurrence');
      corroborated.push(existing.id);
      continue;
    }
    const entry = addEntry('gotcha', c.text, {
      role: 'executor', // agent-trust (deriveTrust → 'agent')
      zone: 'incoming', // CONTAINMENT — never the trusted set
      provStatus: 'unverified', // CONTAINMENT — never verified by machine extraction
      tags: [DISTILLED_TAG, c.sig, `tool:${c.tool}`],
      origin: c.origin,
    });
    created.push(entry);
    existingBySig.set(c.sig, entry); // a repeated sig within one pass corroborates, not duplicates
  }
  return { created, corroborated };
}
