#!/usr/bin/env node
// PreToolUse[Bash] guard — a branch switch is never chained with mutations
// (ADR-0070 §5). Observed twice on 2026-07-26: `git checkout <branch> && <work>`
// where the checkout FAILED and the tail ran anyway on the wrong branch — once
// committing work-in-progress under a wrong message. The shell's `&&` guards
// exit codes, not intent: a failed switch leaves you somewhere, and the tail
// neither knows nor cares where.
//
// Blocks: a Bash command in which `git [-C <dir>] checkout|switch` sits at a
// COMMAND POSITION and is followed by a separator (&& ; || or a NEWLINE — in
// bash a newline separates commands exactly like `;`) with more to run.
// File restores (`checkout -- <path>` / `checkout <ref> -- <path>`) are exempt.
//
// The command-position anchor exists because this hook's FIRST live firing was
// a false positive: \b matched `git` inside a heredoc's prose documenting this
// very rule, and then blocked its own fix. Accepted residuals, both directions,
// stated rather than implied: a heredoc LINE that itself begins with
// `git checkout … ;` still trips (rare; costs a re-run), and `env`/`time`/
// VAR=1-prefixed or quoted (`sh -c "…"`) switches pass unblocked (a shell
// parser, not a regex, would be needed; the hook is a guardrail, not a jail).
//
// FAIL-OPEN ON A DEADLINE (issue #214): a hook must never wedge a tool call.
// Reading stdin only until 'end' measurably never exits when the harness holds
// stdin open — the sibling durable-claim hook documents the same measurement —
// so: settle on a 2s watchdog, DECIDE ON WHATEVER ARRIVED (a dangerous payload
// that arrived before the deadline is still denied — a watchdog that discarded
// the buffer would make the guard silently inert), and release stdin so the
// process can actually exit.
const STDIN_WATCHDOG_MS = 2000;

let raw = '';
let settled = false;
process.stdin.setEncoding('utf8');

function decide() {
  if (settled) return;
  settled = true;
  process.stdin.pause();
  process.stdin.unref?.();
  try {
    const cmd = String(JSON.parse(raw)?.tool_input?.command ?? '');
    const switchThenMore =
      /(?:^|\n|&&|\|\||[;|(]|\bthen\b|\bdo\b)\s*(?:command\s+)?git\s+(?:-[Cc]\s+\S+\s+)*(checkout|switch)\b(?![^&;|\n]*\s--\s)[^&;|\n]*(?:&&|;|\|\||\n)/.test(
        cmd,
      );
    if (switchThenMore) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'ADR-0070 §5: a branch switch chained with more commands ran its tail on the wrong ' +
              'branch twice on 2026-07-26 (a failed checkout does not stop `;` or a newline, and ' +
              '`&&` does not tell the tail where it is). Run the switch as its OWN command, confirm ' +
              'the branch, then run the rest. File restores (`git checkout -- <path>`) are not blocked.',
          },
        }),
      );
      return;
    }
  } catch {
    /* fail open */
  }
  process.stdout.write('{}');
}

process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', decide);
process.stdin.on('error', decide); // a broken pipe must fail open too
setTimeout(decide, STDIN_WATCHDOG_MS).unref?.();
