// RFC-024 §1 / ADR-0051 DoD 1+2 — the inner gate for `vfkb doctor`'s staleness
// detector. Structural invariants only (ADR-0029 §5); the capability-level proof
// is the agent-driven scenarios/doctor-staleness.mjs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor, type DoctorReport } from '../src/doctor.js';
import type { GitRunner } from '../src/session-end.js';

let root: string;
const LOCAL = 'a'.repeat(40);
const REMOTE = 'b'.repeat(40);

/** A clone whose HEAD points at `sha` through a loose ref. */
function makeClone(dir: string, sha: string, packed = false) {
  mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  if (packed) writeFileSync(join(dir, '.git', 'packed-refs'), `# pack-refs with: peeled\n${sha} refs/heads/main\n`);
  else writeFileSync(join(dir, '.git', 'refs', 'heads', 'main'), `${sha}\n`);
  return dir;
}

function setup(opts: { source?: any; installLocation?: string } = {}) {
  const proj = join(root, 'project');
  const cfg = join(root, 'cfg');
  mkdirSync(join(proj, '.claude'), { recursive: true });
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'vfkb@vfkb': true } }));
  writeFileSync(
    join(cfg, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'vfkb@vfkb': [{ scope: 'project', projectPath: proj, version: '0.3.0' }] } }),
  );
  writeFileSync(
    join(cfg, 'plugins', 'known_marketplaces.json'),
    JSON.stringify({
      vfkb: {
        source: opts.source ?? { source: 'github', repo: 'vilosource/vfkb-claude-plugin' },
        installLocation: opts.installLocation,
      },
    }),
  );
  return { proj, cfg };
}

const currency = (r: DoctorReport) => r.checks.find((c) => c.name === 'plugin currency');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vfkb-doctor-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('RFC-024 §1 — doctor honors CLAUDE_CONFIG_DIR (DoD 1)', () => {
  it('finds the plugin registry outside $HOME', () => {
    const { proj, cfg } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL) });
    // $HOME points somewhere with NO registry. Only CLAUDE_CONFIG_DIR can find it.
    const report = runDoctor({
      root: proj,
      brainDir: join(proj, '.vfkb'),
      env: { HOME: join(root, 'elsewhere'), CLAUDE_CONFIG_DIR: cfg },
      git: () => `${LOCAL}\tHEAD\n`,
    });
    const plugin = report.checks.find((c) => c.name === 'plugin');
    expect(plugin?.status).toBe('ok');
    expect(plugin?.detail).toContain('version 0.3.0');
  });

  // Not a RED-detector (it passes before and after the fix). It pins the
  // fallback: no CLAUDE_CONFIG_DIR and a registry-less $HOME must degrade to a
  // soft warn, never a crash or a foreign install.
  it('with no CLAUDE_CONFIG_DIR and a registry-less $HOME, the install is reported unverified', () => {
    const { proj } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL) });
    const report = runDoctor({
      root: proj,
      brainDir: join(proj, '.vfkb'),
      env: { HOME: join(root, 'elsewhere') },
      git: () => `${LOCAL}\tHEAD\n`,
    });
    expect(report.checks.find((c) => c.name === 'plugin')?.status).toBe('warn');
  });
});

// The report as a whole must not mislead, even when every line is true. The
// install line used to say "(informational — currency not compared)" right beside
// the currency check that compared it — and an agent reading the report inferred
// staleness from the bare version plus that hedge, leaking the doctor-staleness
// L4's only contrast trial.
describe('RFC-024 §1 — the install line does not contradict the currency line', () => {
  const pluginLine = (r: DoctorReport) => r.checks.find((c) => c.name === 'plugin')!;

  it('currency compared (ok) → the install line does not claim it was not', () => {
    const { proj, cfg } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL) });
    const report = runDoctor({ root: proj, brainDir: join(proj, '.vfkb'), env: { CLAUDE_CONFIG_DIR: cfg }, git: () => `${LOCAL}\tHEAD\n` });
    expect(currency(report)!.status).toBe('ok');
    expect(pluginLine(report).detail).not.toMatch(/currency not compared/);
    expect(pluginLine(report).detail).toContain('plugin currency');
  });

  it('currency compared (stale) → the install line does not claim it was not', () => {
    const { proj, cfg } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL) });
    const report = runDoctor({ root: proj, brainDir: join(proj, '.vfkb'), env: { CLAUDE_CONFIG_DIR: cfg }, git: () => `${REMOTE}\tHEAD\n` });
    expect(currency(report)!.status).toBe('warn');
    expect(pluginLine(report).detail).not.toMatch(/currency not compared/);
  });

  it('currency genuinely skipped → the install line says so, and that is honest', () => {
    const { proj, cfg } = setup({ source: { source: 'directory' }, installLocation: join(root, 'x') });
    const report = runDoctor({ root: proj, brainDir: join(proj, '.vfkb'), env: { CLAUDE_CONFIG_DIR: cfg }, git: () => '' });
    expect(currency(report)!.status).toBe('skip');
    expect(pluginLine(report).detail).toContain('(currency not compared)');
  });

  it('the currency line still comes after the install line', () => {
    const { proj, cfg } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL) });
    const report = runDoctor({ root: proj, brainDir: join(proj, '.vfkb'), env: { CLAUDE_CONFIG_DIR: cfg }, git: () => `${LOCAL}\tHEAD\n` });
    const names = report.checks.map((c) => c.name);
    expect(names.indexOf('plugin')).toBeLessThan(names.indexOf('plugin currency'));
  });
});

