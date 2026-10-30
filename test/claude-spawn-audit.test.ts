// The Brake for vfkb#422 (ADR-0070 §2: a deterministic backstop, not prose): no file
// under scenarios/ may spawn `claude` itself. Every host-run claude child goes through
// scenarios/lib/claude-auth.mjs (claudeSync / claudeVersion), which gives it an env
// token and a no-op `security` shim, so it can never pop a Keychain dialog.
//
// What the scan SEES: the literal command 'claude' as the first argument of a spawn
// call (sh, run, exec, execSync, execFile, execFileSync, spawn, spawnSync), as the
// first element of an argv tuple (['claude', [...]]), or at the head of a shell
// command string (execSync('claude -p …')). What it CANNOT see: a command name built
// at runtime (const bin = 'cl' + 'aude'; spawn(bin, …)). The claim is bounded to the
// literal forms; review owns the rest.
//
// Not a spawn, so not flagged: 'claude' as a harness label (HARNESS === 'claude') and
// as an argument after the image name in a `docker run` argv, which runs inside a
// Linux container with no Keychain (l4-purpose.mjs docker arm; tracked separately).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(__dirname, '..');
const SCEN = join(REPO, 'scenarios');
const SEAM = 'scenarios/lib/claude-auth.mjs';
// Exempt only the blob-pinned vendored file, not the whole vendor/ dir (round-2 F4).
const VENDOR = 'scenarios/lib/vendor/plugin-auth.mjs';

// The routed call sites this PR migrated. A floor, not an exact count: a new scenario
// adds to it; a scan that silently finds nothing (bad glob, renamed helper) fails.
const MIN_ROUTED_SITES = 19;

const SPAWN_FNS = 'sh|run|exec|execSync|execFile|execFileSync|spawn|spawnSync';
const RAW = [
  new RegExp(`\\b(?:${SPAWN_FNS})\\s*\\(\\s*(['"\`])claude\\1`, 'g'), // sh('claude', …)
  new RegExp(`\\b(?:${SPAWN_FNS})\\s*\\(\\s*(['"\`])claude\\s[^'"\`]*\\1`, 'g'), // execSync('claude -p …')
  /\[\s*(['"`])claude\1\s*,\s*\[/g, // ['claude', ['--version']] argv tuples
];

// Comments are not spawns, but a comment stripper that is not string-aware can hide
// code (a '/*' inside a string such as 'records/*.json' would swallow everything up to
// the next '*/'). So drop only WHOLE lines that are unambiguously comments: a line that
// starts with '//', or starts with '*' or '/*' and has no code after a closing '*/'.
// Inline and trailing comments are kept and scanned (conservative: they can only add
// a false positive, never hide a spawn).
export function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      if (t.startsWith('//')) return false;
      if (t.startsWith('*') || t.startsWith('/*')) {
        const close = t.indexOf('*/');
        return close >= 0 && t.slice(close + 2).trim() !== '';
      }
      return true;
    })
    .join('\n');
}

export function rawClaudeSpawns(src: string): number {
  const code = stripComments(src);
  return RAW.reduce((n, re) => n + (code.match(re)?.length ?? 0), 0);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'records' || name === 'node_modules') continue;
      out.push(...walk(p));
    } else if (/\.(mjs|js|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SCEN).map((p) => ({ rel: relative(REPO, p), src: readFileSync(p, 'utf8') }));

describe('the scanner itself (can it fail?)', () => {
  it('flags every raw spawn shape', () => {
    expect(rawClaudeSpawns(`sh('claude', ['-p', q], { cwd })`)).toBe(1);
    expect(rawClaudeSpawns(`execFileSync(\n      'claude',\n      ['--version'])`)).toBe(1);
    expect(rawClaudeSpawns(`spawnSync("claude", args)`)).toBe(1);
    expect(rawClaudeSpawns('spawn(`claude`, args)')).toBe(1);
    expect(rawClaudeSpawns(`execSync('claude -p hello')`)).toBe(1);
    expect(rawClaudeSpawns(`for (const p of [['claude', ['--version']], ['gh', ['auth']]])`)).toBe(1);
  });
  it('does not flag labels, the seam, or a docker argv', () => {
    expect(rawClaudeSpawns(`if (harness === 'claude') {}`)).toBe(0);
    expect(rawClaudeSpawns(`const H = process.env.H || 'claude';`)).toBe(0);
    expect(rawClaudeSpawns(`claudeSync(['-p', q], { cwd })`)).toBe(0);
    expect(rawClaudeSpawns(`dargs.push('-v', x, CLAUDE_IMAGE, 'claude', ...args)`)).toBe(0);
    expect(rawClaudeSpawns(`// formerly: sh('claude', args)\nconst x = 1;`)).toBe(0);
    expect(rawClaudeSpawns(`/* was execFileSync('claude', a) */`)).toBe(0);
  });
  it('a /* inside a string cannot hide a later spawn (round-2 F1)', () => {
    const src = `const GLOB = join(REPO, 'scenarios/records/*.json');\nfunction arm(q) { return sh('claude', ['-p', q]); }\n/** doc */`;
    expect(rawClaudeSpawns(src)).toBe(1);
    expect(rawClaudeSpawns(`/* note */ sh('claude', ['-p', q]);`)).toBe(1);
  });
  it('a trailing comment does not hide a real spawn on the same line', () => {
    expect(rawClaudeSpawns(`sh('claude', ['-p', 'http://x']); // run it`)).toBe(1);
  });
});

describe('host claude spawns go through scenarios/lib/claude-auth.mjs', () => {
  it('scans a real tree (non-vacuous)', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.rel === SEAM)).toBe(true);
  });

  it('no file outside the seam spawns `claude` itself', () => {
    const offenders = files
      .filter((f) => f.rel !== SEAM && f.rel !== VENDOR)
      .map((f) => ({ file: f.rel, raw: rawClaudeSpawns(f.src) }))
      .filter((o) => o.raw > 0);
    expect(offenders).toEqual([]);
  });

  it('the seam is where the one raw spawn lives', () => {
    expect(rawClaudeSpawns(files.find((f) => f.rel === SEAM)!.src)).toBe(1);
  });

  // Only a non-vacuity floor. Whether each spawn runs the auth preconditions is not a
  // source-text question: claudeEnv() runs them itself before the first spawn
  // (test/claude-auth.test.ts covers that behaviourally).
  it(`at least ${MIN_ROUTED_SITES} routed call sites`, () => {
    let routed = 0;
    for (const f of files) {
      if (f.rel === SEAM || f.rel === VENDOR) continue;
      routed += (stripComments(f.src).match(/\bclaude(?:Sync|Version)\s*\(/g) ?? []).length;
    }
    expect(routed).toBeGreaterThanOrEqual(MIN_ROUTED_SITES);
  });
});
