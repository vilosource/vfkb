import { describe, it, expect } from 'vitest';
describe('ADR-0055 can-fail arm (round 2 — observing the BLOCK, will be reverted)', () => {
  it('deliberately fails', () => { expect(1).toBe(2); });
});
