// Issue #205 — every harness face heals a destroyed brain, not just the CLI hook.
//
// The L4 (scenarios/pi-heal.mjs) proves the purpose on a live pi session; these
// are the deterministic inner guards: that healBrain does the four things the
// faces depend on (restore, note, meta refresh, fail-open), and — the part that
// actually regressed — that the pi extension and kb_resume CALL it. A unit test
// of healBrain alone would have stayed green through the entire bug, because
// the bug was a missing call site, not a broken function.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addEntry } from '../src/engine.js';
import { healBrain } from '../src/heal.js';

let repo: string;
let brain: string;
const entriesFile = () => join(brain, 'entries.jsonl');
const git = (...a: string[]) =>
  execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'vfkb-heal-'));
  brain = join(repo, '.vfkb');
  process.env.VFKB_DATA_DIR = brain;
  delete process.env.KB_SESSION_ID;
  delete process.env.VFKB_NO_JOURNAL;
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
});

afterEach(() => {
  delete process.env.VFKB_NO_JOURNAL;
  delete process.env.VFKB_DATA_DIR;
  rmSync(repo, { recursive: true, force: true });
});

/** A brain with a committed baseline and one uncommitted entry, then destroyed. */
function destroyedBrain(): { id: string } {
  addEntry('fact', 'baseline knowledge that predates the loss');
  writeFileSync(join(repo, '.gitignore'), '.vfkb/.journal/\n.vfkb/.sessions/\n.vfkb/index-meta.json\n.vfkb/.lock\n');
  git('add', '.vfkb', '.gitignore');
  git('commit', '-qm', 'baseline');
  const e = addEntry('decision', 'the entry the destructive git operation eats');
  git('checkout', '--', '.vfkb/entries.jsonl');
  expect(readFileSync(entriesFile(), 'utf8')).not.toContain(e.id); // the loss really happened
  return { id: e.id };
}

describe('healBrain', () => {
  it('restores the destroyed entry with the SAME id and reports it in the note', () => {
    const { id } = destroyedBrain();
    const note = healBrain(brain);
    expect(readFileSync(entriesFile(), 'utf8')).toContain(id);
    expect(note).toMatch(/restored 1 journaled entry/);
    expect(note).toMatch(/ADR-0064/);
  });

  it('is silent and idempotent when there is nothing to restore', () => {
    destroyedBrain();
    healBrain(brain);
    const after = readFileSync(entriesFile(), 'utf8');
    expect(healBrain(brain)).toBe(''); // second pass restores nothing, says nothing
    expect(readFileSync(entriesFile(), 'utf8')).toBe(after);
  });

  it('refreshes index-meta so a long-lived consumer cannot serve a pre-restore view', () => {
    destroyedBrain();
    const meta = join(brain, 'index-meta.json');
    if (existsSync(meta)) rmSync(meta);
    healBrain(brain);
    expect(existsSync(meta)).toBe(true);
  });

  it('honors the VFKB_NO_JOURNAL kill switch', () => {
    const { id } = destroyedBrain();
    process.env.VFKB_NO_JOURNAL = '1';
    expect(healBrain(brain)).toBe('');
    expect(readFileSync(entriesFile(), 'utf8')).not.toContain(id);
  });

  it('FAILS OPEN — an unreadable brain returns no note instead of throwing', () => {
    // A session start must never die because recovery could not run.
    expect(() => healBrain('/proc/definitely/not/a/brain')).not.toThrow();
    expect(healBrain('/proc/definitely/not/a/brain')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The call sites. This is the actual #205 regression surface: recoverFromJournal
// worked fine for a year — it just was not reachable from two of the three
// faces. These read the built faces' source so a future refactor that drops the
// call goes red here, not in a metered L4 six weeks later.
// ---------------------------------------------------------------------------
describe('every face heals (issue #205)', () => {
  const src = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8');

  it('the pi extension heals BEFORE it renders the resume', () => {
    const s = src('pi-extension.ts');
    expect(s).toMatch(/healBrain\(\)/);
    // Ordering is the contract: restored entries must be in the render, and the
    // note must lead the injection.
    expect(s.indexOf('healBrain()')).toBeLessThan(s.indexOf('renderResume(project(), session)'));
    expect(s).toMatch(/restoreNote \+ resume/);
  });

  it('kb_resume heals before it renders', () => {
    expect(src('mcp-server.ts')).toMatch(/healBrain\(\) \+ renderResume/);
  });

  it('the CLI session-start hook still heals, through the same helper', () => {
    const s = src('cli.ts');
    expect(s).toMatch(/const restoreNote = healBrain\(\);/);
    // The old hand-rolled copy must be gone, or the faces can drift apart again.
    expect(s).not.toMatch(/recoverFromJournal/);
  });
});
