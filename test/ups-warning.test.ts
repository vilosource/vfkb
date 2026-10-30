// ADR-0085 (vfkb#395): ADR-0033's default-branch / detached-HEAD warning reaches the USER as a
// UserPromptSubmit `systemMessage` (the #408 probe: rendered in the interactive TUI 6/6, not
// on `claude -p` text 0/6). Pure core + text + signal round-trip + the CLI e2e over the built
// dist/cli.js in real git repos. Every `it` here was observed RED before the engine change.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  NO_AUTOCOMMIT_LEADIN,
  renderNoAutocommitMessage,
  runSessionEnd,
  realGit,
} from '../src/session-end.js';
import {
  decideUpsWarning,
  upsWarningKey,
  clearPromptNudgeKey,
  readPromptNudgeSignal,
  writePromptNudgeSignal,
} from '../src/prompt-nudge.js';

const CLI = resolve(__dirname, '../dist/cli.js');
const LINE_LEADIN = 'vfkb handoff status:';

// ── the text (decide D5) ──────────────────────────────────────────────────────────────

describe('renderNoAutocommitMessage — one ASCII template for the prompt and for exit (D5)', () => {
  it('pins the default-branch text, plural and singular', () => {
    expect(renderNoAutocommitMessage('default', 'main', 3)).toBe(
      'vfkb will not auto-commit the 3 new brain entries on main (the default branch). ' +
        'Fix: git switch -c <name>; vfkb then commits the brain on exit.',
    );
    expect(renderNoAutocommitMessage('default', 'trunk', 1)).toBe(
      'vfkb will not auto-commit the 1 new brain entry on trunk (the default branch). ' +
        'Fix: git switch -c <name>; vfkb then commits the brain on exit.',
    );
  });
  it('pins the detached text', () => {
    expect(renderNoAutocommitMessage('detached', null, 2)).toBe(
      'vfkb will not auto-commit the 2 new brain entries on a detached HEAD. ' +
        'Fix: git switch -c <name>; vfkb then commits the brain on exit.',
    );
  });
  it('an edit-only diff (0 new ids) says "edits", never "0 new entries" (D2)', () => {
    const t = renderNoAutocommitMessage('default', 'main', 0);
    expect(t).toBe(
      'vfkb will not auto-commit the edits to existing brain entries on main (the default branch). ' +
        'Fix: git switch -c <name>; vfkb then commits the brain on exit.',
    );
    expect(t).not.toMatch(/\b0 new/);
  });
  it('is printable ASCII only, with no backticks, and starts with the lead-in', () => {
    for (const t of [
      renderNoAutocommitMessage('default', 'main', 3),
      renderNoAutocommitMessage('detached', null, 1),
      renderNoAutocommitMessage('default', 'master', 0),
    ]) {
      expect(t).toMatch(/^[\x20-\x7e]+$/);
      expect(t).not.toContain('`');
      expect(t.startsWith(NO_AUTOCOMMIT_LEADIN)).toBe(true);
    }
    expect(NO_AUTOCOMMIT_LEADIN).toBe('vfkb will not auto-commit');
  });
  it('does not overlap the ADR-0084 line lead-in', () => {
    expect(NO_AUTOCOMMIT_LEADIN.startsWith(LINE_LEADIN)).toBe(false);
    expect(LINE_LEADIN.startsWith(NO_AUTOCOMMIT_LEADIN)).toBe(false);
  });
});

// ── the pure decision (D3, D4) ────────────────────────────────────────────────────────

const typed = { prompt: 'hello' };
const main3 = { outcome: 'on-default-branch' as const, branch: 'main', added: 3 };

