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
const VENDOR = 'scenarios/lib/vendor/';

// The routed call sites this PR migrated. A floor, not an exact count: a new scenario
// adds to it; a scan that silently finds nothing (bad glob, renamed helper) fails.
const MIN_ROUTED_SITES = 20;

const SPAWN_FNS = 'sh|run|exec|execSync|execFile|execFileSync|spawn|spawnSync';
const RAW = [
  new RegExp(`\\b(?:${SPAWN_FNS})\\s*\\(\\s*(['"\`])claude\\1`, 'g'), // sh('claude', …)
  new RegExp(`\\b(?:${SPAWN_FNS})\\s*\\(\\s*(['"\`])claude\\s[^'"\`]*\\1`, 'g'), // execSync('claude -p …')
  /\[\s*(['"`])claude\1\s*,\s*\[/g, // ['claude', ['--version']] argv tuples
];

export function rawClaudeSpawns(src: string): number {
  return RAW.reduce((n, re) => n + (src.match(re)?.length ?? 0), 0);
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
  });
});

describe('host claude spawns go through scenarios/lib/claude-auth.mjs', () => {
  it('scans a real tree (non-vacuous)', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.rel === SEAM)).toBe(true);
  });

  it('no file outside the seam spawns `claude` itself', () => {
    const offenders = files
      .filter((f) => f.rel !== SEAM && !f.rel.startsWith(VENDOR))
      .map((f) => ({ file: f.rel, raw: rawClaudeSpawns(f.src) }))
      .filter((o) => o.raw > 0);
    expect(offenders).toEqual([]);
  });

  it('the seam is where the one raw spawn lives', () => {
    expect(rawClaudeSpawns(files.find((f) => f.rel === SEAM)!.src)).toBe(1);
  });

  it(`at least ${MIN_ROUTED_SITES} routed call sites, and every routing file checks auth first`, () => {
    let routed = 0;
    const missingPrecondition: string[] = [];
    for (const f of files) {
      if (f.rel === SEAM || f.rel.startsWith(VENDOR)) continue;
      const n = (f.src.match(/\bclaude(?:Sync|Version)\s*\(/g) ?? []).length;
      routed += n;
      if (n > 0) {
        if (!/from '\.{1,2}\/(?:\.\.\/)?(?:scenarios\/)?lib\/claude-auth\.mjs'/.test(f.src)) missingPrecondition.push(`${f.rel}: no import`);
        if (!/\bassertClaudeAuthReady\s*\(/.test(f.src)) missingPrecondition.push(`${f.rel}: no assertClaudeAuthReady()`);
      }
    }
    expect(missingPrecondition).toEqual([]);
    expect(routed).toBeGreaterThanOrEqual(MIN_ROUTED_SITES);
  });
});
