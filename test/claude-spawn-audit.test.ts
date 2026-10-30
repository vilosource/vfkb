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
// Whitespace OR comments may sit between '(' / '[' and 'claude' — a comment there must
// not hide the spawn (review round 3 F1).
const GAP = String.raw`(?:\s|//[^\n]*\n|/\*[\s\S]*?\*/)*`;
const RAW = [
  new RegExp(`\\b(?:${SPAWN_FNS})\\s*\\(${GAP}(['"\`])claude\\1`, 'g'), // sh('claude', …)
  new RegExp(`\\b(?:${SPAWN_FNS})\\s*\\(${GAP}(['"\`])claude\\s[^'"\`]*\\1`, 'g'), // execSync('claude -p …')
  new RegExp(`\\[${GAP}(['"\`])claude\\1\\s*,\\s*\\[`, 'g'), // ['claude', ['--version']] argv tuples
  // vfkb#395: claude carried inside a SHELL STRING handed to a non-claude spawn
  // (sh -c, screen/tmux/script wrappers). Any quoted string that runs `exec claude`:
  /(['"`])[^'"`\n]*\bexec\s+claude\b[^'"`\n]*\1/g,
  // …or a shell -c whose command starts with claude: 'sh', '-c', 'claude …' / "sh -c 'claude …'"
  /\b(?:sh|bash|zsh)['"`]?\s*,\s*['"`]-c['"`]\s*,\s*['"`]\s*claude\b/g,
  /\b(?:sh|bash|zsh)\s+-c\s+\\?['"]?\s*claude\b/g,
  // …or claude as a bare argv element after a terminal wrapper: spawn('screen', [..., 'claude', ...])
  /\b(?:screen|tmux|script)['"`]\s*,\s*\[[^\]]*['"`]claude['"`]/g,
];

// Comments are scanned like code, on purpose (#424 review rounds 1-3). Two comment
// strippers in a row each opened a way to HIDE a spawn: a '/*' inside a string, then a
// comment between '(' and 'claude', and lines starting with '*'. A comment that quotes
// a raw spawn is a false positive, which is cheap: reword the comment. A hidden spawn
// is a Keychain dialog on the operator's screen. The scanner takes the false positive.
export function rawClaudeSpawns(src: string): number {
  return RAW.reduce((n, re) => n + (src.match(re)?.length ?? 0), 0);
}

// Only the blob-pinned vendored file is exempt, never the whole vendor/ dir.
export const exempt = (rel: string) => rel === SEAM || rel === VENDOR;

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
  it('flags claude inside a shell string or a terminal wrapper (vfkb#395)', () => {
    // the #408 probe's launch, verbatim
    expect(rawClaudeSpawns('const launch = `stty cols 200 rows 50; exec claude --model ${MODEL} --strict-mcp-config`;')).toBe(1);
    expect(rawClaudeSpawns(`spawnSync('screen', ['-U', '-dmS', 'p', 'sh', '-c', 'claude -p hi'])`)).toBeGreaterThanOrEqual(1);
    expect(rawClaudeSpawns(`execSync('sh -c "claude -p hi"')`)).toBe(1);
    expect(rawClaudeSpawns(`spawn('tmux', ['new-session', '-d', 'claude'])`)).toBe(1);
    expect(rawClaudeSpawns(`spawn('script', ['-q', '/dev/null', 'claude', '-p', 'x'])`)).toBe(1);
  });
  it('does not flag the routed TUI call or driver commands that never name claude', () => {
    expect(rawClaudeSpawns(`const h = claudeInScreen({ cwd, args: ['--model', MODEL], screenDir, screenrc, name });`)).toBe(0);
    expect(rawClaudeSpawns(`h.stuff('Reply with exactly one word: pineapple'); h.hardcopy(file);`)).toBe(0);
    expect(rawClaudeSpawns(`spawnSync('screen', ['-S', name, '-X', 'quit'])`)).toBe(0);
  });
  it('does not flag labels, the seam, or a docker argv', () => {
    expect(rawClaudeSpawns(`if (harness === 'claude') {}`)).toBe(0);
    expect(rawClaudeSpawns(`const H = process.env.H || 'claude';`)).toBe(0);
    expect(rawClaudeSpawns(`claudeSync(['-p', q], { cwd })`)).toBe(0);
    expect(rawClaudeSpawns(`dargs.push('-v', x, CLAUDE_IMAGE, 'claude', ...args)`)).toBe(0);
  });
  it('no comment shape hides a spawn (review rounds 2-3)', () => {
    expect(rawClaudeSpawns(`execFileSync( // run the model\n  'claude', ['-p', q])`)).toBe(1);
    expect(rawClaudeSpawns(`execFileSync(/* bin */ 'claude', ['-p', q])`)).toBe(1);
    expect(rawClaudeSpawns(`class A {\n  *arms() { yield sh('claude', ['-p']); }\n}`)).toBe(1);
    // The accepted cost: a comment quoting a raw spawn is flagged too.
    expect(rawClaudeSpawns(`// formerly: sh('claude', args)`)).toBe(1);
  });
  it('only the pinned vendored file is exempt (review round 3 F2)', () => {
    expect(exempt('scenarios/lib/vendor/plugin-auth.mjs')).toBe(true);
    expect(exempt('scenarios/lib/claude-auth.mjs')).toBe(true);
    expect(exempt('scenarios/lib/vendor/evil.mjs')).toBe(false);
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
      .filter((f) => !exempt(f.rel))
      .map((f) => ({ file: f.rel, raw: rawClaudeSpawns(f.src) }))
      .filter((o) => o.raw > 0);
    expect(offenders).toEqual([]);
  });

  it('the seam is where the raw spawns live: claudeSync, and the claudeInScreen launch', () => {
    expect(rawClaudeSpawns(files.find((f) => f.rel === SEAM)!.src)).toBe(2);
  });

  // Only a non-vacuity floor. Whether each spawn runs the auth preconditions is not a
  // source-text question: claudeEnv() runs them itself before the first spawn
  // (test/claude-auth.test.ts covers that behaviourally).
  it(`at least ${MIN_ROUTED_SITES} routed call sites`, () => {
    let routed = 0;
    for (const f of files) {
      if (exempt(f.rel)) continue;
      routed += (f.src.match(/\bclaude(?:Sync|Version|InScreen)\s*\(/g) ?? []).length;
    }
    expect(routed).toBeGreaterThanOrEqual(MIN_ROUTED_SITES);
  });
});
