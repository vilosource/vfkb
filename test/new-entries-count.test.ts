// ADR-0085 §2 (vfkb#395, decide D9): ONE id-based "new entries since HEAD" count, shared by
// Stop, the UserPromptSubmit line and SessionEnd. The line counter it replaced read an edit,
// retag or curation-archive copy of a committed id as a new entry (and an archived handoff
// copy as a new handoff). Each case is a real git repo; the first and third can fail under
// line counting, which is what makes them discriminate.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newBrainEntriesSinceHead } from '../src/stop-reminder.js';
import { brainCommitOutcome, realGit } from '../src/session-end.js';

const git = (dir: string, args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
const line = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, type: 'fact', text: id, tags: [], updated: '2030-01-01T00:00:00.000Z', ...extra }) + '\n';

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-count-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  mkdirSync(join(dir, '.vfkb'));
  writeFileSync(join(dir, '.vfkb', 'entries.jsonl'), line('known0000001') + line('known0000002', { tags: ['handoff'] }));
  git(dir, ['add', '.']);
  git(dir, ['commit', '-qm', 'seed']);
  return dir;
}
const brain = (dir: string) => join(dir, '.vfkb');
const f = (dir: string) => join(dir, '.vfkb', 'entries.jsonl');

describe('newBrainEntriesSinceHead — ids, not lines (ADR-0085 §2)', () => {
  it('a copy line of a committed id (retag / archive) is not new', () => {
    const dir = repo();
    appendFileSync(f(dir), line('known0000002', { tags: ['handoff', 'archived'], updated: '2030-02-01T00:00:00.000Z' }));
    expect(newBrainEntriesSinceHead(brain(dir), dir)).toHaveLength(0);
  });
  it('one fresh id is one entry, even written twice (newest line wins)', () => {
    const dir = repo();
    appendFileSync(f(dir), line('fresh0000001') + line('fresh0000001', { tags: ['handoff'], updated: '2030-03-01T00:00:00.000Z' }));
    const fresh = newBrainEntriesSinceHead(brain(dir), dir);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].tags).toEqual(['handoff']);
  });
  it('a fresh id then its tombstone is not new', () => {
    const dir = repo();
    appendFileSync(f(dir), line('fresh0000001') + line('fresh0000001', { deleted: true, updated: '2030-03-01T00:00:00.000Z' }));
    expect(newBrainEntriesSinceHead(brain(dir), dir)).toHaveLength(0);
  });
  it('from a subdirectory cwd the count is the same (HEAD:./ spelling)', () => {
    const dir = repo();
    mkdirSync(join(dir, 'sub'));
    appendFileSync(f(dir), line('fresh0000001'));
    expect(newBrainEntriesSinceHead(brain(dir), join(dir, 'sub'))).toHaveLength(1);
  });
});

describe('brainCommitOutcome — SessionEnd\'s preconditions as one predicate (ADR-0085 §1)', () => {
  it('not-a-repo, brain-clean, on-default-branch, detached-head, topic', () => {
    const none = mkdtempSync(join(tmpdir(), 'vfkb-oc-'));
    mkdirSync(join(none, '.vfkb'));
    writeFileSync(join(none, '.vfkb', 'entries.jsonl'), line('x00000000001'));
    expect(brainCommitOutcome(realGit, none, '.vfkb').outcome).toBe('not-a-repo');

    const dir = repo();
    expect(brainCommitOutcome(realGit, dir, '.vfkb').outcome).toBe('brain-clean');
    appendFileSync(f(dir), line('fresh0000001'));
    const onMain = brainCommitOutcome(realGit, dir, '.vfkb');
    expect(onMain).toMatchObject({ outcome: 'on-default-branch', branch: 'main' });
    expect(onMain.fresh).toHaveLength(1);
    git(dir, ['checkout', '-q', '--detach']);
    expect(brainCommitOutcome(realGit, dir, '.vfkb')).toMatchObject({ outcome: 'detached-head', branch: null });
    git(dir, ['checkout', '-qb', 'feat/z']);
    expect(brainCommitOutcome(realGit, dir, '.vfkb')).toMatchObject({ outcome: 'topic', branch: 'feat/z' });
  });
});
