// FR-1 (ADR-0030) inner gate — `vfkb init` scaffolds a consumer repo correctly
// and is IDEMPOTENT (re-running changes nothing, never clobbers a brain, never
// duplicates the .gitignore stanza or the AGENTS.md snippet). The agent-driven
// consumer-onboarding L4 scenario is the capability-level DoD (ADR-0029).

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
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
    expect(Object.keys(settings.hooks).sort()).toEqual(['PreToolUse', 'SessionStart', 'Stop']);
    const blob = JSON.stringify(settings);
    expect(blob).toContain('.vfkb/bin/bootstrap.mjs cli hook');
    expect(blob).toContain('VFKB_PROJECT=demo');
    expect(blob).not.toContain('dist/cli.js');
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Write|Edit|MultiEdit');

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
});
