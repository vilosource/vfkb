import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshBrain() {
  process.env.VTFKB_DIR = mkdtempSync(join(tmpdir(), 'vtfkb-distiller-'));
}

import { addEntry, captureToolCall, readAll, deriveTrust } from '../src/engine.js';
import { distill, distillCandidates } from '../src/distiller.js';
import { recordSignal, tally } from '../src/counters.js';
import { promoteIfCorroborated, eligibleForPromotion, PROMOTION_THRESHOLD } from '../src/curator.js';

const byId = (id: string) => readAll().find((e) => e.id === id)!;

// Capture an errored tool call (the deterministic distillation signal).
function captureError(tool: string, input: unknown, error: string) {
  return captureToolCall({ tool_name: tool, tool_input: input, tool_result: { isError: true, error } })!;
}

describe('auto-distill write side — M2b (ADR-0021 pt 1 / containment)', () => {
  beforeEach(freshBrain);

  // THE CONTAINMENT BRAKE: machine-extracted candidates may NEVER enter the trusted set.
  // Every distilled entry must be incoming + unverified + agent-trust, whatever the input.
  it('BRAKE: every distilled entry is incoming / unverified / agent-trust — never trusted', () => {
    captureError('Bash', { command: 'kubectl get pods' }, 'connection refused to the api server');
    captureError('Bash', { command: 'curl x' }, 'error: dial tcp 1.2.3.4:443 connection refused');

    const { created } = distill();
    expect(created.length).toBeGreaterThan(0);
    for (const e of created) {
      expect(e.zone).toBe('incoming');
      expect(e.provenance.status).toBe('unverified');
      expect(deriveTrust(e.author.role)).toBe('agent');
      expect(e.type).toBe('gotcha');
    }
  });

  it('distils ONLY captured failures — clean (capture:ok) calls produce no candidate', () => {
    captureToolCall({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_result: 'hi\n' });
    expect(distillCandidates()).toHaveLength(0);
    expect(distill().created).toHaveLength(0);
  });

  it('is deterministic + collapses same error CLASS to one candidate (specifics normalized)', () => {
    // Same failure class, different transient specifics (ips/ports/paths) → one signature.
    captureError('Bash', { command: 'a' }, 'error: dial tcp 10.0.0.1:443 connection refused');
    captureError('Bash', { command: 'b' }, 'error: dial tcp 10.0.0.9:8443 connection refused');
    const cands = distillCandidates();
    expect(cands).toHaveLength(1);
    expect(cands[0].sourceIds).toHaveLength(2); // both captures fold into the one candidate
    // re-deriving over the same brain yields the identical signature + text (byte-stable)
    expect(distillCandidates()[0].sig).toBe(cands[0].sig);
    expect(distillCandidates()[0].text).toBe(cands[0].text);
  });

  it('RECURRENCE = corroboration: a re-distilled signature signals, never duplicates', () => {
    captureError('Bash', { command: 'a' }, 'connection refused');
    const first = distill();
    expect(first.created).toHaveLength(1);
    const candId = first.created[0].id;

    // a later session re-distils the same failure class (same error, different host)
    captureError('Bash', { command: 'b' }, 'connection refused');
    const before = readAll().length; // after the new capture, before distilling it
    const second = distill();
    expect(second.created).toHaveLength(0); // NO duplicate entry
    expect(second.corroborated).toContain(candId);
    expect(readAll().length).toBe(before); // distill added no entry — corroboration is off-entry
    expect(tally(candId).helpful).toBeGreaterThanOrEqual(1); // signal recorded instead
  });

  it('keeps the self-tool skip — own kb_*/vtfkb captures never distil', () => {
    // capture skips these at write time; assert distiller surfaces nothing either way.
    captureToolCall({ tool_name: 'kb_search', tool_input: { text: 'x' }, tool_result: { isError: true, error: 'boom' } });
    captureToolCall({ tool_name: 'mcp__vtfkb__kb_add', tool_input: {}, tool_result: { isError: true, error: 'boom' } });
    expect(distillCandidates()).toHaveLength(0);
  });
});

describe('counter/signal stream — M2b (ADR-0021 pt 3: append-only, aggregated at read)', () => {
  beforeEach(freshBrain);

  it('recording a signal NEVER mutates the entry (deltas-not-rewrites)', () => {
    const e = addEntry('gotcha', 'a candidate lesson', { zone: 'incoming' });
    const text0 = byId(e.id).text;
    const updated0 = byId(e.id).updated;

    recordSignal(e.id, 'helpful', 'operator');
    recordSignal(e.id, 'harmful', 'operator');

    expect(byId(e.id).text).toBe(text0); // text byte-identical
    expect(byId(e.id).updated).toBe(updated0); // envelope untouched — signal lives off-entry
    const t = tally(e.id);
    expect(t).toEqual({ helpful: 1, harmful: 1, net: 0 }); // aggregated at read
  });
});

describe('corroborated promotion — M2b (ADR-0021 pt 4)', () => {
  beforeEach(freshBrain);

  it('auto-distill alone CANNOT mint trusted knowledge — promotion needs ≥N signals', () => {
    captureError('Bash', { command: 'a' }, 'connection refused');
    const cand = distill().created[0];
    expect(cand.zone).toBe('incoming');

    // below threshold → refused
    expect(eligibleForPromotion(cand.id)).toBe(false);
    expect(() => promoteIfCorroborated(cand.id)).toThrow(/not corroborated/);

    // accrue corroboration
    for (let i = 0; i < PROMOTION_THRESHOLD; i++) recordSignal(cand.id, 'helpful', 'distill:recurrence');
    expect(eligibleForPromotion(cand.id)).toBe(true);
    const out = promoteIfCorroborated(cand.id);
    expect(out.zone).toBe('established'); // now trusted — but only via corroboration
    expect(out.text).toBe(cand.text); // promotion never rewrote text
  });

  it('harmful signals cancel helpful ones (net gate)', () => {
    const e = addEntry('gotcha', 'noisy candidate', { zone: 'incoming' });
    recordSignal(e.id, 'helpful');
    recordSignal(e.id, 'helpful');
    recordSignal(e.id, 'harmful');
    expect(tally(e.id).net).toBe(1);
    expect(eligibleForPromotion(e.id)).toBe(false); // net 1 < 2
  });
});
