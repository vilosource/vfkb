#!/usr/bin/env node
// PreToolUse[Bash] guard — a branch switch is never chained with mutations
// (ADR-0070 §5). Observed twice on 2026-07-26: `git checkout <branch> && <work>`
// where the checkout FAILED and the tail ran anyway on the wrong branch — once
// committing work-in-progress under a wrong message. The shell's `&&` guards
// exit codes, not intent: a failed switch leaves you somewhere, and the tail
// neither knows nor cares where.
//
// Blocks: a Bash command containing `git checkout`/`git switch` followed by a
// command separator (&& ; ||) with more to run after it. Branch-switch-only
// chains of pure reads would be safe, but distinguishing reads from writes in
// shell is a parser, not a regex — and the cost of splitting into two tool
// calls is one round trip. Deny with the remedy named.
//
// Fail-open everywhere else: a hook must never wedge a tool call (issue #214).
// Malformed stdin, no command, or anything unexpected → allow silently.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const cmd = String(JSON.parse(raw)?.tool_input?.command ?? '');
    // `git checkout -- <path>` restores files and switches nothing — the brain
    // recovery flows use it mid-chain legitimately; only branch switches chain
    // dangerously. `git checkout <ref> -- <path>` is also a file restore.
    // COMMAND-POSITION ANCHOR (learned on this hook's first live firing): the
    // guard blocked a command whose HEREDOC contained prose describing this very
    // rule — \b matched `git` inside quoted documentation, and then blocked the
    // fix to itself for the same reason. `git` only starts a command at the
    // string start or right after a separator/subshell/keyword, so anchor there.
    // Residual accepted: a heredoc LINE that itself begins with
    // "git checkout … ;" still trips — rare enough to pay for with a re-run.
    const switchThenMore =
      /(?:^|&&|\|\||[;|(]|\bthen\b|\bdo\b)\s*(?:command\s+)?git\s+(checkout|switch)\b(?![^&;|]*\s--\s)[^&;|]*(?:&&|;|\|\|)/.test(cmd);
    if (switchThenMore) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'ADR-0070 §5: a branch switch chained with more commands ran its tail on the wrong ' +
              'branch twice on 2026-07-26 (a failed checkout does not stop `;`, and `&&` does not ' +
              'tell the tail where it is). Run the switch as its OWN command, confirm the branch, ' +
              'then run the rest. File restores (`git checkout -- <path>`) are not blocked.',
          },
        }),
      );
      return;
    }
  } catch {
    /* fail open */
  }
  process.stdout.write('{}');
});
