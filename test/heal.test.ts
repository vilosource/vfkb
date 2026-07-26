// Issue #205 — every harness face heals a destroyed brain, not just the CLI hook.
//
// The L4 (scenarios/pi-heal.mjs) proves the purpose on a live pi session; these
// are the deterministic inner guards.
//
// THE GUARDS ARE BEHAVIOURAL, NOT TEXTUAL. An earlier draft asserted over the
// faces' SOURCE TEXT (`expect(src).toMatch(/healBrain\(\)/)`), which review
// defeated in two moves: a `// was: healBrain() …` comment satisfied the
// kb_resume guard while the call was gone, and making a comment mention
// `healBrain()` satisfied the ordering guard while heal ran AFTER the render.
// A guard a comment can satisfy tests nothing. These drive the real handlers.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addEntry } from '../src/engine.js';
import { healBrain, resumePayload, resetHealLatchForTests } from '../src/heal.js';
import piExtension from '../src/pi-extension.js';

let repo: string;
let brain: string;
const entriesFile = () => join(brain, 'entries.jsonl');
const entriesText = () => readFileSync(entriesFile(), 'utf8');
const git = (...a: string[]) =>
  execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'vfkb-heal-'));
  brain = join(repo, '.vfkb');
  process.env.VFKB_DATA_DIR = brain;
  delete process.env.KB_SESSION_ID;
  delete process.env.VFKB_NO_JOURNAL;
  resetHealLatchForTests();
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
});

afterEach(() => {
  delete process.env.VFKB_NO_JOURNAL;
  delete process.env.VFKB_DATA_DIR;
  resetHealLatchForTests();
  rmSync(repo, { recursive: true, force: true });
});

const SENTINEL = 'quillmarch-tessellate-19';

/** A brain with a committed baseline and one uncommitted entry, then destroyed. */
function destroyedBrain(): { id: string } {
  addEntry('fact', 'baseline knowledge that predates the loss');
  writeFileSync(join(repo, '.gitignore'), '.vfkb/.journal/\n.vfkb/.sessions/\n.vfkb/index-meta.json\n.vfkb/.lock\n');
  git('add', '.vfkb', '.gitignore');
  git('commit', '-qm', 'baseline');
  const e = addEntry('decision', `the entry the destructive git operation eats — ${SENTINEL}`);
  git('checkout', '--', '.vfkb/entries.jsonl');
  expect(entriesText()).not.toContain(e.id); // the loss really happened
  return { id: e.id };
}

describe('healBrain', () => {
  it('restores the destroyed entry with the SAME id and reports it in the note', () => {
    const { id } = destroyedBrain();
    const note = healBrain();
    expect(entriesText()).toContain(id);
    expect(note).toMatch(/restored 1 journaled entry/);
    expect(note).toMatch(/ADR-0064/);
  });

  it('heals ONCE PER PROCESS, not per call (cross-branch contamination guard)', () => {
    // before_agent_start fires on every user message in pi, and the wal survives
    // `git switch` — so per-call healing re-appends another branch's entries into
    // whatever is checked out now. Reproduced on a real checkout during review.
    const { id } = destroyedBrain();
    expect(healBrain()).toMatch(/restored/);
    git('checkout', '--', '.vfkb/entries.jsonl'); // destroy again
    expect(entriesText()).not.toContain(id);
    expect(healBrain()).toBe('');
    expect(entriesText()).not.toContain(id); // latch held — no second restore
    // ...and the latch is per-process, not permanent: a fresh process heals.
    resetHealLatchForTests();
    expect(healBrain()).toMatch(/restored/);
    expect(entriesText()).toContain(id);
  });

  it('is silent when there is nothing to restore', () => {
    addEntry('fact', 'nothing was ever destroyed here');
    expect(healBrain()).toBe('');
  });

  it('refreshes index-meta so a long-lived consumer cannot serve a pre-restore view', () => {
    destroyedBrain();
    const meta = join(brain, 'index-meta.json');
    if (existsSync(meta)) rmSync(meta);
    healBrain();
    expect(existsSync(meta)).toBe(true);
  });

  it('STILL REPORTS when the meta refresh fails — a restore is never silent', () => {
    // Review finding: the note used to be built after writeMeta(), so a throw
    // there (read-only mount, ENOSPC, EISDIR) swallowed the note while the
    // entries were already restored — the silent mutation heal.ts forbids.
    // A directory where the file belongs makes the write throw EISDIR.
    const { id } = destroyedBrain();
    const meta = join(brain, 'index-meta.json');
    rmSync(meta, { force: true });
    mkdirSync(meta, { recursive: true });
    const note = healBrain();
    expect(entriesText()).toContain(id); // the restore happened
    expect(note).toMatch(/restored 1 journaled entry/); // and it was reported
  });

  it('honors the VFKB_NO_JOURNAL kill switch', () => {
    const { id } = destroyedBrain();
    process.env.VFKB_NO_JOURNAL = '1';
    expect(healBrain()).toBe('');
    expect(entriesText()).not.toContain(id);
  });

  it('FAILS OPEN when recovery itself throws — a session start must never die', async () => {
    // The earlier version passed a nonexistent path, which early-returns at
    // `existsSync(wal)` and never reaches the catch: deleting the whole
    // try/catch left it green (proven in review). Force a real throw inside
    // the critical section instead.
    destroyedBrain();
    const journal = await import('../src/journal.js');
    const spy = vi.spyOn(journal, 'recoverFromJournal').mockImplementation(() => {
      throw new Error('recovery exploded');
    });
    try {
      expect(() => healBrain()).not.toThrow();
      resetHealLatchForTests();
      expect(healBrain()).toBe('');
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// The call sites — the actual #205 regression surface. recoverFromJournal
// worked for a year; it was simply unreachable from three of the four faces.
// These DRIVE the faces, so no comment can satisfy them.
// ---------------------------------------------------------------------------
describe('every face heals (issue #205)', () => {
  it('the pi extension heals BEFORE it renders — restored entry AND note reach the agent', async () => {
    const { id } = destroyedBrain();
    const handlers: Record<string, (...a: unknown[]) => unknown> = {};
    piExtension({
      on: (ev: string, h: (...a: unknown[]) => unknown) => {
        handlers[ev] = h;
      },
    } as never);
    const out = (await handlers['before_agent_start']({ systemPrompt: 'BASE' })) as { systemPrompt: string };
    // Ordering is the contract: heal-after-render would restore the entry but
    // leave it OUT of this string, which is the only thing the agent ever sees.
    expect(out.systemPrompt).toContain(SENTINEL);
    expect(out.systemPrompt).toMatch(/restored 1 journaled entry/);
    expect(out.systemPrompt).toContain('BASE'); // the harness's own prompt survives
    expect(entriesText()).toContain(id);
  });

  it('kb_resume / vfkb resume heal before rendering (the shared resumePayload)', () => {
    const { id } = destroyedBrain();
    const payload = resumePayload('healproj');
    expect(payload).toMatch(/restored 1 journaled entry/);
    expect(payload).toContain(SENTINEL); // the restored entry is IN the render
    expect(payload.indexOf('restored 1 journaled entry')).toBeLessThan(payload.indexOf(SENTINEL));
    expect(entriesText()).toContain(id);
  });
});
