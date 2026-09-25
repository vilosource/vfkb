import { it, expect } from 'vitest';
// probe: GREEN at the merge base on purpose — the gate must arm via the bug label, then refuse this
it('probe: proves nothing', () => { expect(2 + 2).toBe(4); });
