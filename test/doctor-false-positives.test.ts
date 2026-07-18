// P10-a — the doctor trust cluster (#186, #188, #206, #212).
//
// These are all one defect class: `vfkb doctor` reporting a problem that is not
// a problem. Doctor is the tool a consumer runs to find out whether their wiring
// is healthy, so a check that cries wolf trains people to ignore it — and #186's
// advice was actively harmful, telling users to delete the ADR-0059 guard the
// migration guide tells them to install.
//
// Structural invariants only (ADR-0029 §5: doctor is not an agent-observable
// capability, so the inner gate IS the gate here — no metered L4).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor, engineDrift, type DoctorReport } from '../src/doctor.js';

let root: string;

/** The ADR-0059 INACTIVE guard every consumer is told to commit. Mentions "vfkb". */
const GUARD_HOOK = { hooks: [{ type: 'command', command: 'node ${CLAUDE_PROJECT_DIR:-.}/.claude/vfkb-guard.mjs' }] };
/** Real pre-plugin wiring: invokes the ENGINE's hook dispatcher via the bootstrap. */
const OLD_WIRING_HOOK = {
  hooks: [
    {
      type: 'command',
      command: 'VFKB_DATA_DIR=${CLAUDE_PROJECT_DIR:-.}/.vfkb VFKB_PROJECT=p node ${CLAUDE_PROJECT_DIR:-.}/.vfkb/bin/bootstrap.mjs cli hook session-start',
    },
  ],
};

function setup(settingsHooks: any, opts: { pluginWired?: boolean } = {}) {
  const proj = join(root, 'project');
  const cfg = join(root, 'cfg');
  mkdirSync(join(proj, '.claude'), { recursive: true });
  mkdirSync(join(proj, '.vfkb'), { recursive: true });
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  const settings: any = { hooks: settingsHooks };
  if (opts.pluginWired !== false) settings.enabledPlugins = { 'vfkb@vfkb': true };
  writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify(settings));
  writeFileSync(
    join(cfg, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      plugins:
        opts.pluginWired === false
          ? {}
          : { 'vfkb@vfkb': [{ scope: 'project', projectPath: proj, version: '0.10.0' }] },
    }),
  );
  return { proj, cfg };
}

const run = (proj: string, cfg: string, brainDir?: string): DoctorReport =>
  runDoctor({ root: proj, brainDir: brainDir ?? join(proj, '.vfkb'), env: { HOME: root, CLAUDE_CONFIG_DIR: cfg } });

const check = (r: DoctorReport, name: string) => r.checks.find((c) => c.name === name);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vfkb-doctor-fp-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('#186 — the ADR-0059 guard is not double wiring', () => {
  it('does NOT warn when the only vfkb-mentioning hook is the guard', () => {
    const { proj, cfg } = setup({ SessionStart: [GUARD_HOOK] });
    const c = check(run(proj, cfg), '.claude/settings.json');
    // The bug: substring 'vfkb' in vfkb-guard.mjs classified the guard as old wiring,
    // so a correctly-migrated repo was told to delete its own INACTIVE detector.
    expect(c?.status).not.toBe('warn');
    expect(c?.detail ?? '').not.toContain('double wiring');
  });

  it('STILL warns on real old wiring alongside the plugin (the check must keep working)', () => {
    const { proj, cfg } = setup({ SessionStart: [OLD_WIRING_HOOK] });
    const c = check(run(proj, cfg), '.claude/settings.json');
    expect(c?.status).toBe('warn');
    expect(c?.detail).toContain('double wiring');
  });

  it('warns when old wiring sits alongside the guard (the guard must not mask it)', () => {
    const { proj, cfg } = setup({ SessionStart: [GUARD_HOOK, OLD_WIRING_HOOK] });
    const c = check(run(proj, cfg), '.claude/settings.json');
    expect(c?.status).toBe('warn');
    expect(c?.detail).toContain('double wiring');
  });

  it('an unwired repo carrying only the guard is still reported as unwired', () => {
    // The guard is not wiring — with no plugin and no engine hooks, doctor must
    // not be fooled into calling the repo wired.
    const { proj, cfg } = setup({ SessionStart: [GUARD_HOOK] }, { pluginWired: false });
    const c = check(run(proj, cfg), '.claude/settings.json');
    expect(c?.status).toBe('warn');
    expect(c?.detail).toContain('no vfkb hooks');
  });
});