describe('decideUpsWarning — cadence and skips', () => {
  it('first sight of the condition → emit with key outcome|branch', () => {
    const d = decideUpsWarning(typed, main3, undefined);
    expect(d).toEqual({ emit: true, text: renderNoAutocommitMessage('default', 'main', 3), smKey: 'on-default-branch|main' });
  });
  it('same key → silent, even when the count changed (count is not in the key)', () => {
    expect(decideUpsWarning(typed, { ...main3, added: 9 }, upsWarningKey(main3))).toEqual({ emit: false });
  });
  it('default → detached re-emits', () => {
    const d = decideUpsWarning(typed, { outcome: 'detached-head', branch: null, added: 3 }, upsWarningKey(main3));
    expect(d.emit).toBe(true);
  });
  it('condition false with a stored key → clear (re-arm); without one → nothing', () => {
    for (const outcome of ['topic', 'brain-clean', 'not-a-repo'] as const) {
      expect(decideUpsWarning(typed, { outcome, branch: 'x', added: 0 }, upsWarningKey(main3))).toEqual({ emit: false, clear: true });
      expect(decideUpsWarning(typed, { outcome, branch: 'x', added: 0 }, undefined)).toEqual({ emit: false });
    }
  });
  it('unobserved (a git read failed or ran out of budget) → nothing, key untouched', () => {
    expect(decideUpsWarning(typed, undefined, upsWarningKey(main3))).toEqual({ emit: false });
    expect(decideUpsWarning(typed, undefined, undefined)).toEqual({ emit: false });
  });
  it('a harness-generated turn never emits (ADR-0084 §2.6 applies, D3)', () => {
    expect(decideUpsWarning({ prompt: '<task-notification>\nx' }, main3, undefined)).toEqual({ emit: false });
  });
  it('no stored key (ephemeral session) emits every time the condition holds (D4)', () => {
    for (let i = 0; i < 3; i++) expect(decideUpsWarning(typed, main3, undefined).emit).toBe(true);
  });
});

describe('the signal file keeps the two keys independent (D6)', () => {
  it('compaction clears the line key and keeps smKey', () => {
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-sig-'));
    writePromptNudgeSignal(brain, 's1', { key: 'k', smKey: 'on-default-branch|main' });
    expect(readPromptNudgeSignal(brain, 's1')).toEqual({ key: 'k', smKey: 'on-default-branch|main' });
    clearPromptNudgeKey(brain, 's1');
    expect(readPromptNudgeSignal(brain, 's1')).toEqual({ smKey: 'on-default-branch|main' });
  });
});

// ── SessionEnd shares the text and the predicate ──────────────────────────────────────

const g = (dir: string, args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
const entry = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, type: 'fact', text: id, tags: [], updated: '2030-01-01T00:00:00.000Z', ...extra }) + '\n';

/** main, committed brain with one entry, plus an origin/HEAD-less repo. */
function repo(branch = 'main'): string {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-upsw-'));
  g(dir, ['init', '-q', '-b', branch]);
  g(dir, ['config', 'user.email', 't@t']);
  g(dir, ['config', 'user.name', 't']);
  mkdirSync(join(dir, '.vfkb'));
  writeFileSync(join(dir, '.vfkb', 'entries.jsonl'), entry('known0000001'));
  writeFileSync(join(dir, 'README.md'), 'x\n');
  g(dir, ['add', '.']);
  g(dir, ['commit', '-qm', 'seed']);
  return dir;
}
const dirty = (dir: string, id = 'fresh0000001') => appendFileSync(join(dir, '.vfkb', 'entries.jsonl'), entry(id));

describe('SessionEnd emits the same text (D5, D10)', () => {
  it('on main with one new entry', () => {
    const dir = repo();
    dirty(dir);
    const r = runSessionEnd({ cwd: dir, dataDir: '.vfkb', git: realGit, sessionId: '' });
    expect(r.reason).toBe('on-default-branch');
    expect(r.systemMessage).toBe(renderNoAutocommitMessage('default', 'main', 1));
  });
});

// ── CLI e2e ───────────────────────────────────────────────────────────────────────────

function env(extra: Record<string, string> = {}) {
  return { ...process.env, VFKB_DATA_DIR: '.vfkb', VFKB_DIR: '', KB_SESSION_ID: '', ...extra };
}
function ups(dir: string, payload: unknown, extra: Record<string, string> = {}, cwd = dir): string {
  return execFileSync(process.execPath, [CLI, 'hook', 'user-prompt-submit'], {
    input: JSON.stringify(payload),
    cwd,
    env: env(extra),
    encoding: 'utf8',
  });
}
function seedSession(dir: string, id: string, turnCount: number) {
  mkdirSync(join(dir, '.vfkb', '.sessions'), { recursive: true });
  writeFileSync(
    join(dir, '.vfkb', '.sessions', `${id}.json`),
    JSON.stringify({ sessionId: id, startedAt: 'x', lastAt: 'x', turnCount, injectedIds: [], capturedIds: [] }),
  );
}
const sm = (out: string): string | undefined => (out ? JSON.parse(out).systemMessage : undefined);
const say = (id?: string) => ({ prompt: 'hello', ...(id ? { session_id: id } : {}) });

