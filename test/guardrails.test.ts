import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshBrain() {
  process.env.VTFKB_DIR = mkdtempSync(join(tmpdir(), 'vtfkb-guard-'));
  delete process.env.KB_SESSION_ID;
}

import { addEntry, captureToolCall, readAll, renderContextDelta } from '../src/engine.js';
import { detectSecrets } from '../src/secrets.js';
import { SessionState } from '../src/session.js';
import { isBrainWrite } from '../src/gating.js';
import { save } from '../src/git.js';

beforeEach(freshBrain);

describe('no-secrets write-time lint (D6e)', () => {
  it('detects common secret shapes', () => {
    expect(detectSecrets('AKIA1234567890ABCDEF').map((h) => h.kind)).toContain('aws-access-key-id');
    expect(detectSecrets('ghp_' + 'a'.repeat(36)).map((h) => h.kind)).toContain('github-token');
    expect(detectSecrets('api_key = "sk-abcdef0123456789xyz"').map((h) => h.kind)).toContain('assigned-secret');
    expect(detectSecrets('-----BEGIN RSA PRIVATE KEY-----').map((h) => h.kind)).toContain('private-key-block');
    expect(detectSecrets('the deploy host is example.com')).toHaveLength(0);
  });
  it('addEntry throws on a planted secret (and stores nothing)', () => {
    expect(() => addEntry('fact', 'token=ABCDEF0123456789ABCDEF', { role: 'human' })).toThrow(/secret/i);
    expect(readAll()).toHaveLength(0);
  });
  it('captureToolCall SKIPS a secret-bearing tool output (never crashes)', () => {
    const r = captureToolCall({ tool_name: 'Bash', tool_input: { command: 'echo AKIA1234567890ABCDEF' } });
    expect(r).toBeNull();
    expect(readAll()).toHaveLength(0);
  });
});

describe('session isolation + per-turn delta (L4 / Tier C)', () => {
  it('two session ids keep independent injected sets, and persist by id', () => {
    addEntry('fact', 'shared fact', { role: 'human' });
    process.env.KB_SESSION_ID = 'sessA';
    const a1 = SessionState.load();
    const dA = renderContextDelta(a1, 'p'); // injects the fact for A
    a1.save();
    expect(dA).toContain('shared fact');

    // a NEW load of the same id sees the fact already injected → empty delta
    const a2 = SessionState.load();
    expect(renderContextDelta(a2, 'p')).toBe('');

    // a DIFFERENT session id starts clean → injects the fact again
    process.env.KB_SESSION_ID = 'sessB';
    const b1 = SessionState.load();
    expect(renderContextDelta(b1, 'p')).toContain('shared fact');
  });

  it('delta only carries entries added since the last turn', () => {
    process.env.KB_SESSION_ID = 'sessC';
    addEntry('fact', 'first', { role: 'human' });
    const s = SessionState.load();
    expect(renderContextDelta(s, 'p')).toContain('first');
    s.save();
    // nothing new → empty
    expect(renderContextDelta(s, 'p')).toBe('');
    // add another → only the new one
    addEntry('fact', 'second', { role: 'human' });
    const d = renderContextDelta(s, 'p');
    expect(d).toContain('second');
    expect(d).not.toContain('first');
  });
});

describe('tool-gating (block direct brain writes)', () => {
  it('flags writes into the brain dir, ignores writes elsewhere + non-write tools', () => {
    const brain = process.env.VTFKB_DIR!;
    expect(isBrainWrite('Write', { file_path: join(brain, 'entries.jsonl') })).toBe(true);
    expect(isBrainWrite('edit', { path: join(brain, '.sessions/x.json') })).toBe(true);
    expect(isBrainWrite('Write', { file_path: '/tmp/somewhere-else/file.txt' })).toBe(false);
    expect(isBrainWrite('Bash', { command: 'rm -rf ' + brain })).toBe(false); // not a write-tool
    expect(isBrainWrite('Read', { file_path: join(brain, 'entries.jsonl') })).toBe(false);
  });
});

describe('git lifecycle (Phase 6)', () => {
  it('save() initializes a repo and commits; idempotent when clean', () => {
    const brain = process.env.VTFKB_DIR!;
    addEntry('fact', 'committable fact', { role: 'human' });
    const r = save('vtfkb: test commit', 'human', brain);
    expect(r.committed).toBe(true);
    expect(existsSync(join(brain, '.git'))).toBe(true);
    const log = execFileSync('git', ['log', '--oneline'], { cwd: brain, encoding: 'utf8' });
    expect(log).toContain('vtfkb: test commit');
    const tracked = execFileSync('git', ['ls-files'], { cwd: brain, encoding: 'utf8' });
    expect(tracked).toContain('entries.jsonl');
    // nothing new → no-op
    expect(save('again', 'human', brain).committed).toBe(false);
  });
});
