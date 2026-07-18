import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addEntry, updateEntry } from '../src/engine.js';
import { journalAppend, journalStatus, purgeJournal, recoverFromJournal } from '../src/journal.js';

let repo: string;
let brain: string;
const wal = () => join(brain, '.journal', 'wal.jsonl');
const entriesFile = () => join(brain, 'entries.jsonl');
const entriesText = () => readFileSync(entriesFile(), 'utf8');
const walText = () => (existsSync(wal()) ? readFileSync(wal(), 'utf8') : '');
const git = (...a: string[]) =>
  execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function freshGitBrain() {
  repo = mkdtempSync(join(tmpdir(), 'vfkb-journal-'));
  brain = join(repo, '.vfkb');
  process.env.VFKB_DIR = brain;
  delete process.env.KB_SESSION_ID;
  delete process.env.VFKB_NO_JOURNAL;
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
}

beforeEach(freshGitBrain);
afterEach(() => {
  delete process.env.VFKB_NO_JOURNAL;
});

describe('durable-capture journal (ADR-0064)', () => {
  it('mirrors every append journal-first, byte-identical lines', () => {
    const e = addEntry('fact', 'captured knowledge', { role: 'human' });
    const inEntries = entriesText().split('\n').find((l) => l.includes(e.id));
    const inWal = walText().split('\n').find((l) => l.includes(e.id));
    expect(inWal).toBeDefined();
    expect(inWal).toBe(inEntries);
  });

  it('VFKB_NO_JOURNAL=1 disables the mirror (the contrast-arm kill switch)', () => {
    process.env.VFKB_NO_JOURNAL = '1';
    addEntry('fact', 'unmirrored', { role: 'human' });
    expect(existsSync(wal())).toBe(false);
  });

  it('recovery restores destroyed uncommitted lines verbatim — same id, same bytes; idempotent', () => {
    addEntry('fact', 'committed baseline', { role: 'human' });
    git('add', '.vfkb/entries.jsonl');
    git('commit', '-q', '-m', 'baseline');
    const e = addEntry('decision', 'uncommitted capture', { role: 'human' });
    const lostLine = entriesText().split('\n').find((l) => l.includes(e.id));
    git('checkout', '--', '.vfkb/entries.jsonl'); // the incident
    expect(entriesText()).not.toContain(e.id);
    const r1 = recoverFromJournal(brain);
    expect(r1.restored).toBe(1);
    expect(entriesText().split('\n')).toContain(lostLine);
    const r2 = recoverFromJournal(brain);
    expect(r2.restored).toBe(0);
  });

  it('pair semantics: a lost REVISION of a committed id is restored (the bare-id trap, RFC-034 §3)', () => {
    const e = addEntry('fact', 'entry that later gets retagged', { role: 'human' });
    git('add', '.vfkb/entries.jsonl');
    git('commit', '-q', '-m', 'baseline with the id at HEAD');
    updateEntry(e.id, { tags: ['retagged'] }); // appends a new (id, updated) revision line
    git('checkout', '--', '.vfkb/entries.jsonl');
    expect(entriesText()).not.toContain('"tags":["retagged"]');
    const r = recoverFromJournal(brain);
    expect(r.restored).toBe(1);
    expect(entriesText()).toContain('"tags":["retagged"]');
  });

  it('prune drops pairs committed at HEAD but keeps the uncommitted window', () => {
    const a = addEntry('fact', 'gets committed', { role: 'human' });
    git('add', '.vfkb/entries.jsonl');
    git('commit', '-q', '-m', 'commit a');
    const b = addEntry('fact', 'stays uncommitted', { role: 'human' });
    recoverFromJournal(brain);
    const w = walText();
    expect(w).not.toContain(a.id);
    expect(w).toContain(b.id);
  });

  it('unborn HEAD (fresh repo, no commit): prune nothing — never prune on uncertainty', () => {
    const e = addEntry('fact', 'pre-first-commit capture', { role: 'human' });
    recoverFromJournal(brain);
    expect(walText()).toContain(e.id);
  });

  it('non-git brain: wal prunes down to lines absent from entries.jsonl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vfkb-journal-nogit-'));
    process.env.VFKB_DIR = join(dir, '.vfkb');
    const e = addEntry('fact', 'default-tier capture', { role: 'human' });
    const r = recoverFromJournal(join(dir, '.vfkb'));
    expect(r.restored).toBe(0);
    const w = existsSync(join(dir, '.vfkb', '.journal', 'wal.jsonl'))
      ? readFileSync(join(dir, '.vfkb', '.journal', 'wal.jsonl'), 'utf8')
      : '';
    expect(w).not.toContain(e.id);
  });

  it('purge --id suppresses the pair: recovery never resurrects a redacted entry', () => {
    addEntry('fact', 'innocent neighbour', { role: 'human' });
    const secret = addEntry('fact', 'LEAKED-CREDENTIAL-xyz', { role: 'human' });
    const p = purgeJournal(brain, { id: secret.id });
    expect(p.purged).toBe(1);
    expect(walText()).not.toContain(secret.id);
    // simulate the operator's redaction of the tracked file
    writeFileSync(
      entriesFile(),
      entriesText()
        .split('\n')
        .filter((l) => !l.includes(secret.id))
        .join('\n'),
    );
    const r = recoverFromJournal(brain);
    expect(entriesText()).not.toContain('LEAKED-CREDENTIAL');
    expect(r.restored).toBe(0);
  });

  it('journalStatus reports a half-done redaction (suppressed pair still in entries.jsonl)', () => {
    const secret = addEntry('fact', 'secret-to-redact', { role: 'human' });
    purgeJournal(brain, { id: secret.id });
    // operator forgot to edit entries.jsonl
    expect(journalStatus(brain).suppressedInEntries).toBe(1);
  });

  it('journal write failure is fail-open: the primary append still lands', () => {
    mkdirSync(join(brain, '.journal'), { recursive: true });
    chmodSync(join(brain, '.journal'), 0o555);
    try {
      const e = addEntry('fact', 'capture survives a dead journal', { role: 'human' });
      expect(entriesText()).toContain(e.id);
    } finally {
      chmodSync(join(brain, '.journal'), 0o755);
    }
  });

  it('torn-tail guard: recovery onto a partial trailing line never glues JSON (review M1)', () => {
    const e = addEntry('decision', 'the entry the tail must not eat', { role: 'human' });
    // simulate a crash mid-append / hand-redaction saved without a final newline
    writeFileSync(entriesFile(), '{"id":"tttttttttttt","type":"fact","te'); // torn, no \n
    const r = recoverFromJournal(brain);
    expect(r.restored).toBe(1);
    const lines = entriesText().split('\n').filter((l) => l.trim());
    const restored = lines.find((l) => l.includes(e.id));
    expect(restored).toBeDefined();
    expect(() => JSON.parse(restored!)).not.toThrow();
    // and the journal copy survives until the pair is durable (unborn HEAD → no prune)
    expect(walText()).toContain(e.id);
  });

  it('kill switch disables recovery too — no restores from a stale wal (review m7)', () => {
    const e = addEntry('fact', 'journaled before the emergency', { role: 'human' });
    writeFileSync(entriesFile(), '');
    process.env.VFKB_NO_JOURNAL = '1';
    const r = recoverFromJournal(brain);
    expect(r.restored).toBe(0);
    expect(entriesText()).not.toContain(e.id);
  });

  it('the hook e2e: session-start restores and the note rides INSIDE additionalContext (review m8)', () => {
    const cli = join(__dirname, '..', 'dist', 'cli.js');
    const env = { ...process.env, VFKB_DATA_DIR: brain, VFKB_PROJECT: 'journaltest' };
    delete (env as Record<string, string | undefined>).VFKB_DIR;
    execFileSync('node', [cli, 'add', 'fact', 'baseline entry'], { env });
    git('add', '.vfkb/entries.jsonl');
    git('commit', '-q', '-m', 'baseline');
    const out = execFileSync('node', [cli, 'add', 'decision', 'destroyed-then-restored capture'], {
      env,
      encoding: 'utf8',
    });
    const id = (out.match(/([0-9a-f]{12})/) || [])[1];
    git('checkout', '--', '.vfkb/entries.jsonl');
    const hookOut = execFileSync('node', [cli, 'hook', 'session-start'], {
      env,
      encoding: 'utf8',
      input: JSON.stringify({ session_id: 'jt', hook_event_name: 'SessionStart' }),
    });
    const payload = JSON.parse(hookOut); // the envelope must stay valid JSON
    const ctx = payload.hookSpecificOutput.additionalContext as string;
    expect(ctx).toMatch(/vfkb restored 1 journaled entry/);
    expect(entriesText()).toContain(id!);
  });

  it('source hygiene: journal.ts carries no raw NUL bytes — the diff must stay reviewable (review M2)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'journal.ts'));
    expect(src.includes(0)).toBe(false);
  });

  it('the mirror is jsonl-fs-only: a non-fs backend never materializes its pseudo-location on disk', async () => {
    const { setStorageBackend, storageBackend } = await import('../src/backend.js');
    const original = storageBackend();
    const records: unknown[] = [];
    setStorageBackend({
      name: 'mem-test',
      location: () => 'memory://test',
      append: (rec: unknown) => void records.push(rec),
      readAllRaw: () => ({ records: [...records], malformed: [] }),
      readMetaRaw: () => null,
      writeMetaRaw: () => {},
      readSpine: () => null,
      writeSpine: () => {},
      spinePath: () => 'memory://test/context.md',
      listSessionIds: () => [],
      readSessionRecord: () => null,
      writeSessionRecord: () => {},
      withExclusive: <T,>(fn: () => T) => fn(),
    });
    rmSync('memory:', { recursive: true, force: true }); // hermetic: drop any prior run's pollution
    try {
      addEntry('fact', 'in-memory capture', { role: 'human' });
      expect(records.length).toBeGreaterThan(0);
      expect(existsSync('memory:')).toBe(false); // the PR #204 stray-dir defect
    } finally {
      setStorageBackend(original);
      rmSync('memory:', { recursive: true, force: true });
    }
  });

  it('journalAppend mirrors arbitrary records without touching entries.jsonl', () => {
    mkdirSync(brain, { recursive: true });
    journalAppend(brain, { id: 'abcabcabcabc', updated: '2026-07-18T00:00:00Z', text: 'x' });
    expect(walText()).toContain('abcabcabcabc');
    expect(existsSync(entriesFile())).toBe(false);
  });
});