/** Commit a pinned handoff, then a later non-brain commit: the pin is stale (RFC-043 Part 0). */
function seedStalePin(dir: string) {
  const ts = '2030-02-01T00:00:00.000Z';
  appendFileSync(
    join(dir, '.vfkb', 'entries.jsonl'),
    JSON.stringify({
      id: 'pin000000001', type: 'fact', text: 'handoff: x. next: y', tags: ['handoff', 'next'],
      zone: 'established', author: { role: 'human' }, provenance: { status: 'verified' },
      validity: { valid_from: ts }, created: ts, updated: ts,
    }) + '\n',
  );
  execFileSync('git', ['commit', '-qam', 'handoff'], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: ts, GIT_COMMITTER_DATE: ts } });
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  g(dir, ['add', 'b.txt']);
  execFileSync('git', ['commit', '-qm', 'later b'], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: '2030-03-01T00:00:00Z', GIT_COMMITTER_DATE: '2030-03-01T00:00:00Z' },
  });
}

describe('hook user-prompt-submit — the systemMessage (ADR-0085)', () => {
  it('main + dirty brain: the warning on the FIRST prompt (no first-prompt skip, D3), once per key', () => {
    const dir = repo();
    dirty(dir);
    seedSession(dir, 's1', 0);
    const out = ups(dir, say('s1'));
    expect(sm(out)).toBe(renderNoAutocommitMessage('default', 'main', 1));
    expect(JSON.parse(out).hookSpecificOutput).toBeUndefined(); // the line still skips turn 0
    expect(ups(dir, say('s1'))).toBe(''); // same key → nothing, byte for byte
    dirty(dir, 'fresh0000002'); // a kb_add on main is not a state change
    expect(ups(dir, say('s1'))).toBe('');
  });

  it('detached HEAD + dirty brain → the detached text', () => {
    const dir = repo();
    g(dir, ['checkout', '-q', '--detach']);
    dirty(dir);
    expect(sm(ups(dir, say('d1')))).toBe(renderNoAutocommitMessage('detached', null, 1));
  });

  it('an origin/HEAD-named default branch counts as the default', () => {
    const dir = repo('trunk');
    g(dir, ['update-ref', 'refs/remotes/origin/trunk', 'HEAD']);
    g(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk']);
    dirty(dir);
    expect(sm(ups(dir, say('o1')))).toBe(renderNoAutocommitMessage('default', 'trunk', 1));
  });

  it('edit-only diff on main (0 new ids) still warns (D2: ADR-0033 literal condition)', () => {
    const dir = repo();
    appendFileSync(join(dir, '.vfkb', 'entries.jsonl'), entry('known0000001', { tags: ['archived'], updated: '2030-02-01T00:00:00.000Z' }));
    expect(sm(ups(dir, say('e1')))).toBe(renderNoAutocommitMessage('default', 'main', 0));
  });

  it('no warning: topic branch dirty, main clean, gitignored brain, not a repo', () => {
    const topic = repo();
    g(topic, ['checkout', '-qb', 'feat/x']);
    dirty(topic);
    expect(ups(topic, say('t1'))).toBe('');

    const clean = repo();
    expect(ups(clean, say('c1'))).toBe('');

    const ignored = repo();
    g(ignored, ['rm', '-q', '--cached', '.vfkb/entries.jsonl']);
    writeFileSync(join(ignored, '.gitignore'), '.vfkb/\n');
    g(ignored, ['add', '.gitignore']);
    g(ignored, ['commit', '-qm', 'ignore brain']);
    dirty(ignored);
    expect(sm(ups(ignored, say('i1')))).toBeUndefined();

    const none = mkdtempSync(join(tmpdir(), 'vfkb-upsw-none-'));
    mkdirSync(join(none, '.vfkb'));
    writeFileSync(join(none, '.vfkb', 'entries.jsonl'), entry('x00000000001'));
    expect(sm(ups(none, say('n1')))).toBeUndefined();
  });

  it('re-arms: main dirty → warned → branch + commit → back on main dirty → warns again', () => {
    const dir = repo();
    dirty(dir);
    expect(sm(ups(dir, say('r1')))).toBeDefined();
    g(dir, ['checkout', '-qb', 'feat/y']);
    expect(ups(dir, say('r1'))).toBe(''); // condition false → key cleared
    g(dir, ['commit', '-qam', 'brain']);
    g(dir, ['checkout', '-q', 'main']);
    g(dir, ['merge', '-q', '--ff-only', 'feat/y']);
    dirty(dir, 'fresh0000003');
    expect(sm(ups(dir, say('r1')))).toBe(renderNoAutocommitMessage('default', 'main', 1));
  });

  it('compaction does not re-show the warning (D6)', () => {
    const dir = repo();
    dirty(dir);
    seedSession(dir, 'k1', 1);
    expect(sm(ups(dir, say('k1')))).toBeDefined();
    execFileSync(process.execPath, [CLI, 'hook', 'session-start'], {
      input: JSON.stringify({ session_id: 'k1', source: 'compact' }),
      cwd: dir,
      env: env(),
      encoding: 'utf8',
    });
    expect(sm(ups(dir, say('k1')))).toBeUndefined();
  });

  it('a harness-generated prompt on main: nothing', () => {
    const dir = repo();
    dirty(dir);
    expect(ups(dir, { prompt: '<task-notification>\n<task-id>x</task-id>', session_id: 'h1' })).toBe('');
  });

  it('no session id → the warning on every prompt (no cadence store, D4)', () => {
    const dir = repo();
    dirty(dir);
    for (let i = 0; i < 3; i++) expect(sm(ups(dir, say()))).toBeDefined();
  });

  it('from a subdirectory cwd with an absolute brain (the plugin shape): same warning', () => {
    const dir = repo();
    mkdirSync(join(dir, 'sub'));
    dirty(dir);
    const out = ups(dir, say('a1'), { VFKB_DATA_DIR: join(dir, '.vfkb') }, join(dir, 'sub'));
    expect(sm(out)).toBe(renderNoAutocommitMessage('default', 'main', 1));
  });

  it('stale pin + main dirty, turn 1: BOTH fields in one JSON object', () => {
    const dir = repo();
    seedStalePin(dir);
    dirty(dir);
    seedSession(dir, 'b1', 1);
    const o = JSON.parse(ups(dir, say('b1')));
    expect(o.systemMessage).toBe(renderNoAutocommitMessage('default', 'main', 1));
    expect(o.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(o.hookSpecificOutput.additionalContext).toContain(LINE_LEADIN);
    expect(o.hookSpecificOutput.additionalContext).not.toContain(NO_AUTOCOMMIT_LEADIN); // no agent relay clause
  });
});

describe('hook user-prompt-submit — parity with SessionEnd (one predicate, D2)', () => {
  it('the warning fires iff runSessionEnd would refuse (on-default-branch | detached-head)', () => {
    const states: Array<(d: string) => void> = [
      () => {}, // main, clean
      (d) => dirty(d), // main, new id
      (d) => appendFileSync(join(d, '.vfkb', 'entries.jsonl'), entry('known0000001', { tags: ['x'] })), // main, edit only
      (d) => { g(d, ['checkout', '-q', '--detach']); dirty(d); },
      (d) => { g(d, ['checkout', '-qb', 'feat/p']); dirty(d); },
      (d) => g(d, ['checkout', '-q', '--detach']), // detached, clean
    ];
    for (const [i, setup] of states.entries()) {
      const a = repo();
      setup(a);
      const fired = sm(ups(a, say(`p${i}`))) !== undefined;
      const b = repo();
      setup(b);
      const r = runSessionEnd({ cwd: b, dataDir: '.vfkb', git: realGit, sessionId: '' });
      expect(fired, `state ${i}: ${r.reason}`).toBe(r.reason === 'on-default-branch' || r.reason === 'detached-head');
    }
  }, 60000);
});

describe('hook user-prompt-submit — budget and order (D7)', () => {
  /** A PATH git shim: real git for every subcommand except the named ones, which stall. */
  function stallShim(stall: string[]): string {
    const bin = mkdtempSync(join(tmpdir(), 'vfkb-stallgit-'));
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const cases = stall.map((s) => `  ${s}) exec sleep 10 ;;`).join('\n');
    writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase "$1" in\n${cases}\nesac\nexec "${real}" "$@"\n`);
    chmodSync(join(bin, 'git'), 0o755);
    return bin;
  }
  it('a stalled Part-0 walk (git log) still delivers the warning, alone, in budget', () => {
    const dir = repo();
    seedStalePin(dir);
    dirty(dir);
    seedSession(dir, 'st', 1);
    const bin = stallShim(['log']);
    const t0 = Date.now();
    const out = ups(dir, say('st'), { PATH: `${bin}:${process.env.PATH}` });
    expect(Date.now() - t0).toBeLessThan(3500);
    const o = JSON.parse(out);
    expect(o.systemMessage).toBe(renderNoAutocommitMessage('default', 'main', 1));
    expect(o.hookSpecificOutput).toBeUndefined();
    expect(readPromptNudgeSignal(join(dir, '.vfkb'), 'st').key).toBeUndefined(); // the line's key not written
  }, 20000);
  it('a stalled symbolic-ref never reads as "detached HEAD": no warning', () => {
    const dir = repo();
    dirty(dir);
    const bin = stallShim(['symbolic-ref']);
    expect(sm(ups(dir, say('sr'), { PATH: `${bin}:${process.env.PATH}` }))).toBeUndefined();
  }, 20000);
  it('a stalled git show never inflates the count: no warning', () => {
    const dir = repo();
    dirty(dir);
    const bin = stallShim(['show']);
    expect(sm(ups(dir, say('sh'), { PATH: `${bin}:${process.env.PATH}` }))).toBeUndefined();
    expect(existsSync(join(dir, '.vfkb', '.signals', 'prompt-nudge', 'sh.json'))).toBe(false);
  }, 20000);
  it('a wholly wedged git: empty stdout', () => {
    const dir = repo();
    dirty(dir);
    const bin = mkdtempSync(join(tmpdir(), 'vfkb-slowgit-'));
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec sleep 10\n');
    chmodSync(join(bin, 'git'), 0o755);
    expect(ups(dir, say('w1'), { PATH: `${bin}:${process.env.PATH}` })).toBe('');
  }, 20000);
});

describe('hook user-prompt-submit — the ADR-0084 line is unchanged outside the committed-brain model (§3)', () => {
  // brainCommitOutcome returns `brain-clean` for a gitignored brain (empty status) and for a
  // brain outside the repo (status exits 128). Neither means "nothing new since HEAD", so the
  // B1 count must be the line's own read, as before ADR-0085 (and as Stop counts it).
  /** feat/x, src modified, 3 new entries with no handoff; the brain dir is the caller's. */
  function b1Repo(brainDir: (dir: string) => string): { dir: string; brain: string } {
    const dir = mkdtempSync(join(tmpdir(), 'vfkb-upsw-b1-'));
    g(dir, ['init', '-q', '-b', 'main']);
    g(dir, ['config', 'user.email', 't@t']);
    g(dir, ['config', 'user.name', 't']);
    writeFileSync(join(dir, '.gitignore'), '.vfkb/\n');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'a\n');
    g(dir, ['add', '.']);
    g(dir, ['commit', '-qm', 'seed']);
    g(dir, ['checkout', '-qb', 'feat/x']);
    writeFileSync(join(dir, 'src', 'a.ts'), 'wip\n');
    const brain = brainDir(dir);
    mkdirSync(brain, { recursive: true });
    writeFileSync(join(brain, 'entries.jsonl'), entry('e00000000001') + entry('e00000000002') + entry('e00000000003'));
    mkdirSync(join(brain, '.sessions'), { recursive: true });
    writeFileSync(
      join(brain, '.sessions', 'g1.json'),
      JSON.stringify({ sessionId: 'g1', startedAt: 'x', lastAt: 'x', turnCount: 3, injectedIds: [], capturedIds: [] }),
    );
    return { dir, brain };
  }
  const B1 = 'this session has recorded 3 entries and no handoff/next entry';

  it('a gitignored brain keeps the B1 clause', () => {
    const { dir } = b1Repo((d) => join(d, '.vfkb'));
    const o = JSON.parse(ups(dir, say('g1')));
    expect(o.systemMessage).toBeUndefined();
    expect(o.hookSpecificOutput.additionalContext).toContain(LINE_LEADIN);
    expect(o.hookSpecificOutput.additionalContext).toContain(B1);
  });

  it('a brain outside the repo keeps the B1 clause', () => {
    const outside = mkdtempSync(join(tmpdir(), 'vfkb-upsw-out-'));
    const { dir, brain } = b1Repo(() => join(outside, '.vfkb'));
    const o = JSON.parse(ups(dir, say('g1'), { VFKB_DATA_DIR: brain }));
    expect(o.systemMessage).toBeUndefined();
    expect(o.hookSpecificOutput.additionalContext).toContain(B1);
  });
});
