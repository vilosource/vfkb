// CLI e2e for `vfkb hook user-prompt-submit` (ADR-0084 §2, vfkb#385) over the built
// dist/cli.js, in a temp repo + brain. Covers RFC-047 §7.6's CLI rows plus the decide
// step's Q2 (first prompt), Q10 (read-only against the session record) and Q12 (budget).
import { describe, it, expect } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(__dirname, '../dist/cli.js');
const LEADIN = 'vfkb handoff status:';

function env(dir: string, extra: Record<string, string> = {}) {
  // KB_SESSION_ID would override the payload id; clear it so the payload is the fixture.
  // Relative brain path, as the plugin's cwd-anchored hooks resolve it: an absolute /var/…
  // path against a /private/var/… cwd (macOS tmpdir) defeats the `git show HEAD:<rel>`
  // count that B1 shares with Stop (a pre-existing helper limit, not this hook's).
  return { ...process.env, VFKB_DATA_DIR: '.vfkb', VFKB_DIR: '', KB_SESSION_ID: '', ...extra };
}
function hook(dir: string, sub: string, payload: unknown, extra: Record<string, string> = {}): string {
  return execFileSync(process.execPath, [CLI, 'hook', sub], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    cwd: dir,
    env: env(dir, extra),
    encoding: 'utf8',
  });
}
const ups = (dir: string, payload: unknown, extra: Record<string, string> = {}) =>
  hook(dir, 'user-prompt-submit', payload, extra);

const git = (dir: string, args: string[], when?: string) =>
  execFileSync('git', args, {
    cwd: dir,
    stdio: 'ignore',
    env: when ? { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : process.env,
  });

/** A repo on topic branch feat/x whose pinned handoff predates a later non-brain commit. */
function staleRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-ups-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, '.vfkb'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'a\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'seed'], '2030-01-01T00:00:00Z');
  git(dir, ['checkout', '-qb', 'feat/x']);
  const ts = '2030-02-01T00:00:00.000Z';
  writeFileSync(
    join(dir, '.vfkb', 'entries.jsonl'),
    JSON.stringify({
      id: 'pin000000001',
      type: 'fact',
      text: 'handoff: x. next: y',
      tags: ['handoff', 'next'],
      zone: 'established',
      author: { role: 'human' },
      provenance: { status: 'verified' },
      validity: { valid_from: ts },
      created: ts,
      updated: ts,
    }) + '\n',
  );
  git(dir, ['add', '.vfkb/entries.jsonl']);
  git(dir, ['commit', '-qm', 'handoff'], ts);
  commitLater(dir, 'b');
  return dir;
}
let n = 0;
function commitLater(dir: string, name: string) {
  writeFileSync(join(dir, 'src', `${name}.ts`), `${name}\n`);
  git(dir, ['add', `src/${name}.ts`]);
  git(dir, ['commit', '-qm', `later ${name}`], `2030-0${3 + (n++ % 6)}-01T00:00:00Z`);
}
/** Seed a session record at a given turnCount (what SessionStart + N Stops would leave). */
function seedSession(dir: string, id: string, turnCount: number) {
  mkdirSync(join(dir, '.vfkb', '.sessions'), { recursive: true });
  writeFileSync(
    join(dir, '.vfkb', '.sessions', `${id}.json`),
    JSON.stringify({ sessionId: id, startedAt: 'x', lastAt: 'x', turnCount, injectedIds: [], capturedIds: [] }),
  );
}
const ctxOf = (out: string) => JSON.parse(out).hookSpecificOutput;
const typed = (id?: string) => ({ prompt: 'thanks, that is all', ...(id ? { session_id: id } : {}) });

