// FR-1 (ADR-0030) — `vfkb init [project]`: idempotently scaffold a CONSUMER repo
// so a session there runs on vfkb automatically. Writes the auto-layer wiring in
// the portable `$VFKB_HOME` form (FR-2), the .gitignore stanza, an empty brain,
// and a parameterized "how we track work HERE" snippet. Re-running is safe: each
// piece is created-if-absent / merged-if-present, and a brain is NEVER clobbered.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { writeManifest } from './manifest.js';

export type InitAction = 'created' | 'updated' | 'skipped';
export interface InitChange {
  path: string;
  action: InitAction;
}

const AGENTS_MARKER = '<!-- vfkb:how-we-track-work -->';

// The portable wiring (FR-2): the engine is resolved via $VFKB_HOME, never a
// relative dist/ path — so it works in any consumer repo / container / the fleet.
function mcpConfig(project: string) {
  return {
    command: 'node',
    args: ['${VFKB_HOME}/vfkb-mcp.mjs'],
    env: { VFKB_DIR: '.vfkb', VFKB_PROJECT: project },
  };
}

function hookCommand(project: string, sub: string): string {
  return `VFKB_DIR=.vfkb VFKB_PROJECT=${project} node "$VFKB_HOME/vfkb.mjs" hook ${sub}`;
}

function settingsHooks(project: string) {
  return {
    SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(project, 'session-start') }] }],
    PreToolUse: [
      { matcher: 'Write|Edit|MultiEdit', hooks: [{ type: 'command', command: hookCommand(project, 'pre-tool-use') }] },
    ],
    Stop: [{ hooks: [{ type: 'command', command: hookCommand(project, 'stop') }] }],
  };
}

function agentsSnippet(project: string): string {
  return `${AGENTS_MARKER}
## How we track work HERE — vfkb

This repo uses **vfkb** as its knowledge substrate (project \`${project}\`). Knowledge is recorded
**deliberately, through the engine** — never by hand-editing \`.vfkb/\` (a PreToolUse hook gates that).

- **Session start** injects the resume digest + knowledge bundle automatically (SessionStart hook).
- **Record knowledge** with the \`mcp__vfkb__kb_add\` tool (or \`node "$VFKB_HOME/vfkb.mjs" add …\`):
  \`decision\` (with \`why=\`), plus \`fact|gotcha|pattern|link\`. **Capture load-bearing decisions
  immediately — don't defer.**
- Only \`.vfkb/entries.jsonl\` is committed; \`.vfkb/index-meta.json\`, \`.sessions/\`, \`.signals/\`
  are derived/gitignored.

The engine resolves via **\`$VFKB_HOME\`** — set it once per machine to the vfkb bundles dir
(\`dist/bundles\`), e.g. \`export VFKB_HOME=/path/to/vfkb/dist/bundles\`.
`;
}

function readJson(path: string): any | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function eventHasVfkb(arr: unknown): boolean {
  return JSON.stringify(arr ?? '').includes('vfkb.mjs');
}

export function initProject(root: string, opts: { project?: string } = {}): InitChange[] {
  const project = opts.project || basename(root) || 'project';
  const changes: InitChange[] = [];

  // 1. Empty brain — NEVER clobber an existing one.
  const brainDir = join(root, '.vfkb');
  const entries = join(brainDir, 'entries.jsonl');
  if (!existsSync(entries)) {
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(entries, '');
    changes.push({ path: '.vfkb/entries.jsonl', action: 'created' });
  } else {
    changes.push({ path: '.vfkb/entries.jsonl', action: 'skipped' });
  }

  // 1b. Brain↔engine version stamp (FR-4) — committed, engine-written.
  changes.push({ path: '.vfkb/manifest.json', action: writeManifest(brainDir) });

  // 2. .mcp.json — register the vfkb MCP server (merge, keep other servers).
  {
    const path = join(root, '.mcp.json');
    const existed = existsSync(path);
    const cfg = readJson(path) ?? {};
    cfg.mcpServers = cfg.mcpServers ?? {};
    const desired = mcpConfig(project);
    const same = JSON.stringify(cfg.mcpServers.vfkb) === JSON.stringify(desired);
    if (same) {
      changes.push({ path: '.mcp.json', action: 'skipped' });
    } else {
      cfg.mcpServers.vfkb = desired;
      writeJson(path, cfg);
      changes.push({ path: '.mcp.json', action: existed ? 'updated' : 'created' });
    }
  }

  // 3. .claude/settings.json — the three hooks (merge per-event; don't duplicate).
  {
    const dir = join(root, '.claude');
    const path = join(dir, 'settings.json');
    const existed = existsSync(path);
    const cfg = readJson(path) ?? {};
    cfg.hooks = cfg.hooks ?? {};
    const want = settingsHooks(project);
    let touched = false;
    for (const event of Object.keys(want) as (keyof typeof want)[]) {
      const cur = cfg.hooks[event];
      if (eventHasVfkb(cur)) continue; // already wired
      cfg.hooks[event] = [...(Array.isArray(cur) ? cur : []), ...want[event]];
      touched = true;
    }
    if (touched) {
      mkdirSync(dir, { recursive: true });
      writeJson(path, cfg);
      changes.push({ path: '.claude/settings.json', action: existed ? 'updated' : 'created' });
    } else {
      changes.push({ path: '.claude/settings.json', action: 'skipped' });
    }
  }

  // 4. .gitignore — the derived/operational stanza (append once).
  {
    const path = join(root, '.gitignore');
    const lines = ['.vfkb/index-meta.json', '.vfkb/.sessions/', '.vfkb/.signals/'];
    const existed = existsSync(path);
    const cur = existed ? readFileSync(path, 'utf8') : '';
    const missing = lines.filter((l) => !cur.split(/\r?\n/).includes(l));
    if (missing.length === 0) {
      changes.push({ path: '.gitignore', action: 'skipped' });
    } else {
      const prefix = cur && !cur.endsWith('\n') ? '\n' : '';
      const block = `${prefix}${cur ? '\n' : ''}# vfkb — derived/operational (only .vfkb/entries.jsonl is committed)\n${missing.join('\n')}\n`;
      writeFileSync(path, cur + block);
      changes.push({ path: '.gitignore', action: existed ? 'updated' : 'created' });
    }
  }

  // 5. AGENTS.md — the parameterized "how we track work HERE" snippet (append once).
  {
    const path = join(root, 'AGENTS.md');
    const existed = existsSync(path);
    const cur = existed ? readFileSync(path, 'utf8') : '';
    if (cur.includes(AGENTS_MARKER)) {
      changes.push({ path: 'AGENTS.md', action: 'skipped' });
    } else {
      const sep = cur && !cur.endsWith('\n') ? '\n\n' : cur ? '\n' : '';
      writeFileSync(path, cur + sep + agentsSnippet(project));
      changes.push({ path: 'AGENTS.md', action: existed ? 'updated' : 'created' });
    }
  }

  return changes;
}

// The one step init cannot do for you (printed by the CLI).
export function approvalNotice(project: string): string {
  return [
    `vfkb wired for project "${project}".`,
    '',
    'Next (one-time, manual):',
    '  1. Set $VFKB_HOME once per machine to the vfkb bundles dir, e.g.:',
    '       export VFKB_HOME=/path/to/vfkb/dist/bundles   # (run `npm run build:bundles` in the vfkb repo)',
    '  2. Start `claude` in this repo and APPROVE the project MCP server + hooks when prompted (once).',
    '  3. Commit the wiring + the empty brain: git add .mcp.json .claude .gitignore .vfkb AGENTS.md',
  ].join('\n');
}
