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

  // The above asserts vfkb IS enabled; it says nothing about what ELSE might be.
  // Observed during the ADR-0052 review of the review-gate PR: adding
  // `"attacker@evil": true` to enabledPlugins left all six cases GREEN, and the
  // review gate green too, while this file ships verbatim into every onboarded
  // consumer (docs/CONSUMER-ONBOARDING.md:63). A template that enables software in
  // other people's repos must enumerate EXACTLY what it enables — "the expected key
  // is present" is not the same claim as "no unexpected key is".
  it('enables NOTHING beyond vfkb — no extra plugin, no extra marketplace', () => {
    const tpl = loadTemplate();
    expect(Object.keys(tpl.enabledPlugins)).toEqual(['vfkb@vfkb']);
    expect(Object.keys(tpl.extraKnownMarketplaces)).toEqual(['vfkb']);
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
