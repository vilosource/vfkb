import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test gets a throwaway brain; engine reads VTFKB_DIR lazily per call.
function freshBrain() {
  process.env.VTFKB_DIR = mkdtempSync(join(tmpdir(), 'vtfkb-resume-'));
  delete process.env.KB_SESSION_ID;
}

import { addEntry, supersede, renderResume, renderResumeDigest } from '../src/engine.js';
import { promote } from '../src/curator.js';
import { recordSignal } from '../src/counters.js';
import { SessionState, type SessionData } from '../src/session.js';

// A prior-session record whose window spans "all of time" so live entries land in it.
function priorRecord(over: Partial<SessionData> = {}): SessionData {
  return {
    sessionId: 's-prior',
    startedAt: '2000-01-01T00:00:00.000Z',
    lastAt: '2999-01-01T00:00:00.000Z',
    turnCount: 3,
    injectedIds: ['x', 'y'],
    capturedIds: ['z'],
    ...over,
  };
}

describe('M1 session-continuity resume (ADR-0020)', () => {
  beforeEach(freshBrain);

  it('the digest is DERIVED from the live brain — it cannot go stale', () => {
    addEntry('gotcha', 'first lesson');
    const rec = priorRecord();
    expect(renderResumeDigest(rec)).toMatch(/1 entries added/);

    // mutate the brain; the SAME record now renders a DIFFERENT (re-derived) digest —
    // proving the record stores signals, not a frozen prose snapshot.
    addEntry('fact', 'second lesson');
    expect(renderResumeDigest(rec)).toMatch(/2 entries added/);

    // a supersession in-window is counted as superseded, re-derived from the live edge.
    const d = addEntry('decision', 'old decision', { role: 'human', status: 'accepted' });
    supersede(d.id, 'new decision', { role: 'human' });
    expect(renderResumeDigest(rec)).toMatch(/1 superseded/);
  });

  it('observed counts come from the record signals (injected/captured/turns)', () => {
    const out = renderResumeDigest(priorRecord());
    expect(out).toMatch(/2 injected/);
    expect(out).toMatch(/1 captured/);
    expect(out).toMatch(/3 turns/);
  });

  it('an operator note + caller signal render as ASSERTED, never as observed fact', () => {
    const rec = priorRecord({
      note: 'run the live smoke next',
      signals: [{ label: 'tests', value: 'green at abc123' }],
    });
    const out = renderResumeDigest(rec);
    expect(out).toMatch(/ASSERTED by operator.*run the live smoke next/);
    expect(out).toMatch(/tests \(ASSERTED by caller\): green at abc123/);
  });

  it('records() is an append-only log; renderResume shows the PRIOR session, not the current', () => {
    process.env.KB_SESSION_ID = 's-prev';
    const prev = SessionState.load();
    prev.markInjected(['a', 'b']);
    prev.recordCaptured('c');
    prev.save();

    process.env.KB_SESSION_ID = 's-now';
    const cur = SessionState.load();
    cur.save();

    expect(SessionState.records().length).toBe(2); // two distinct records, not one clobbered slot

    addEntry('decision', 'a live decision', { role: 'human', status: 'accepted' });
    const out = renderResume('vtfkb-test', cur);
    expect(out).toContain('<vtfkb-resume project="vtfkb-test">');
    expect(out).toMatch(/2 injected/); // from s-prev's record, not the current session
    expect(out).toContain('<vtfkb-context'); // the live derived knowledge bundle follows
  });

  it('the first ever session has no prior continuity (honest, not fabricated)', () => {
    const out = renderResume('vtfkb-test', SessionState.load());
    expect(out).toContain('first recorded session — no prior continuity');
  });
});

describe('M3 — distilled lessons folded into the resume digest (ADR-0020 Phase B)', () => {
  beforeEach(freshBrain);

  it('surfaces distilled incoming lessons trust-labelled — and stays DERIVED (anti-stale)', () => {
    const e = addEntry('gotcha', 'Tool Bash can fail: connection refused', {
      zone: 'incoming',
      tags: ['distilled'],
    });
    const rec = priorRecord();
    const out = renderResumeDigest(rec);
    expect(out).toMatch(/learned \(auto-distilled this session/);
    expect(out).toContain('Tool Bash can fail: connection refused');
    expect(out).toMatch(/⚠agent/); // a trust-labelled candidate, NOT an asserted fact

    // anti-stale: promote it → trusted (zone≠incoming) → it drops from the candidate
    // list on the next render of the SAME record (proves the digest is re-derived).
    promote(e.id);
    expect(renderResumeDigest(rec)).not.toMatch(/learned \(auto-distilled this session/);
  });

  it('a plain (non-distilled) entry never shows as a learned lesson', () => {
    addEntry('gotcha', 'a hand-written gotcha', { zone: 'incoming' });
    expect(renderResumeDigest(priorRecord())).not.toMatch(/learned \(auto-distilled this session/);
  });

  it('shows the corroboration count when signals exist (M2b counters, aggregated at read)', () => {
    const e = addEntry('gotcha', 'a distilled lesson', { zone: 'incoming', tags: ['distilled'] });
    recordSignal(e.id, 'helpful');
    recordSignal(e.id, 'helpful');
    expect(renderResumeDigest(priorRecord())).toMatch(/\+2 corroborating/);
  });
});
