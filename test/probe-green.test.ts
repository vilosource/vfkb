import { it, expect } from 'vitest';
// probe: passes at the merge base — the reproduction gate must refuse it (ADR-0075 cl. 4)
it('probe: a test that proves nothing', () => { expect(1 + 1).toBe(2); });
