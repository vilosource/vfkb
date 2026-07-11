import { describe, it, expect } from 'vitest';

// ADR-0055 can-fail arm: this test is deliberately wrong so the new test.yml
// Brake can be observed going red on a real PR, then this file is reverted
// once that's captured. Not a real assertion about the codebase.
describe('ADR-0055 can-fail arm (deliberately red, to be reverted)', () => {
  it('is intentionally false', () => {
    expect(1).toBe(2);
  });
});