describe('RFC-024 §1 — staleness detection (DoD 2)', () => {
  it('clone behind the remote → warn, naming both remedy commands', () => {
    const { proj, cfg } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL) });
    const report = runDoctor({
      root: proj,
      brainDir: join(proj, '.vfkb'),
      env: { CLAUDE_CONFIG_DIR: cfg },
      git: () => `${REMOTE}\tHEAD\n`,
    });
    const c = currency(report)!;
    expect(c.status).toBe('warn');
    expect(c.detail).toContain('STALE');
    expect(c.detail).toContain('claude plugin marketplace update vfkb');
    expect(c.detail).toContain('claude plugin update vfkb@vfkb');
    expect(report.ok).toBe(true); // never a FAIL
  });

  it('clone level with the remote → ok, and it SAYS you are current', () => {
    const { proj, cfg } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL) });
    const report = runDoctor({
      root: proj,
      brainDir: join(proj, '.vfkb'),
      env: { CLAUDE_CONFIG_DIR: cfg },
      git: () => `${LOCAL}\tHEAD\n`,
    });
    expect(currency(report)!.status).toBe('ok');
    // The stale branch says "You are running an old copy" in plain words. The
    // healthy branch must say the converse in plain words, or a reader with only
    // a version number and a fact about a clone infers staleness — three of five
    // contrast trials did exactly that.
    expect(currency(report)!.detail).toMatch(/is CURRENT/);
    expect(currency(report)!.detail).toMatch(/nothing newer to install/);
  });

  it('resolves the sha through packed-refs too', () => {
    const { proj, cfg } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL, true) });
    const report = runDoctor({
      root: proj,
      brainDir: join(proj, '.vfkb'),
      env: { CLAUDE_CONFIG_DIR: cfg },
      git: () => `${LOCAL}\tHEAD\n`,
    });
    expect(currency(report)!.status).toBe('ok');
  });

  it('unreachable remote → skip, and says it cannot tell (never fail, never implied health)', () => {
    const { proj, cfg } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL) });
    const report = runDoctor({
      root: proj,
      brainDir: join(proj, '.vfkb'),
      env: { CLAUDE_CONFIG_DIR: cfg },
      git: () => {
        throw new Error('ssh: Could not resolve hostname github.com');
      },
    });
    const c = currency(report)!;
    expect(c.status).toBe('skip');
    expect(c.detail).toMatch(/unreachable|offline/i);
    expect(report.ok).toBe(true);
  });

  it('directory-source marketplace → skip (no clone exists to be stale)', () => {
    const { proj, cfg } = setup({ source: { source: 'directory' }, installLocation: join(root, 'somewhere') });
    const report = runDoctor({
      root: proj,
      brainDir: join(proj, '.vfkb'),
      env: { CLAUDE_CONFIG_DIR: cfg },
      git: () => {
        throw new Error('git must not be invoked for a directory source');
      },
    });
    expect(currency(report)!.status).toBe('skip');
    expect(currency(report)!.detail).toContain('directory-source');
  });

  it('missing clone → skip', () => {
    const { proj, cfg } = setup({ installLocation: join(root, 'nonexistent') });
    const report = runDoctor({
      root: proj,
      brainDir: join(proj, '.vfkb'),
      env: { CLAUDE_CONFIG_DIR: cfg },
      git: () => `${REMOTE}\tHEAD\n`,
    });
    expect(currency(report)!.status).toBe('skip');
  });

  it('never `fail`s, on any of the paths above', () => {
    const { proj, cfg } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL) });
    for (const git of [
      (() => `${REMOTE}\tHEAD\n`) as GitRunner,
      (() => {
        throw new Error('offline');
      }) as GitRunner,
      (() => 'garbage output') as GitRunner,
    ]) {
      const report = runDoctor({ root: proj, brainDir: join(proj, '.vfkb'), env: { CLAUDE_CONFIG_DIR: cfg }, git });
      expect(currency(report)!.status).not.toBe('fail');
    }
  });

  // The load-bearing invariant: `git fetch` mutates the user's clone and can
  // contend on the repo lock with a running Claude Code. Observing the subcommand
  // list is how "the diagnostic does not write" is proven rather than promised.
  it('issues `ls-remote` and NOTHING else — no fetch, no rev-parse, no writes', () => {
    const { proj, cfg } = setup({ installLocation: makeClone(join(root, 'clone'), LOCAL) });
    const calls: string[][] = [];
    const spy: GitRunner = (args) => {
      calls.push(args);
      return `${REMOTE}\tHEAD\n`;
    };
    runDoctor({ root: proj, brainDir: join(proj, '.vfkb'), env: { CLAUDE_CONFIG_DIR: cfg }, git: spy });

    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('ls-remote');
    expect(calls.flat()).not.toContain('fetch');
    expect(calls.flat()).not.toContain('rev-parse');
    expect(calls.map((c) => c[0])).toEqual(['ls-remote']);
  });
});
