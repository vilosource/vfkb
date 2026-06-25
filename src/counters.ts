// Counter/signal stream (M2b — ADR-0021 pt 3/4). Helpful/harmful tallies keyed by
// entry id, recorded as an APPEND-ONLY stream and AGGREGATED AT READ — the entry
// envelope is NEVER edited (deltas-not-rewrites; counters fight the immutability model
// if stored on the entry). This is the evidence that drives CORROBORATED promotion:
// auto-distill alone cannot mint trusted knowledge (ADR-0021 pt 4).
//
// Storage (M2b sub-decision a, settled 2026-06-25): OPERATIONAL / gitignored, under
// <brain>/.signals/counters.jsonl — mirrors <brain>/.sessions. The DURABLE effect
// (promotion) lands in the committed entries.jsonl SoR; raw tallies are append-only
// agent-trust telemetry that survives container restart but is not committed. Keeps the
// brain the single committed source of truth.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { brainDir } from './storage.js';

export type SignalKind = 'helpful' | 'harmful';

export interface CounterSignal {
  entryId: string;
  kind: SignalKind;
  at: string;
  source?: string; // who/what raised it (e.g. 'distill:recurrence', 'operator')
}

function signalsFile(): string {
  return join(brainDir(), '.signals', 'counters.jsonl');
}

// Append a single signal. Never reads/mutates the entry — purely additive.
export function recordSignal(entryId: string, kind: SignalKind, source?: string): CounterSignal {
  const sig: CounterSignal = { entryId, kind, at: new Date().toISOString(), source };
  mkdirSync(join(brainDir(), '.signals'), { recursive: true });
  appendFileSync(signalsFile(), JSON.stringify(sig) + '\n', 'utf8');
  return sig;
}

export function readSignals(): CounterSignal[] {
  const f = signalsFile();
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as CounterSignal);
}

export interface CounterTally {
  helpful: number;
  harmful: number;
  net: number; // helpful − harmful
}

// Aggregate-at-read for one entry.
export function tally(entryId: string, signals: CounterSignal[] = readSignals()): CounterTally {
  let helpful = 0;
  let harmful = 0;
  for (const s of signals) {
    if (s.entryId !== entryId) continue;
    if (s.kind === 'helpful') helpful++;
    else if (s.kind === 'harmful') harmful++;
  }
  return { helpful, harmful, net: helpful - harmful };
}

// Aggregate-at-read for the whole stream.
export function tallies(signals: CounterSignal[] = readSignals()): Map<string, CounterTally> {
  const out = new Map<string, CounterTally>();
  for (const s of signals) {
    const t = out.get(s.entryId) ?? { helpful: 0, harmful: 0, net: 0 };
    if (s.kind === 'helpful') t.helpful++;
    else if (s.kind === 'harmful') t.harmful++;
    t.net = t.helpful - t.harmful;
    out.set(s.entryId, t);
  }
  return out;
}
