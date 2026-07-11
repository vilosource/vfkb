import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, flagInt, UsageError } from '../src/args.js';

// Issue #95 — the silent-flag family. Every instance below was hit for real
// against the live brain; each test is the deterministic guard for one of them
// (structural invariant per ADR-0023 — unit tests, no scenario).

const CLI = resolve(__dirname, '../dist/cli.js');

function run(brain: string, args: string[]): { code: number; out: string; err: string } {
  try {
    const out = execFileSync('node', [CLI, ...args], {
      env: { ...process.env, VFKB_DATA_DIR: brain },
      cwd: brain,
      encoding: 'utf8',
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: err.status ?? 1,
      out: err.stdout?.toString() ?? '',
      err: err.stderr?.toString() ?? '',
    };
  }
}

function entries(brain: string): Array<Record<string, unknown>> {
  const f = join(brain, 'entries.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function fresh(): string {
  return mkdtempSync(join(tmpdir(), 'vfkb-args-'));
}

describe('parseArgs — the strict parser', () => {
  it('rejects unknown flags', () => {
    expect(() => parseArgs('list', ['--bogus'], { tag: 'value' })).toThrow(UsageError);
    expect(() => parseArgs('list', ['--bogus'], { tag: 'value' })).toThrow(/unknown flag --bogus/);
  });

  it('suggests the singular for the observed --tags trap', () => {
    expect(() => parseArgs('add', ['--tags', 'a,b'], { tag: 'value' })).toThrow(/did you mean --tag/);
  });

  it('rejects repeated flags (instance 4: --tag a --tag b kept only the first)', () => {
    expect(() => parseArgs('add', ['--tag', 'a', '--tag', 'b'], { tag: 'value' })).toThrow(
      /repeated flag --tag/,
    );
  });

  it('boolean flags never consume the following word (the cleanText text-loss bug)', () => {
    const p = parseArgs('add', ['--constitutional', 'Adopt', 'X'], { constitutional: 'boolean' });
    expect(p.positionals).toEqual(['Adopt', 'X']);
    expect(p.flags.get('constitutional')).toBe(true);
  });

  it('value flags require a value', () => {
    expect(() => parseArgs('add', ['--tag'], { tag: 'value' })).toThrow(/requires a value/);
    expect(() => parseArgs('add', ['--tag', '--why', 'w'], { tag: 'value', why: 'value' })).toThrow(
      /requires a value/,
    );
  });

  it('optional-value flags do not swallow the next flag (import --from-adr bug)', () => {
    const p = parseArgs('import', ['--from-adr', '--from-markdown', 'f.md'], {
      'from-adr': 'optional-value',
      'from-markdown': 'value',
    });
    expect(p.flags.get('from-adr')).toBe(true);
    expect(p.flags.get('from-markdown')).toBe('f.md');
  });

  it('flagInt rejects non-integers and non-positives', () => {
    const bad = parseArgs('list', ['--limit', 'abc'], { limit: 'value' });
    expect(() => flagInt(bad, 'list', 'limit')).toThrow(/positive integer/);
    const zero = parseArgs('list', ['--limit', '0'], { limit: 'value' });
    expect(() => flagInt(zero, 'list', 'limit')).toThrow(/positive integer/);
    const ok = parseArgs('list', ['--limit', '3'], { limit: 'value' });
    expect(flagInt(ok, 'list', 'limit')).toBe(3);
  });
});

describe('vfkb list — filters exist and unknown flags error (instance 1)', () => {
  it('filters by --tag/--type/--status and truncates to the most recent --limit N', () => {
    const b = fresh();
    expect(run(b, ['add', 'fact', 'first handoff', '--tag', 'handoff', '--role', 'human']).code).toBe(0);
    expect(run(b, ['add', 'gotcha', 'a trap', '--role', 'human']).code).toBe(0);
    expect(run(b, ['add', 'fact', 'second handoff', '--tag', 'handoff,status', '--role', 'human']).code).toBe(0);

    const tagged = run(b, ['list', '--tag', 'handoff']);
    expect(tagged.code).toBe(0);
    expect(tagged.out.trim().split('\n')).toHaveLength(2);

    // ALL-of tag semantics, mirroring read.ts
    const both = run(b, ['list', '--tag', 'handoff,status']);
    expect(both.out.trim().split('\n')).toHaveLength(1);
    expect(both.out).toContain('second handoff');

    const typed = run(b, ['list', '--type', 'gotcha']);
    expect(typed.out.trim().split('\n')).toHaveLength(1);
    expect(typed.out).toContain('a trap');

    const limited = run(b, ['list', '--limit', '1']);
    expect(limited.out.trim().split('\n')).toHaveLength(1);
    expect(limited.out).toContain('second handoff'); // most recent, not oldest
  });

  it('errors on unknown flags instead of dumping everything', () => {
    const b = fresh();
    run(b, ['add', 'fact', 'x', '--role', 'human']);
    const r = run(b, ['list', '--bogus']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/unknown flag --bogus/);
    expect(r.out).toBe(''); // no silent full dump
  });

  it('errors on stray positionals, bad --type, and bad --limit', () => {
    const b = fresh();
    expect(run(b, ['list', 'oops']).code).toBe(1);
    expect(run(b, ['list', '--type', 'nope']).err).toMatch(/unknown entry type 'nope'/);
    expect(run(b, ['list', '--limit', 'abc']).err).toMatch(/positive integer/);
  });
});

describe('vfkb add — strict flags and type validation (instances 2, 3, 4)', () => {
  it('rejects --tags (plural) and writes nothing (instance 2)', () => {
    const b = fresh();
    const r = run(b, ['add', 'fact', 'important', '--tags', 'a,b']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/unknown flag --tags/);
    expect(r.err).toMatch(/did you mean --tag/);
    expect(entries(b)).toHaveLength(0);
  });

  it('rejects `add --help` instead of writing a malformed entry (instance 3)', () => {
    const b = fresh();
    const r = run(b, ['add', '--help']);
    expect(r.code).toBe(1);
    expect(entries(b)).toHaveLength(0);
  });

  it('rejects unknown entry types and empty text', () => {
    const b = fresh();
    expect(run(b, ['add', 'bogus', 'text']).err).toMatch(/unknown entry type 'bogus'/);
    expect(run(b, ['add', 'fact']).err).toMatch(/missing entry text/);
    expect(entries(b)).toHaveLength(0);
  });

  it('rejects a repeated --tag and writes nothing (instance 4)', () => {
    const b = fresh();
    const r = run(b, ['add', 'fact', 't', '--tag', 'a', '--tag', 'b']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/repeated flag --tag/);
    expect(r.err).toMatch(/--tag a,b/); // points at the comma-separated form
    expect(entries(b)).toHaveLength(0);
  });

  it('no longer loses text after a boolean flag (--constitutional ate the next word)', () => {
    const b = fresh();
    const r = run(b, ['add', 'decision', '--constitutional', 'Adopt', 'X', '--role', 'human', '--status', 'accepted']);
    expect(r.code).toBe(0);
    const e = entries(b)[0];
    expect(e.text).toBe('Adopt X');
    expect(e.constitutional).toBe(true);
  });

  it('the honest path still works: known flags, comma tags, why folding', () => {
    const b = fresh();
    const r = run(b, ['add', 'fact', 'hello', 'world', '--role', 'human', '--tag', 'a,b', '--why', 'because']);
    expect(r.code).toBe(0);
    const e = entries(b)[0];
    expect(e.text).toContain('hello world');
    expect(e.text).toContain('Why: because');
    expect(e.tags).toEqual(['a', 'b']);
  });
});

describe('other verbs — the same strictness everywhere', () => {
  it('search no longer eats the word after a boolean flag and validates --limit', () => {
    const b = fresh();
    run(b, ['add', 'fact', 'zebra crossing', '--role', 'human']);
    const r = run(b, ['search', '--verified', 'zebra']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('zebra crossing'); // 'zebra' was the query, not a flag value
    expect(run(b, ['search', 'x', '--limit', 'abc']).err).toMatch(/positive integer/);
    expect(run(b, ['search', 'x', '--bogus']).err).toMatch(/unknown flag --bogus/);
  });

  it('import errors on a missing value instead of swallowing the next flag', () => {
    const b = fresh();
    expect(run(b, ['import', '--from-markdown']).err).toMatch(/requires a value/);
    expect(run(b, ['import', 'stray']).err).toMatch(/unexpected argument/);
  });

  it('supersede requires an id and text; save/doctor/map/resume reject unknown args', () => {
    const b = fresh();
    expect(run(b, ['supersede']).code).toBe(1);
    expect(run(b, ['supersede', 'abc123']).err).toMatch(/missing new text/);
    expect(run(b, ['save', '--oops']).err).toMatch(/unknown flag --oops/);
    expect(run(b, ['doctor', '--check-remote']).err).toMatch(/unknown flag --check-remote/);
    expect(run(b, ['map', 'stray']).err).toMatch(/unexpected argument/);
    expect(run(b, ['resume', 'p1', 'p2']).err).toMatch(/at most one/);
  });

  it('top-level --help prints usage and exits 0', () => {
    const b = fresh();
    const r = run(b, ['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^usage: vfkb /);
  });
});

describe('hook subcommands stay fail-open (deliberate exemption)', () => {
  it('hook session-start tolerates unknown flags and still exits 0', () => {
    const b = fresh();
    const out = execFileSync('node', [CLI, 'hook', 'session-start', '--whatever'], {
      env: { ...process.env, VFKB_DATA_DIR: b },
      cwd: b,
      input: '{}',
      encoding: 'utf8',
    });
    expect(JSON.parse(out)).toHaveProperty('hookSpecificOutput');
  });
});
