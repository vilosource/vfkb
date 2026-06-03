import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test gets a throwaway brain dir.
function freshBrain() {
  process.env.VTFKB_DIR = mkdtempSync(join(tmpdir(), 'vtfkb-test-'));
}

// Import AFTER env is settable; engine reads VTFKB_DIR lazily per call.
import {
  addEntry,
  captureToolCall,
  deriveTrust,
  isInjectable,
  readAll,
  rerank,
  renderContextBundle,
  SESSION_BUDGET_CHARS,
} from '../src/engine.js';
import type { KnowledgeEntry } from '../src/types.js';

beforeEach(freshBrain);

describe('deriveTrust (ADR-0011)', () => {
  it('maps roles to the trust projection', () => {
    expect(deriveTrust('human')).toBe('operator');
    expect(deriveTrust('architect')).toBe('agent');
    expect(deriveTrust('executor')).toBe('agent');
    expect(deriveTrust('judge')).toBe('agent');
    expect(deriveTrust('init')).toBe('import');
    expect(deriveTrust('import')).toBe('import');
  });
});

describe('addEntry / readAll (ADR-0013 pure-JS JSONL)', () => {
  it('round-trips and defaults trust-appropriate zone+status', () => {
    addEntry('fact', 'a human fact', { role: 'human' });
    addEntry('fact', 'an agent fact', { role: 'executor' });
    const all = readAll();
    expect(all).toHaveLength(2);
    const human = all.find((e) => e.author.role === 'human')!;
    const agent = all.find((e) => e.author.role === 'executor')!;
    expect(human.zone).toBe('established');
    expect(human.provenance.status).toBe('verified');
    expect(agent.zone).toBe('incoming');
    expect(agent.provenance.status).toBe('unverified');
    expect(human.validity.valid_from).toBeTruthy();
  });
});

describe('isInjectable — the ADR-0005 + ADR-0011 hard filter', () => {
  const base: KnowledgeEntry = {
    id: 'x',
    type: 'fact',
    text: 't',
    tags: [],
    zone: 'established',
    author: { role: 'human' },
    provenance: { status: 'verified' },
    validity: { valid_from: '2026-01-01' },
    created: '2026-01-01',
    updated: '2026-01-01',
  };
  it('injects a live verified entry', () => {
    expect(isInjectable(base, '2026-06-03')).toBe(true);
  });
  it('injects unverified (labelled, not excluded)', () => {
    expect(isInjectable({ ...base, provenance: { status: 'unverified' } }, '2026-06-03')).toBe(true);
  });
  it('excludes archived / superseded / deprecated', () => {
    expect(isInjectable({ ...base, zone: 'archive' }, '2026-06-03')).toBe(false);
    expect(isInjectable({ ...base, status: 'superseded' }, '2026-06-03')).toBe(false);
    expect(isInjectable({ ...base, status: 'deprecated' }, '2026-06-03')).toBe(false);
  });
  it('excludes expired (valid_until < today) — the Stark-FQDN class', () => {
    const expired = { ...base, validity: { valid_from: '2025-01-01', valid_until: '2025-12-01' } };
    expect(isInjectable(expired, '2026-06-03')).toBe(false);
    const future = { ...base, validity: { valid_from: '2025-01-01', valid_until: '2027-01-01' } };
    expect(isInjectable(future, '2026-06-03')).toBe(true);
  });
});

describe('rerank — ADR-0012 heuristic soft sort', () => {
  it('patterns/gotchas before facts; operator before agent', () => {
    addEntry('fact', 'agent fact', { role: 'executor' });
    addEntry('pattern', 'a pattern', { role: 'executor' });
    addEntry('fact', 'operator fact', { role: 'human' });
    const ordered = rerank(readAll());
    expect(ordered[0].type).toBe('pattern'); // type weight wins
    // among the two facts, the operator one ranks above the agent one
    const facts = ordered.filter((e) => e.type === 'fact');
    expect(deriveTrust(facts[0].author.role)).toBe('operator');
  });
});

describe('renderContextBundle — ADR-0015 Tier-A budget', () => {
  it('wraps in <vtfkb-context> and respects the 10k char budget', () => {
    for (let i = 0; i < 500; i++) addEntry('fact', `padding fact number ${i} `.repeat(10), { role: 'human' });
    const block = renderContextBundle('demo');
    expect(block.startsWith('<vtfkb-context project="demo">')).toBe(true);
    expect(block.endsWith('</vtfkb-context>')).toBe(true);
    expect(block.length).toBeLessThanOrEqual(SESSION_BUDGET_CHARS);
  });
  it('omits expired entries from the rendered block', () => {
    addEntry('fact', 'CURRENT-TOKEN-LIVE', { role: 'human' });
    addEntry('fact', 'OLD-TOKEN-EXPIRED', { role: 'human', validUntil: '2025-01-01' });
    const block = renderContextBundle();
    expect(block).toContain('CURRENT-TOKEN-LIVE');
    expect(block).not.toContain('OLD-TOKEN-EXPIRED');
  });
});

describe('captureToolCall — ADR-0015 Tier-B / ADR-0011 origin', () => {
  it('captures a tool event as an unverified agent fact with tool_call origin', () => {
    const e = captureToolCall({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, call_id: 'c1' })!;
    expect(e.type).toBe('fact');
    expect(deriveTrust(e.author.role)).toBe('agent');
    expect(e.provenance.status).toBe('unverified');
    expect(e.provenance.origin).toEqual({ kind: 'tool_call', tool: 'Bash', call_id: 'c1' });
    expect(readAll()).toHaveLength(1);
  });
  it('ignores an event with no tool_name', () => {
    expect(captureToolCall({})).toBeNull();
  });
});