describe('hook user-prompt-submit — emission and cadence', () => {
  it('stale pin: emits once, is silent for the same key, re-emits after a new commit', () => {
    const dir = staleRepo();
    seedSession(dir, 's1', 1);
    const first = ups(dir, typed('s1'));
    expect(ctxOf(first).hookEventName).toBe('UserPromptSubmit');
    expect(ctxOf(first).additionalContext).toBe(
      `${LEADIN} the pinned handoff (pin000000001, 2030-02-01) predates a later commit on feat/x. If this prompt ends ` +
        'the session, a fresh handoff/next entry (kb_add type=fact, tags=handoff,next, role=human) naming what ' +
        'changed and what is next is the one thing worth recording before finishing; otherwise nothing is needed now.',
    );
    expect(ups(dir, typed('s1'))).toBe(''); // EMPTY stdout, not `{}` — plain stdout is injected
    commitLater(dir, 'c');
    expect(ctxOf(ups(dir, typed('s1'))).additionalContext).toContain(LEADIN);
  });

  it('nothing to say → empty stdout', () => {
    const dir = staleRepo();
    git(dir, ['reset', '-q', '--hard', 'HEAD~1']); // drop the later commit → pin not stale
    seedSession(dir, 's1', 1);
    expect(ups(dir, typed('s1'))).toBe('');
  });

  it('B1: uncommitted src work + ≥3 new entries + no handoff → the B1 clause', () => {
    const dir = staleRepo();
    git(dir, ['reset', '-q', '--hard', 'HEAD~1']);
    seedSession(dir, 's1', 1);
    writeFileSync(join(dir, 'src', 'wip.ts'), 'wip\n');
    const line = (t: string) => JSON.stringify({ id: t, type: 'fact', text: t, tags: [] }) + '\n';
    const f = join(dir, '.vfkb', 'entries.jsonl');
    writeFileSync(f, readFileSync(f, 'utf8') + line('e1') + line('e2') + line('e3'));
    expect(ctxOf(ups(dir, typed('s1'))).additionalContext).toContain(
      'this session has recorded 3 entries and no handoff/next entry.',
    );
  });

  it('a harness-generated prompt → empty', () => {
    const dir = staleRepo();
    seedSession(dir, 's1', 1);
    expect(ups(dir, { prompt: '<task-notification>\n<task-id>x</task-id>', session_id: 's1' })).toBe('');
    // …and it consumed nothing: the next typed prompt still gets the line
    expect(ctxOf(ups(dir, typed('s1'))).additionalContext).toContain(LEADIN);
  });

  it('malformed stdin → empty stdout, exit 0', () => {
    const dir = staleRepo();
    expect(ups(dir, 'not json{')).toBe('');
    expect(ups(dir, '[1,2')).toBe('');
  });

  it('no session_id → emits on every call (no state to cache in)', () => {
    const dir = staleRepo();
    for (let i = 0; i < 3; i++) expect(ctxOf(ups(dir, typed())).additionalContext).toContain(LEADIN);
  });

  it('SessionStart source=compact clears the key; source=resume does not', () => {
    const dir = staleRepo();
    seedSession(dir, 's1', 1);
    expect(ups(dir, typed('s1'))).not.toBe('');
    expect(ups(dir, typed('s1'))).toBe('');
    hook(dir, 'session-start', { session_id: 's1', source: 'resume' });
    expect(ups(dir, typed('s1'))).toBe('');
    hook(dir, 'session-start', { session_id: 's1', source: 'compact' });
    expect(ctxOf(ups(dir, typed('s1'))).additionalContext).toContain(LEADIN);
  });
});

describe('hook user-prompt-submit — Q2: never on a persisted session\'s first prompt', () => {
  it('SessionStart → prompt (turn 0) is silent; after one Stop the next prompt carries the line', () => {
    const dir = staleRepo();
    hook(dir, 'session-start', { session_id: 'fresh', source: 'startup' });
    expect(ups(dir, typed('fresh'))).toBe('');
    hook(dir, 'stop', { session_id: 'fresh', stop_hook_active: false });
    expect(ctxOf(ups(dir, typed('fresh'))).additionalContext).toContain(LEADIN);
  });
});

describe('hook user-prompt-submit ↔ stop — one delivery, no B3 on Stop after it (ADR-0084 §2.5)', () => {
  it('same session: the line is emitted, then Stop (turn ≥ 3) shows no B3; another session does', () => {
    const dir = staleRepo();
    // turnCount 2 → the Stop bump reaches turn 3, so 1a cannot be what silences B3.
    seedSession(dir, 'same', 2);
    seedSession(dir, 'other', 2);
    expect(ctxOf(ups(dir, typed('same'))).additionalContext).toContain(LEADIN);
    expect(hook(dir, 'stop', { session_id: 'same', stop_hook_active: false }).trim()).toBe('{}');
    const other = JSON.parse(hook(dir, 'stop', { session_id: 'other', stop_hook_active: false }));
    expect(other.hookSpecificOutput.additionalContext).toContain('vfkb stale-handoff check');
  });
});

