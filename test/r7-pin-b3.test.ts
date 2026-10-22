import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handoffIsStale, pinnedHandoff } from '../src/stop-reminder.js';
import { latestHandoff } from '../src/engine.js';

// ADR-0082 §2: one selector. B3 (stop-reminder) must MATERIALIZE the brain and apply the
// same rule as the rendered pin (newest-created injectable handoff/next fact), and its
// staleness anchor is the pin's `created`.
type Raw = { id: string; type?: string; tags?: string[]; zone?: string; created: string; updated?: string; status?: string };
const line = (r: Raw) =>
  JSON.stringify({
    id: r.id,
    type: r.type ?? 'fact',
    text: `text of ${r.id}`,
    tags: r.tags ?? ['handoff'],
    zone: r.zone ?? 'established',
    author: { role: 'human' },
    provenance: { status: 'verified', date: r.created },
    validity: { valid_from: r.created },
    status: r.status,
    created: r.created,
    updated: r.updated ?? r.created,
  }) + '\n';

function brainOf(...rs: Raw[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-r7b3-'));
  for (const r of rs) appendFileSync(join(dir, 'entries.jsonl'), line(r));
  return dir;
}
function renderedPinId(brain: string): string | undefined {
  const prev = process.env.VFKB_DIR;
  process.env.VFKB_DIR = brain;
  delete process.env.VFKB_DATA_DIR;
  try {
    return latestHandoff()?.id;
  } finally {
    process.env.VFKB_DIR = prev;
  }
}

describe('§2 the rendered pin and B3 select the same entry', () => {
  const fixtures: Record<string, Raw[]> = {
    'zone edit of an old handoff (newer updated line)': [
      { id: 'old', created: '2026-01-01T00:00:00.000Z' },
      { id: 'new', created: '2026-02-01T00:00:00.000Z' },
      { id: 'old', zone: 'incoming', created: '2026-01-01T00:00:00.000Z', updated: '2026-03-01T00:00:00.000Z' },
    ],
    'archived line: the pre-archive line of the newest handoff must not pin': [
      { id: 'a', created: '2026-01-01T00:00:00.000Z' },
      { id: 'b', created: '2026-02-01T00:00:00.000Z' },
      { id: 'b', zone: 'archive', created: '2026-02-01T00:00:00.000Z', updated: '2026-02-02T00:00:00.000Z' },
    ],
    'newer decision and link tagged handoff': [
      { id: 'f', created: '2026-01-01T00:00:00.000Z' },
      { id: 'd', type: 'decision', status: 'accepted', created: '2026-02-01T00:00:00.000Z' },
      { id: 'l', type: 'link', tags: ['next'], created: '2026-03-01T00:00:00.000Z' },
    ],
    'topical non-handoff tag ignored': [
      { id: 'h', created: '2026-01-01T00:00:00.000Z' },
      { id: 'x', tags: ['status'], created: '2026-05-01T00:00:00.000Z' },
    ],
  };
  const expected: Record<string, string> = {
    'zone edit of an old handoff (newer updated line)': 'new',
    'archived line: the pre-archive line of the newest handoff must not pin': 'a',
    'newer decision and link tagged handoff': 'f',
    'topical non-handoff tag ignored': 'h',
  };
  for (const [name, rs] of Object.entries(fixtures)) {
    it(name, () => {
      const brain = brainOf(...rs);
      const rendered = renderedPinId(brain);
      expect(rendered).toBe(expected[name]);
      expect(pinnedHandoff(brain)?.id).toBe(rendered);
    });
  }
});

describe('§2 B3 staleness input is the pin created (RFC-043 case 3 flip, owned here)', () => {
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), 'vfkb-r7stale-'));
    const brain = join(dir, '.vfkb');
    mkdirSync(brain);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    const commit = (files: Record<string, string>, when: string) => {
      for (const [rel, content] of Object.entries(files)) {
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        writeFileSync(join(dir, rel), content);
      }
      execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-qm', 'c'], {
        cwd: dir,
        stdio: 'ignore',
        env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
      });
    };
    return { dir, brain, commit };
  }

  it('an old fact retagged into the pin after code landed reads STALE (it was quiet under updated)', () => {
    const { dir, commit } = repo();
    const created = '2025-01-01T00:00:00.000Z';
    commit({ '.vfkb/entries.jsonl': line({ id: 'f', tags: ['note'], created }) }, created);
    commit({ 'src/a.ts': 'x' }, '2025-02-01T00:00:00Z'); // code lands after the fact was written
    // retag it into the pin later: the newest line carries the handoff tag and a new `updated`
    const retagged = '2025-03-01T00:00:00.000Z';
    commit(
      {
        '.vfkb/entries.jsonl':
          line({ id: 'f', tags: ['note'], created }) + line({ id: 'f', created, updated: retagged }),
      },
      retagged,
    );
    expect(handoffIsStale(dir, join(dir, '.vfkb'))).toBe(true);
  });

  it('a zone edit of the pin after code landed does not make it look fresh', () => {
    const { dir, commit } = repo();
    const created = '2025-01-01T00:00:00.000Z';
    commit({ '.vfkb/entries.jsonl': line({ id: 'p', created }) }, created);
    commit({ 'src/a.ts': 'x' }, '2025-02-01T00:00:00Z');
    const edited = '2025-03-01T00:00:00.000Z';
    commit(
      {
        '.vfkb/entries.jsonl':
          line({ id: 'p', created }) + line({ id: 'p', zone: 'incoming', created, updated: edited }),
      },
      edited,
    );
    expect(handoffIsStale(dir, join(dir, '.vfkb'))).toBe(true);
  });
});
