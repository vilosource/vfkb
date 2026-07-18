// FR-1 (ADR-0030) inner gate — `vfkb init` scaffolds a consumer repo correctly
// and is IDEMPOTENT (re-running changes nothing, never clobbers a brain, never
// duplicates the .gitignore stanza or the AGENTS.md snippet). The agent-driven
// consumer-onboarding L4 scenario is the capability-level DoD (ADR-0029).

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from './init.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vfkb-init-'));
});

const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('vfkb init (FR-1)', () => {
  it('scaffolds the portable wiring, gitignore stanza, empty brain, and snippet', () => {
    const changes = initProject(root, { project: 'demo' });
    const actions = Object.fromEntries(changes.map((c) => [c.path, c.action]));
    expect(actions['.vfkb/entries.jsonl']).toBe('created');
    expect(actions['.vfkb/manifest.json']).toBe('created');
    expect(actions['.mcp.json']).toBe('created');
    expect(actions['.claude/settings.json']).toBe('created');
    expect(actions['.vfkb/bin/bootstrap.mjs']).toBe('created');
    expect(actions['.gitignore']).toBe('created');
    expect(actions['AGENTS.md']).toBe('created');

    // .mcp.json — via the committed relative bootstrap (ADR-0031), project from the arg.
    const mcp = JSON.parse(read('.mcp.json'));
    expect(mcp.mcpServers.vfkb.args).toEqual(['.vfkb/bin/bootstrap.mjs', 'mcp']);
    expect(mcp.mcpServers.vfkb.env).toEqual({ VFKB_DATA_DIR: '.vfkb', VFKB_PROJECT: 'demo' });

    // .claude/settings.json — the three hooks, via the bootstrap, no relative dist/ path.
    const settings = JSON.parse(read('.claude/settings.json'));
    expect(Object.keys(settings.hooks).sort()).toEqual([
      'PreToolUse',
      'SessionEnd',
      'SessionStart',
      'Stop',
    ]);
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toContain('cli hook session-end');
    const blob = JSON.stringify(settings);
    expect(blob).toContain('.vfkb/bin/bootstrap.mjs cli hook');
    expect(blob).toContain('VFKB_PROJECT=demo');
    expect(blob).not.toContain('dist/cli.js');
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Write|Edit|MultiEdit');

    // issue #22 / ADR-0035 — hooks anchor to $CLAUDE_PROJECT_DIR (CWD-independent),
    // NOT a bare CWD-relative path that breaks when the session cd's out of the root.
    expect(blob).toContain('${CLAUDE_PROJECT_DIR:-.}/.vfkb/bin/bootstrap.mjs');
    expect(blob).toContain('VFKB_DATA_DIR=${CLAUDE_PROJECT_DIR:-.}/.vfkb');
    expect(blob).not.toContain('node .vfkb/bin/bootstrap.mjs'); // the old bare-relative form

    // the bootstrap is a committed, self-contained guard.
    const boot = read('.vfkb/bin/bootstrap.mjs');
    expect(boot).toContain('VFKB_BUNDLE_DIR');
    expect(boot).not.toContain("from './"); // no engine import — must run standalone

    // version stamp (FR-4).
    expect(JSON.parse(read('.vfkb/manifest.json')).schema_version).toBe(1);

    // empty brain + gitignore stanza + snippet marker.
    expect(read('.vfkb/entries.jsonl')).toBe('');
    expect(read('.gitignore')).toContain('.vfkb/.sessions/');
    expect(read('AGENTS.md')).toContain('How we track work HERE');
  });

  // The generator, not the symptom. A 10-repo sweep (2026-07-18) added
  // `.vfkb/.lock` and corrected a false comment across every consumer — and
  // `vfkb init` would have re-introduced both on the next new repo. Fixing ten
  // copies without fixing what emits them is a sweep you run again.
  describe('the emitted .gitignore stanza is correct at the source', () => {
    it('ignores every derived/operational path, including the lock', () => {
      initProject(root, { project: 'demo' });
      const gi = read('.gitignore');
      for (const p of ['.vfkb/index-meta.json', '.vfkb/.sessions/', '.vfkb/.signals/', '.vfkb/.journal/', '.vfkb/.lock']) {
        expect(gi, `missing ignore rule ${p}`).toContain(p);
      }
    });

    it('does NOT ignore the two committed files', () => {
      initProject(root, { project: 'demo' });
      const gi = read('.gitignore')
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith('#'));
      // entries.jsonl is the brain; manifest.json is the ADR-0030 engine stamp.
      expect(gi).not.toContain('.vfkb/entries.jsonl');
      expect(gi).not.toContain('.vfkb/manifest.json');
      expect(gi).not.toContain('.vfkb/');
    });

    it('does not claim entries.jsonl is the ONLY committed file', () => {
      // That comment was false and load-bearing: the natural response to an
      // untracked manifest.json is to gitignore it, which is exactly how one
      // consumer ended up with no engine stamp at all.
      initProject(root, { project: 'demo' });
      const gi = read('.gitignore');
      expect(gi).not.toMatch(/only .vfkb\/entries\.jsonl is committed/i);
      expect(gi).toMatch(/manifest\.json/);
    });
  });

  it('defaults the project name to the directory basename', () => {
    initProject(root, {});
    const mcp = JSON.parse(read('.mcp.json'));
    expect(mcp.mcpServers.vfkb.env.VFKB_PROJECT).toBe(root.split('/').pop());
  });

  it('is idempotent — a second run changes nothing and does not duplicate', () => {
    initProject(root, { project: 'demo' });
    const second = initProject(root, { project: 'demo' });
    expect(second.every((c) => c.action === 'skipped')).toBe(true);

    // gitignore stanza appears exactly once.
    const gi = read('.gitignore');
    expect(gi.split('.vfkb/.sessions/').length - 1).toBe(1);
    // snippet marker appears exactly once.
    const agents = read('AGENTS.md');
    expect(agents.split('vfkb:how-we-track-work').length - 1).toBe(1);
  });

  it('emits the ADR-0041 merge=union attribute for the brain, append-once (V2-3 consumer follow-up)', () => {
    const changes = initProject(root, { project: 'demo' });
    expect(changes.find((c) => c.path === '.gitattributes')?.action).toBe('created');
    expect(read('.gitattributes')).toContain('.vfkb/entries.jsonl merge=union');

    // appends to an existing .gitattributes without touching its content…
    writeFileSync(join(root, '.gitattributes'), '*.png binary\n');
    const again = initProject(root, { project: 'demo' });
    expect(again.find((c) => c.path === '.gitattributes')?.action).toBe('updated');
    const ga = read('.gitattributes');
    expect(ga).toContain('*.png binary');
    expect(ga.split('.vfkb/entries.jsonl merge=union').length - 1).toBe(1);

    // …and is idempotent once present.
    const third = initProject(root, { project: 'demo' });
    expect(third.find((c) => c.path === '.gitattributes')?.action).toBe('skipped');
  });

  it('never clobbers an existing brain', () => {
    initProject(root, { project: 'demo' });
    writeFileSync(join(root, '.vfkb', 'entries.jsonl'), '{"id":"keep"}\n');
    const again = initProject(root, { project: 'demo' });
    expect(again.find((c) => c.path === '.vfkb/entries.jsonl')?.action).toBe('skipped');
    expect(read('.vfkb/entries.jsonl')).toContain('keep');
  });

  it('merges into an existing .mcp.json without dropping other servers', () => {
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    initProject(root, { project: 'demo' });
    const mcp = JSON.parse(read('.mcp.json'));
    expect(mcp.mcpServers.other).toEqual({ command: 'x' });
    expect(mcp.mcpServers.vfkb).toBeDefined();
  });

  it('upgrades an existing CWD-relative vfkb hook to the anchored form, keeping user hooks (issue #22)', () => {
    const dir = join(root, '.claude');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'echo user-hook' }] }, // a user's own hook — must survive
          { hooks: [{ type: 'command', command: 'VFKB_DATA_DIR=.vfkb VFKB_PROJECT=demo node .vfkb/bin/bootstrap.mjs cli hook stop' }] },
        ],
      },
    }));
    const changes = initProject(root, { project: 'demo' });
    expect(changes.find((c) => c.path === '.claude/settings.json')?.action).toBe('updated');

    const settings = JSON.parse(read('.claude/settings.json'));
    const cmds = settings.hooks.Stop.map((e: any) => e.hooks[0].command);
    expect(cmds).toContain('echo user-hook'); // user hook preserved
    expect(cmds.some((c: string) => c.includes('${CLAUDE_PROJECT_DIR:-.}/.vfkb/bin/bootstrap.mjs cli hook stop'))).toBe(true);
    expect(cmds).not.toContain('VFKB_DATA_DIR=.vfkb VFKB_PROJECT=demo node .vfkb/bin/bootstrap.mjs cli hook stop'); // old form gone
    // and re-running is now idempotent on the upgraded form
    const again = initProject(root, { project: 'demo' });
    expect(again.find((c) => c.path === '.claude/settings.json')?.action).toBe('skipped');
  });

  it('the emitted hook resolves from a foreign CWD; the old bare-relative form does not (issue #22 DoD)', () => {
    initProject(root, { project: 'demo' });
    const settings = JSON.parse(read('.claude/settings.json'));
    const anchored: string = settings.hooks.SessionStart[0].hooks[0].command;

    const foreign = mkdtempSync(join(tmpdir(), 'vfkb-cwd-')); // a dir that is NOT the repo root
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root } as Record<string, string>;
    delete env.VFKB_BUNDLE_DIR; // force the bootstrap's graceful INACTIVE path (no engine needed)
    delete env.VFKB_HOME;

    // Anchored form: the bootstrap is FOUND despite the foreign CWD -> emits the
    // SessionStart INACTIVE payload and exits 0.
    const ok = spawnSync('sh', ['-c', anchored], { cwd: foreign, env, encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('INACTIVE');

    // Contrast (proves the bug + that this gate CAN fail): the old bare-relative form
    // from the same foreign CWD -> MODULE_NOT_FOUND, non-zero exit.
    const bare = 'VFKB_DATA_DIR=.vfkb VFKB_PROJECT=demo node .vfkb/bin/bootstrap.mjs cli hook session-start';
    const bad = spawnSync('sh', ['-c', bare], { cwd: foreign, env, encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/Cannot find module|MODULE_NOT_FOUND/);
  });
});
