import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshBrain() {
  process.env.VFKB_DIR = mkdtempSync(join(tmpdir(), 'vfkb-ctx-'));
}

import { addEntry, renderContext, initContextSpine } from '../src/engine.js';
import { writeContextSpine } from '../src/storage.js';

beforeEach(freshBrain);

describe('project context doc — D-ii / ADR-0025', () => {
  it('assembles the authored spine + derived sections (Constitution, Map, decisions)', () => {
    writeContextSpine('# Project Context\n\n## Job-to-be-done\nReconcile ledgers, codename Zephyr-qx7.');
    addEntry('decision', 'Money is stored as integer minor units', { role: 'human', status: 'accepted', constitutional: true });
    addEntry('decision', 'Payloads use protobuf', { role: 'human', status: 'accepted' });
    const doc = renderContext('demo');
    expect(doc).toContain('Zephyr-qx7'); // authored spine surfaced
    expect(doc).toContain('Constitution (derived'); // derived constitution section
    expect(doc).toContain('integer minor units'); // the constitutional decision
    expect(doc).toContain('Map (derived)'); // derived map
    expect(doc).toContain('Load-bearing decisions'); // accepted, non-constitutional
    expect(doc).toContain('protobuf');
  });

  it('without an authored spine still renders derived sections + a scaffold hint', () => {
    addEntry('decision', 'Payloads use protobuf', { role: 'human', status: 'accepted' });
    const doc = renderContext('demo');
    expect(doc).toMatch(/no authored context spine yet/);
    expect(doc).toContain('Map (derived)');
    expect(doc).toContain('protobuf'); // derived half is current even with no spine
  });

  it('initContextSpine scaffolds once and is idempotent (never overwrites an authored spine)', () => {
    expect(initContextSpine().created).toBe(true);
    expect(renderContext('demo')).toContain('Job-to-be-done');
    writeContextSpine('# Project Context\n\nKEEP-ME-marker');
    expect(initContextSpine().created).toBe(false); // already exists → not recreated
    expect(renderContext('demo')).toContain('KEEP-ME-marker'); // authored content preserved
  });
});
