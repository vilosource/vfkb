import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Brake for ADR-0071: docs/templates/consumer-settings.json is the ONLY thing
// the vfkb-new-project skill and CONSUMER-ONBOARDING.md may point a consumer
// at for .claude/settings.json. It must stay minimal forever, independent of
// how vfkb's own dogfooded .claude/settings.json evolves — that file grew two
// PreToolUse hooks referencing vfkb-repo-local scripts (git-compound-guard,
// durable-claim-check) that do not exist in a fresh consumer repo, which is
// exactly the defect this test exists to catch from recurring.
const TEMPLATE_PATH = join(__dirname, '..', 'docs', 'templates', 'consumer-settings.json');

function loadTemplate() {
  return JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
}

describe('docs/templates/consumer-settings.json (ADR-0071 Brake)', () => {
  it('is valid JSON', () => {
    expect(() => loadTemplate()).not.toThrow();
  });

  it('declares only the three consumer-relevant top-level keys', () => {
    const tpl = loadTemplate();
    expect(Object.keys(tpl).sort()).toEqual(['enabledPlugins', 'extraKnownMarketplaces', 'hooks']);
  });

  it('declares the vfkb marketplace and plugin', () => {
    const tpl = loadTemplate();
    expect(tpl.extraKnownMarketplaces?.vfkb?.source?.repo).toBe('vilosource/vfkb-claude-plugin');
    expect(tpl.enabledPlugins?.['vfkb@vfkb']).toBe(true);
  });

  it('wires only the SessionStart guard hook — no other hook events', () => {
    const tpl = loadTemplate();
    expect(Object.keys(tpl.hooks)).toEqual(['SessionStart']);
  });

  it('never references a scripts/ path — the exact shape of the bug this Brake exists for', () => {
    const raw = readFileSync(TEMPLATE_PATH, 'utf8');
    expect(raw).not.toMatch(/scripts\//);
  });

  it('the one hook command it does carry runs the committed vfkb-guard.mjs', () => {
    const tpl = loadTemplate();
    const commands = tpl.hooks.SessionStart.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(commands).toEqual(['node ${CLAUDE_PROJECT_DIR:-.}/.claude/vfkb-guard.mjs']);
  });
});
