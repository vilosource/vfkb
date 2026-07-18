// Issue #214 — a hook whose stdin never closes must FAIL OPEN, not stall.
//
// MEASURED ground truth (2026-07-18, this worktree, before the fix):
//   - `node dist/cli.js hook pre-tool-use` with a payload written but stdin
//     never closed WROTE `{}` (readStdin's 2s watchdog fired and produced the
//     right answer) and then NEVER EXITED — killed at 10s. The stdin 'data'
//     listener keeps the event loop alive, so resolving the promise is not
//     enough: the process still holds the harness.
//   - `node scripts/hook-durable-claim-check.mjs` under the same condition
//     wrote NOTHING and never exited (it only ever acts on 'end').
//
// Why that matters: Claude Code's default `command`-hook timeout is 600s
// (code.claude.com/docs/en/hooks). What the harness does when that expires
// (allow vs deny) is NOT documented — but a PreToolUse hook that pins a tool
// call for up to ten minutes violates the repo protocol either way.
//
// ALTITUDE: this drives the REAL shipped artifacts as child processes over a
// real pipe — the built `dist/cli.js` and the standalone hook script. It does
// not call readStdin() directly, because the bug is not in the promise, it is
// in whether the PROCESS terminates. A test of the helper would have stayed
// green through the entire defect.

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliPath = join(repoRoot, 'dist', 'cli.js');
const durableHook = join(repoRoot, 'scripts', 'hook-durable-claim-check.mjs');

// readStdin's watchdog is 2000ms. Allow generous headroom for process spawn +
// a loaded CI box, but stay far below anything a human would call a stall.
const MUST_EXIT_WITHIN_MS = 8000;

interface ProbeResult {
  exited: boolean;
  code: number | null;
  stdout: string;
  elapsedMs: number;
}

/**
 * Spawn `cmd args`, WRITE the payload to stdin, and deliberately NEVER close
 * stdin. This is the exact condition in issue #214: the writer stays attached.
 * Resolves when the child exits, or reports exited:false after the deadline.
 */
function probeWithUnclosedStdin(
  cmd: string,
  args: string[],
  payload: string,
  deadlineMs = MUST_EXIT_WITHIN_MS,
): Promise<ProbeResult> {
  return new Promise((resolveP) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env: { ...process.env, CLAUDE_PROJECT_DIR: repoRoot },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.stdin.write(payload); // NOTE: no .end() — stdin stays open forever.

    let settled = false;
    const kill = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolveP({ exited: false, code: null, stdout, elapsedMs: Date.now() - t0 });
    }, deadlineMs);

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(kill);
      // Give stdout a tick to flush before reporting.
      setTimeout(() => resolveP({ exited: true, code, stdout, elapsedMs: Date.now() - t0 }), 20);
    });
  });
}

const benignPayload = JSON.stringify({
  session_id: 'stdin-failopen-test',
  cwd: '/nonexistent-vfkb-probe',
  tool_name: 'Read',
  tool_input: { file_path: '/etc/hostname' },
});