describe('hook user-prompt-submit — Q10: read-only against the session record', () => {
  it('the record is byte-identical after the hook emits', () => {
    const dir = staleRepo();
    seedSession(dir, 'ro', 1);
    const rec = join(dir, '.vfkb', '.sessions', 'ro.json');
    const before = readFileSync(rec, 'utf8');
    expect(ups(dir, typed('ro'))).not.toBe('');
    expect(readFileSync(rec, 'utf8')).toBe(before);
  });

  it('8 concurrent hooks on one session id: record untouched, signal parses with the HEAD key', async () => {
    const dir = staleRepo();
    seedSession(dir, 'cc', 1);
    const rec = join(dir, '.vfkb', '.sessions', 'cc.json');
    const before = readFileSync(rec, 'utf8');
    await Promise.all(
      Array.from({ length: 8 }, () =>
        new Promise<void>((res) => {
          const c = spawn(process.execPath, [CLI, 'hook', 'user-prompt-submit'], { cwd: dir, env: env(dir) });
          c.stdin.end(JSON.stringify(typed('cc')));
          c.on('close', () => res());
        }),
      ),
    );
    expect(readFileSync(rec, 'utf8')).toBe(before);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const sig = JSON.parse(readFileSync(join(dir, '.vfkb', '.signals', 'prompt-nudge', 'cc.json'), 'utf8'));
    expect(sig.key.endsWith(`|${head}`)).toBe(true);
  }, 30000);
});

describe('hook user-prompt-submit — Q12: in-process budget', () => {
  it('a wedged git: empty stdout, exit 0, well inside the harness timeout', () => {
    const dir = staleRepo();
    seedSession(dir, 'slow', 1);
    const bin = mkdtempSync(join(tmpdir(), 'vfkb-slowgit-'));
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec sleep 10\n');
    chmodSync(join(bin, 'git'), 0o755);
    const t0 = Date.now();
    const out = ups(dir, typed('slow'), { PATH: `${bin}:${process.env.PATH}` });
    const wall = Date.now() - t0;
    expect(out).toBe('');
    expect(wall).toBeLessThan(3000); // budget 2 s incl. node boot; margin for a loaded CI box
    expect(existsSync(join(dir, '.vfkb', '.signals', 'prompt-nudge', 'slow.json'))).toBe(false);
  }, 20000);
});

describe('hook <unknown> — fails open for a lagging engine (decide step Q7)', () => {
  it('exits 0 with no output', () => {
    const dir = staleRepo();
    expect(hook(dir, 'some-future-hook', { session_id: 'x' })).toBe('');
  });
});

describe('session record writes are tmp + rename (decide step Q10)', () => {
  it('no *.tmp survives a save, and the record parses', () => {
    const dir = staleRepo();
    hook(dir, 'session-start', { session_id: 'rn', source: 'startup' });
    hook(dir, 'stop', { session_id: 'rn', stop_hook_active: false });
    const files = execFileSync('ls', ['-a', join(dir, '.vfkb', '.sessions')], { encoding: 'utf8' });
    expect(files).not.toContain('.tmp');
    expect(JSON.parse(readFileSync(join(dir, '.vfkb', '.sessions', 'rn.json'), 'utf8')).turnCount).toBe(1);
  });

  it('a save replaces the record file (rename), never rewrites it in place', () => {
    // A hard link shares the inode: an in-place write would rewrite the sibling too, while
    // a rename swaps a new inode under the name and leaves the sibling on the old bytes.
    const dir = staleRepo();
    hook(dir, 'session-start', { session_id: 'rn', source: 'startup' });
    const record = join(dir, '.vfkb', '.sessions', 'rn.json');
    const sibling = join(dir, 'rn.link');
    linkSync(record, sibling);
    const before = readFileSync(sibling, 'utf8');
    hook(dir, 'stop', { session_id: 'rn', stop_hook_active: false });
    expect(JSON.parse(readFileSync(record, 'utf8')).turnCount).toBe(1); // the save happened
    expect(readFileSync(sibling, 'utf8')).toBe(before);
  });
});
