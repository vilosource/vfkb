import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { basename, join, sep } from 'node:path';
import { defaultProject } from '../src/storage.js';

// defaultProject(): the engine-wide project-name derivation (Track 9 Q0 follow-up).
// Generic wiring (the Claude Code plugin, ADR-0045) points VFKB_DATA_DIR at a brain
// but cannot know the project's name — the engine derives it instead of 'spike'.

const ENV_KEYS = ['VFKB_PROJECT', 'VFKB_DATA_DIR', 'VFKB_DIR', 'CLAUDE_PROJECT_DIR'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('defaultProject derivation', () => {
  it('VFKB_PROJECT wins over everything', () => {
    process.env.VFKB_PROJECT = 'explicit';
    process.env.VFKB_DATA_DIR = join(sep, 'x', 'myrepo', '.vfkb');
    process.env.CLAUDE_PROJECT_DIR = join(sep, 'x', 'other');
    expect(defaultProject()).toBe('explicit');
  });

  it('a dot-named brain dir names its parent (the plugin wiring: <repo>/.vfkb → repo)', () => {
    process.env.VFKB_DATA_DIR = join(sep, 'x', 'myrepo', '.vfkb');
    expect(defaultProject()).toBe('myrepo');
  });

  it('a non-dot brain dir names itself', () => {
    process.env.VFKB_DATA_DIR = join(sep, 'x', 'brains', 'foo');
    expect(defaultProject()).toBe('foo');
  });

  it('honors the deprecated VFKB_DIR alias (ADR-0032) the same way', () => {
    process.env.VFKB_DIR = join(sep, 'x', 'legacy', '.vfkb');
    expect(defaultProject()).toBe('legacy');
  });

  it('resolves a relative brain dir against the cwd (VFKB_DATA_DIR=.vfkb → cwd basename)', () => {
    process.env.VFKB_DATA_DIR = '.vfkb';
    expect(defaultProject()).toBe(basename(process.cwd()));
  });

  it('falls back to $CLAUDE_PROJECT_DIR basename when no brain dir is set', () => {
    process.env.CLAUDE_PROJECT_DIR = join(sep, 'x', 'somerepo');
    expect(defaultProject()).toBe('somerepo');
  });

  it('falls back to the cwd basename when nothing is set (default ~/.vfkb brain)', () => {
    expect(defaultProject()).toBe(basename(process.cwd()));
  });

  it('strips characters that would deform the injected pseudo-XML header', () => {
    process.env.VFKB_DATA_DIR = join(sep, 'x', 'evil" injected="1 <b>&', '.vfkb');
    expect(defaultProject()).toBe('evil injected=1 b');
  });

  it('falls back to spike when stripping empties the name', () => {
    process.env.VFKB_PROJECT = '"<>&';
    expect(defaultProject()).toBe('spike');
  });
});