describe('issue #214 — hooks fail open when stdin never closes', () => {
  beforeAll(() => {
    // The property under test is about the SHIPPED binary. If it is missing the
    // test must fail loudly, never silently skip (a skipped guard is a blind one).
    expect(
      existsSync(cliPath),
      `dist/cli.js missing — run \`npm run build\` (pretest does this)`,
    ).toBe(true);
    expect(existsSync(durableHook)).toBe(true);
  });

  // The PreToolUse gate is the highest-stakes case: it sits between the agent
  // and every Write/Edit, so a wedge here wedges the whole session.
  it('dist/cli.js hook pre-tool-use TERMINATES and allows the call', async () => {
    const r = await probeWithUnclosedStdin('node', [cliPath, 'hook', 'pre-tool-use'], benignPayload);
    expect(
      r.exited,
      `hook pre-tool-use did not exit within ${MUST_EXIT_WITHIN_MS}ms with stdin held open ` +
        `(stdout so far: ${JSON.stringify(r.stdout)}). A PreToolUse hook that never exits ` +
        `pins the tool call until the harness's 600s cancel.`,
    ).toBe(true);
    expect(r.code).toBe(0);
    // Fail OPEN means EMITTING the allow shape, not merely declining to deny.
    // Asserting only `not.toContain('deny')` is satisfied by empty stdout — the
    // quiet-success trap (ADR-0051 clause 3). Assert the payload positively.
    expect(r.stdout.trim()).toBe('{}');
  }, 30000);

  // Every other hook subcommand shares the same readStdin() convention, so the
  // guard must hold uniformly — this is a convention fix, not a one-file patch.
  for (const sub of ['post-tool-use', 'stop', 'session-end', 'session-start']) {
    it(`dist/cli.js hook ${sub} TERMINATES with stdin held open`, async () => {
      const r = await probeWithUnclosedStdin('node', [cliPath, 'hook', sub], benignPayload);
      expect(
        r.exited,
        `hook ${sub} did not exit within ${MUST_EXIT_WITHIN_MS}ms with stdin held open ` +
          `(stdout so far: ${JSON.stringify(r.stdout)})`,
      ).toBe(true);
      expect(r.code).toBe(0);
      // Terminating silently is NOT failing open — the harness gets no decision.
      // Every hook subcommand emits a JSON object on the allow path.
      expect(
        r.stdout.trim().startsWith('{'),
        `hook ${sub} exited but emitted no JSON decision (stdout: ${JSON.stringify(r.stdout)})`,
      ).toBe(true);
    }, 30000);
  }

  // The standalone Brake reads stdin with the same await-until-'end' pattern and
  // ships to this repo's own .claude/settings.json — issue #214's stated scope.
  it('scripts/hook-durable-claim-check.mjs TERMINATES with stdin held open', async () => {
    const r = await probeWithUnclosedStdin('node', [durableHook], benignPayload);
    expect(
      r.exited,
      `durable-claim hook did not exit within ${MUST_EXIT_WITHIN_MS}ms with stdin held open`,
    ).toBe(true);
    expect(r.code).toBe(0);
  }, 30000);

  // ...and it must still be able to SPEAK on a durable-artifact payload it only
  // ever saw partially. A watchdog that fires but drops the payload would turn
  // the Brake inert under load — the exact class of defect this repo keeps hitting.
  it('durable-claim hook still emits its reminder from a payload whose stdin never closed', async () => {
    const durablePayload = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'gh issue create --title "x" --body "y"' },
    });
    const r = await probeWithUnclosedStdin('node', [durableHook], durablePayload);
    expect(r.exited, 'durable-claim hook did not exit with stdin held open').toBe(true);
    expect(r.stdout).toContain('DURABLE ARTIFACT');
    expect(r.stdout).toContain('hookSpecificOutput');
  }, 30000);

  // CONTRAST ARM: the normal path (stdin properly closed) must be FAST and
  // unaffected. If the watchdog became the only exit route, every hook would
  // suddenly cost 2s — a regression the termination assertions alone miss.
  it('the normal closed-stdin path stays fast (watchdog is not the exit route)', async () => {
    const t0 = Date.now();
    const out = await new Promise<string>((resolveP) => {
      const child = spawn('node', [cliPath, 'hook', 'pre-tool-use'], { cwd: repoRoot });
      let s = '';
      child.stdout.on('data', (d) => (s += d));
      child.on('exit', () => resolveP(s));
      child.stdin.end(benignPayload); // properly closed
    });
    const elapsed = Date.now() - t0;
    // Positive assertion: it must actually EMIT the allow decision on the normal
    // path. (Dropping the 'end' handler makes the process exit 0 fast and silent
    // — mutation M4 — which an `not.toContain('deny')` check passes happily.)
    expect(out.trim()).toBe('{}');
    expect(elapsed, `closed-stdin hook took ${elapsed}ms — the 2s watchdog should NOT be the exit route`).toBeLessThan(1900);
  }, 30000);
});
