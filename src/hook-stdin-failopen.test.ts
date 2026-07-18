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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cliPath = join(repoRoot, 'dist', 'cli.js');
const durableHook = join(repoRoot, 'scripts', 'hook-durable-claim-check.mjs');

// SANDBOX (ADR-0029 clause 1: "isolated from the live/dogfooded system").
// `hook post-tool-use` CAPTURES its payload into the brain, and the brain dir
// defaults to ~/.vfkb — the operator's REAL, git-tracked global brain. Without
// this every run of this file, and every RED mutation run a future engineer
// performs to re-verify the guard, appends junk `fact` entries to a committed
// file. That is not hypothetical: it was OBSERVED during review of this very
// PR (18 stray `/etc/hostname` entries, ~/.vfkb left dirty).
//
// This is self-enforcing, not a convention: the payload-survival test below
// asserts the entry lands in THIS dir, so dropping VFKB_DATA_DIR turns the
// sandbox brain empty and takes the suite RED.
let brainDir: string;
beforeAll(() => {
  brainDir = mkdtempSync(join(tmpdir(), 'vfkb-stdin-failopen-'));
});
afterAll(() => {
  if (brainDir) rmSync(brainDir, { recursive: true, force: true });
});

/** Env for every spawned hook: the real harness vars, but a throwaway brain. */
function sandboxEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_PROJECT_DIR: repoRoot,
    VFKB_DATA_DIR: brainDir,
  };
}

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
      env: sandboxEnv(),
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

  // The cli.ts analogue of the durable-claim payload test below. Terminating is
  // only half the contract: readStdin must resolve with the bytes that ARRIVED,
  // not an empty string. A watchdog that fires and DISCARDS the buffer exits 0,
  // emits `{}`, and passes every termination assertion above while silently
  // making the hook inert — the quiet-success trap (ADR-0051 clause 3), and the
  // exact asymmetry review finding R2 flagged (the .mjs side was guarded here,
  // cli.ts was not). Mutation: `resolve(data)` -> `resolve('')` in finish().
  //
  // Observed at the shipped altitude: post-tool-use CAPTURES the payload into
  // the brain, so the sandbox brain is the proof the bytes survived. This also
  // pins the sandbox itself — with VFKB_DATA_DIR dropped, this file is empty.
  it('post-tool-use still CAPTURES a payload whose stdin never closed (watchdog must not discard)', async () => {
    const marker = `stdin-failopen-marker-${Date.now()}`;
    const payload = JSON.stringify({
      session_id: 'stdin-failopen-capture',
      tool_name: 'Read',
      tool_input: { file_path: `/probe/${marker}` },
    });
    const r = await probeWithUnclosedStdin('node', [cliPath, 'hook', 'post-tool-use'], payload);
    expect(r.exited, 'post-tool-use did not exit with stdin held open').toBe(true);

    const entriesPath = join(brainDir, 'entries.jsonl');
    expect(
      existsSync(entriesPath),
      `no brain written at ${entriesPath} — the watchdog resolved but the payload was dropped, ` +
        `so captureToolCall saw nothing. The hook is inert.`,
    ).toBe(true);
    const brain = readFileSync(entriesPath, 'utf8');
    expect(
      brain,
      `the captured entry does not carry the payload's marker — readStdin settled on the ` +
        `deadline but discarded the buffered bytes.`,
    ).toContain(marker);
  }, 30000);

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
    const runClosed = async (): Promise<{ out: string; elapsed: number }> => {
      const t0 = Date.now();
      const out = await new Promise<string>((resolveP) => {
        const child = spawn('node', [cliPath, 'hook', 'pre-tool-use'], {
          cwd: repoRoot,
          env: sandboxEnv(),
        });
        let s = '';
        child.stdout.on('data', (d) => (s += d));
        child.on('exit', () => resolveP(s));
        child.stdin.end(benignPayload); // properly closed
      });
      return { out, elapsed: Date.now() - t0 };
    };

    let r = await runClosed();
    // The bound MUST stay below STDIN_WATCHDOG_MS (2000ms) or it asserts nothing
    // — the whole point is distinguishing "exited via 'end'" from "exited via the
    // watchdog". So instead of loosening it past the thing it measures, absorb a
    // single transient runner stall by retrying once (review finding R3). A build
    // where the watchdog IS the only exit route takes ~2s on BOTH attempts, so
    // this keeps the full mutation-detecting power.
    if (r.elapsed >= 1900) r = await runClosed();

    // Positive assertion: it must actually EMIT the allow decision on the normal
    // path. (Dropping the 'end' handler makes the process exit 0 fast and silent
    // — mutation M4 — which an `not.toContain('deny')` check passes happily.)
    expect(r.out.trim()).toBe('{}');
    expect(
      r.elapsed,
      `closed-stdin hook took ${r.elapsed}ms on two consecutive attempts — the 2s watchdog ` +
        `should NOT be the exit route`,
    ).toBeLessThan(1900);
  }, 30000);
});
