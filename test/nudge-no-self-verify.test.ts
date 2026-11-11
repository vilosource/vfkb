import { describe, it, expect } from 'vitest';
import { STOP_REMINDER, renderStaleHandoffReminder } from '../src/stop-reminder.js';
import { renderPromptNudge } from '../src/prompt-nudge.js';

// vfkb#465: a nudge must not coach the agent to write role=human. That role derives trust
// 'operator' and so provenance 'verified' (deriveTrust, src/engine.ts), which ranks higher at
// injection. Verification is a human action (`vfkb curate promote`), not a label the agent picks.
const SELF_VERIFY = /role[=\s]+human|--role\s+human/;

const pin = { id: 'c708f71279b6', created: '2026-10-27T10:00:00.000Z' };
const commits = [{ hash: 'a'.repeat(40), short: 'aaaaaaa', subject: 'docs: note' }];

describe('agent-facing nudge texts never ask for role=human (vfkb#465)', () => {
  const texts: Record<string, string> = {
    'decision-capture (Stop)': STOP_REMINDER,
    'stale handoff (Stop B3)': renderStaleHandoffReminder(pin, commits),
    'prompt line, stale': renderPromptNudge(['stale'], { pin, branch: 'feat/x', newEntries: 0, staleCommits: commits }),
    'prompt line, B1': renderPromptNudge(['b1'], { branch: 'feat/x', newEntries: 4 }),
  };
  for (const [name, text] of Object.entries(texts)) {
    it(name, () => {
      expect(text).toContain('kb_add');
      expect(text).not.toMatch(SELF_VERIFY);
    });
  }
});