describe('#188 — the no-manifest message names the action that actually stamps it', () => {
  // writeManifest has exactly two callers: init.ts:154 and broadcast.ts:111 (the
  // latter heal-on-absence only). The ordinary append path never stamps, so
  // "will be stamped on the next write" claimed behaviour the code lacks.
  it('does not claim the manifest appears on the next write (plugin-wired)', () => {
    const { proj, cfg } = setup({ SessionStart: [GUARD_HOOK] });
    const c = check(run(proj, cfg), 'brain manifest');
    expect(c?.detail ?? '').not.toContain('next write');
  });

  it('still refuses to prescribe `vfkb init` on a plugin-wired repo (issue #77)', () => {
    // The two constraints interact: #188 wants an accurate action named, #77
    // forbids naming THIS one here, because `vfkb init` on a plugin-wired repo
    // scaffolds double wiring. The honest message states the fact instead.
    const { proj, cfg } = setup({ SessionStart: [GUARD_HOOK] });
    const c = check(run(proj, cfg), 'brain manifest');
    expect(c?.detail ?? '').not.toContain('vfkb init');
  });

  it('names `vfkb init` on a NON-plugin repo, where it is the correct action', () => {
    const { proj, cfg } = setup({ SessionStart: [OLD_WIRING_HOOK] }, { pluginWired: false });
    const c = check(run(proj, cfg), 'brain manifest');
    expect(c?.detail ?? '').not.toContain('next write');
    expect(c?.detail ?? '').toMatch(/vfkb init/);
  });
});

describe('#212 — a sentinel commit is "unknown", not drift', () => {
  it('does not report drift when the MANIFEST holds the dev sentinel', () => {
    expect(engineDrift('dev', 'abc1234')).toBe(false);
  });

  it('does not report drift when the RUNNING engine is a dev build', () => {
    expect(engineDrift('abc1234', 'dev')).toBe(false);
  });

  it('does not report drift when both are sentinels', () => {
    expect(engineDrift('dev', 'dev')).toBe(false);
  });

  it('STILL reports drift between two real, different shas (must not over-suppress)', () => {
    expect(engineDrift('abc1234', 'def5678')).toBe(true);
  });

  it('is silent when the shas match, and when the manifest has no commit at all', () => {
    expect(engineDrift('abc1234', 'abc1234')).toBe(false);
    expect(engineDrift(undefined, 'abc1234')).toBe(false);
    expect(engineDrift('', 'abc1234')).toBe(false);
  });
});

describe('#206 — the journal-gitignore check only judges paths the repo governs', () => {
  function gitRepo(dir: string) {
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return dir;
  }

  it('does NOT warn when the brain lives OUTSIDE the repo (default ~/.vfkb tier)', () => {
    const proj = gitRepo(join(root, 'project'));
    mkdirSync(join(proj, '.claude'), { recursive: true });
    writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'vfkb@vfkb': true } }));
    const cfg = join(root, 'cfg');
    mkdirSync(join(cfg, 'plugins'), { recursive: true });
    writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: {} }));
    // Brain outside the work tree — `git check-ignore` exits 128 there, which the
    // old catch-all read as "not ignored" and turned into advice about a
    // .gitignore that does not govern the path at all.
    const outside = join(root, 'home-brain');
    mkdirSync(join(outside, '.journal'), { recursive: true });
    writeFileSync(join(outside, '.journal', 'wal.jsonl'), '');
    const c = check(run(proj, cfg, outside), 'journal gitignore');
    expect(c).toBeUndefined();
  });

  it('STILL warns for an un-ignored journal INSIDE the repo (the check must keep working)', () => {
    const proj = gitRepo(join(root, 'project2'));
    mkdirSync(join(proj, '.claude'), { recursive: true });
    writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'vfkb@vfkb': true } }));
    const cfg = join(root, 'cfg2');
    mkdirSync(join(cfg, 'plugins'), { recursive: true });
    writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: {} }));
    const brain = join(proj, '.vfkb');
    mkdirSync(join(brain, '.journal'), { recursive: true });
    writeFileSync(join(brain, '.journal', 'wal.jsonl'), '');
    const c = check(run(proj, cfg, brain), 'journal gitignore');
    expect(c?.status).toBe('warn');
    expect(c?.detail).toContain('.vfkb/.journal/');
  });

  it('is silent for an ignored journal inside the repo', () => {
    const proj = gitRepo(join(root, 'project3'));
    mkdirSync(join(proj, '.claude'), { recursive: true });
    writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'vfkb@vfkb': true } }));
    writeFileSync(join(proj, '.gitignore'), '.vfkb/.journal/\n');
    const cfg = join(root, 'cfg3');
    mkdirSync(join(cfg, 'plugins'), { recursive: true });
    writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: {} }));
    const brain = join(proj, '.vfkb');
    mkdirSync(join(brain, '.journal'), { recursive: true });
    writeFileSync(join(brain, '.journal', 'wal.jsonl'), '');
    const c = check(run(proj, cfg, brain), 'journal gitignore');
    expect(c?.status).not.toBe('warn');
  });
});
