import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// V2-3 (ADR-0041 ← RFC-016): `.vfkb/entries.jsonl merge=union` — two branches that
// both appended to the log's tail from a common ancestor merge CLEANLY with both
// lines present, instead of the guaranteed conflict verified in RFC-016. This test
// re-runs the RFC's own empirical reproduction in a scratch repo, both arms:
// with the attribute (clean union) and without (the must-fail arm: still conflicts).
//
// Scope honesty: this proves LOCAL `git merge` behavior only. Whether GitHub's
// server-side PR merge honors the attribute is a separate empirical check recorded
// in V2-ROADMAP (part of the ADR-0041 Done bar, not provable from a unit test).

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
}

// Build the RFC-016 reproduction: base with 3 lines; branch A appends line A;
// branch B (from the same base) appends line B; merge both into `integrate`.
function scenario(withAttribute: boolean): { cwd: string; merge2: () => string } {
  const cwd = mkdtempSync(join(tmpdir(), 'vfkb-union-'));
  git(cwd, 'init', '-q', '-b', 'main');
  mkdirSync(join(cwd, '.vfkb'), { recursive: true });
  if (withAttribute) {
    writeFileSync(join(cwd, '.gitattributes'), '.vfkb/entries.jsonl merge=union\n');
    git(cwd, 'add', '.gitattributes');
  }
  const f = join(cwd, '.vfkb', 'entries.jsonl');
  writeFileSync(f, '{"id":"e1"}\n{"id":"e2"}\n{"id":"e3"}\n');
  git(cwd, 'add', '.vfkb/entries.jsonl');
  git(cwd, 'commit', '-q', '-m', 'base');

  git(cwd, 'checkout', '-q', '-b', 'a');
  writeFileSync(f, readFileSync(f, 'utf8') + '{"id":"a1"}\n');
  git(cwd, 'commit', '-q', '-am', 'A appends');

  git(cwd, 'checkout', '-q', 'main');
  git(cwd, 'checkout', '-q', '-b', 'b');
  writeFileSync(f, readFileSync(f, 'utf8') + '{"id":"b1"}\n');
  git(cwd, 'commit', '-q', '-am', 'B appends');

  git(cwd, 'checkout', '-q', 'main');
  git(cwd, 'checkout', '-q', '-b', 'integrate');
  git(cwd, 'merge', '-q', '--no-edit', 'a'); // first merge is always clean
  return { cwd, merge2: () => git(cwd, 'merge', '--no-edit', 'b') };
}

describe('ADR-0041 — entries.jsonl merges by union', () => {
  it('WITH the attribute: the second branch merges cleanly and BOTH entries survive', () => {
    const { cwd, merge2 } = scenario(true);
    merge2(); // must not throw
    const merged = readFileSync(join(cwd, '.vfkb', 'entries.jsonl'), 'utf8');
    expect(merged).toContain('"a1"');
    expect(merged).toContain('"b1"');
    expect(merged).not.toContain('<<<<<<<');
    // every line stays valid JSON (union may reorder, never mangles whole lines here)
    for (const line of merged.trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('MUST-FAIL arm: WITHOUT the attribute the same merge still conflicts (RFC-016 reproduction)', () => {
    const { cwd, merge2 } = scenario(false);
    expect(merge2).toThrow(); // non-zero exit from the conflicting merge
    // and it is genuinely a content conflict on the brain file
    const status = git(cwd, 'status', '--porcelain');
    expect(status).toMatch(/^UU .vfkb\/entries\.jsonl/m);
  });

  it('the REAL repo ships the attribute for .vfkb/entries.jsonl', () => {
    const attrs = readFileSync(join(__dirname, '..', '.gitattributes'), 'utf8');
    expect(attrs).toMatch(/^\.vfkb\/entries\.jsonl\s+merge=union/m);
  });
});
