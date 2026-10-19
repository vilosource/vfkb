import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ADR-0077 clause 2 (accepts RFC-042, v3 R2). After a compaction Claude Code fires
// SessionStart again with `source: "compact"` (observed, CLI 2.1.286), and the
// plugin's matcher-less SessionStart hook re-runs `hook session-start`. That
// re-injection is the ONLY thing carrying ADR-0008's Constitution and ADR-0049's
// handoff pin past a compaction. It works because the handler ignores `source`.
// These tests make that load-bearing: the pinned sections must come out the same
// for a compaction as for the startup that preceded it. Exercises the real built
// CLI, like session-backbone.test.ts.
const CLI = resolve(__dirname, '../dist/cli.js');

function hookEnv(brain: string): NodeJS.ProcessEnv {
  const env = { ...process.env, VFKB_DATA_DIR: brain };
  delete env.KB_SESSION_ID;
  delete env.VFKB_DIR;
  return env;
}

function cli(brain: string, args: string[], input?: string): string {
  return execFileSync('node', [CLI, ...args], { input, env: hookEnv(brain), encoding: 'utf8' });
}

function sessionStart(brain: string, payload: object): string {
  const out = JSON.parse(cli(brain, ['hook', 'session-start'], JSON.stringify(payload)));
  return out.hookSpecificOutput.additionalContext as string;
}

/** The two pinned sections, from the Constitution heading up to the knowledge map. */
function pinned(ctx: string): string {
  const start = ctx.indexOf('## Constitution');
  const end = ctx.indexOf('<vfkb-map>');
  return start >= 0 && end > start ? ctx.slice(start, end) : '';
}

const CONSTITUTION = 'every reply about vaults must use the code word KUMQUAT-8812';
const HANDOFF = 'HANDOFF: the single next step is the migration codenamed sentinel-step-77';

let brain: string;
beforeEach(() => {
  brain = mkdtempSync(join(tmpdir(), 'vfkb-compact-'));
  cli(brain, ['add', 'decision', CONSTITUTION, '--why', 'test', '--status', 'accepted', '--constitutional', '--role', 'human']);
  cli(brain, ['add', 'fact', HANDOFF, '--tag', 'handoff,next', '--role', 'human']);
});

describe('compaction re-injection (ADR-0077 clause 2)', () => {
  it('a compaction re-emits the Constitution and the handoff pin', () => {
    sessionStart(brain, { session_id: 'sess-c', source: 'startup' });
    const ctx = sessionStart(brain, { session_id: 'sess-c', source: 'compact' });
    expect(ctx).toContain('## Constitution');
    expect(ctx).toContain('KUMQUAT-8812');
    expect(ctx).toContain('## Last handoff');
    expect(ctx).toContain('sentinel-step-77');
  });

  it('the pinned sections are identical for compact and startup, and lead in the same order', () => {
    const atStartup = sessionStart(brain, { session_id: 'sess-o', source: 'startup' });
    const afterCompact = sessionStart(brain, { session_id: 'sess-o', source: 'compact' });
    const p = pinned(afterCompact);
    expect(p).not.toBe('');
    expect(p).toBe(pinned(atStartup));
    expect(p.indexOf('## Constitution')).toBeLessThan(p.indexOf('## Last handoff'));
  });

  it('every source Claude Code sends gets the same pinned sections', () => {
    // startup | resume | clear | compact — the SessionStart sources; none may weaken the pin.
    const reference = pinned(sessionStart(brain, { session_id: 'sess-s', source: 'startup' }));
    for (const source of ['resume', 'clear', 'compact']) {
      expect(pinned(sessionStart(brain, { session_id: 'sess-s', source })), source).toBe(reference);
    }
  });
});
