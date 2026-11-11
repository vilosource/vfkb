import { describe, it, expect } from 'vitest';
import { STOP_REMINDER, renderStaleHandoffReminder } from '../src/stop-reminder.js';
import { renderPromptNudge } from '../src/prompt-nudge.js';

// vfkb#465: a nudge must not coach the agent to write role=human. That role derives trust
// 'operator' (deriveTrust, src/engine.ts) and so provenance 'verified', and both rank higher at
// injection. Whether an entry is human-checked is the human's call, not a label the agent picks.
const SELF_VERIFY = /\brole\b["']?\s*[:=]\s*["']?human\b|--role\s+["']?human\b/i;

const pin = { id: 'c708f71279b6', created: '2026-10-27T10:00:00.000Z' };
const commits = [{ hash: 'a'.repeat(40), short: 'aaaaaaa', subject: 'docs: note' }];

describe('the self-verify pattern', () => {
  it.each(['role=human', 'role: human', 'role="human"', "role='human'", 'role=Human', '"role":"human"', '--role human'])(
    'matches %s',
    (s) => expect(`kb_add (type=fact, ${s})`).toMatch(SELF_VERIFY),
  );
  it.each(['prole=humane', 'role=humanities', 'role=executor'])('does not match %s', (s) => expect(s).not.toMatch(SELF_VERIFY));
});

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
