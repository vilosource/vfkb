// scenarios/lib/observed-models.mjs (vfkb#395, decide Q2): the pinned model is OBSERVED in the
// sandbox transcript (assistant.message.model), never asserted from the --model flag
// (ADR-0050). Every case can fail.
import { describe, it, expect } from 'vitest';
import { observedModels } from '../scenarios/lib/observed-models.mjs';
import { voidReason } from '../scenarios/lib/ups-warning-verdict.mjs';

const PIN = 'claude-haiku-4-5-20251001';
const asst = (model: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'x' }] }, ...extra });
const user = JSON.stringify({ type: 'user', message: { content: 'hi' } });

describe('observedModels', () => {
  it('pinned only: valid', () => {
    const r = observedModels([user, asst(PIN), asst(PIN)], PIN);
    expect(r.models).toEqual([PIN]);
    expect(r.synthetic).toBe(0);
    expect(r.invalidReasons).toEqual([]);
  });
  it('pinned plus another model: invalid, naming both', () => {
    const r = observedModels([asst(PIN), asst('claude-sonnet-4-5-20250929')], PIN);
    expect(r.models).toEqual([PIN, 'claude-sonnet-4-5-20250929']);
    expect(r.invalidReasons.join(' ')).toMatch(/claude-sonnet-4-5-20250929/);
    expect(r.invalidReasons.join(' ')).toMatch(PIN);
  });
  it('<synthetic> only: invalid, no real assistant message, counted', () => {
    const r = observedModels([asst('<synthetic>', { isApiErrorMessage: true })], PIN);
    expect(r.models).toEqual([]);
    expect(r.synthetic).toBe(1);
    expect(r.invalidReasons.join(' ')).toMatch(/no real assistant message/);
  });
  it('pinned plus <synthetic>: valid, synthetic counted', () => {
    const r = observedModels([asst(PIN), asst('<synthetic>')], PIN);
    expect(r.invalidReasons).toEqual([]);
    expect(r.synthetic).toBe(1);
  });
  it('malformed lines are skipped', () => {
    const r = observedModels(['{not json', '', asst(PIN)], PIN);
    expect(r.models).toEqual([PIN]);
    expect(r.invalidReasons).toEqual([]);
  });
  it('no assistant lines: invalid', () => {
    expect(observedModels([user], PIN).invalidReasons.join(' ')).toMatch(/no real assistant message/);
    expect(observedModels([], PIN).invalidReasons.length).toBeGreaterThan(0);
  });
  it('a short alias never matches the full pinned id', () => {
    expect(observedModels([asst('haiku')], PIN).invalidReasons.length).toBeGreaterThan(0);
  });
});

describe('voidReason consumes the observed-model check', () => {
  const ok = { pluginInstalled: true, reachedPrompt: true, replies: 3, prompts: 3, hookControl: true, relayedByModel: false };
  it('a trial whose observed models are not exactly the pin is VOID', () => {
    expect(voidReason({ ...ok, modelInvalid: [] })).toBeNull();
    expect(voidReason({ ...ok, modelInvalid: ['observed [claude-sonnet-4-5] ≠ pinned x'] })).toMatch(/model/);
  });
  it('an absent model check is VOID too (the pin must be observed, not assumed)', () => {
    expect(voidReason({ ...ok })).toMatch(/model/);
  });
});
