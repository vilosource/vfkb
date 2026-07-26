// Brain healing at session start — the ONE place every harness face calls.
//
// ADR-0064 §2 put journal recovery in the Claude Code session-start hook, and
// RFC-034 §2 names that hook literally — so the pi face, `kb_resume` and the
// `vfkb resume` verb never healed (issue #205). That was survivable while pi
// was experimental; it is not now that the pi package is delivered and proven
// (ADR-0066): a pi-only consumer whose uncommitted brain is destroyed by a
// careless git operation had no recovery path at all, while a Claude consumer
// in the same repo did. Amended by ADR-0069.
//
// This module exists rather than exporting the logic from journal.ts because
// storage.ts already imports journal.ts — pulling withExclusive/writeMeta into
// journal.ts would close an import cycle. Nothing imports this but the faces.
//
// THE NOTE IS THE LOUD CHANNEL. A restore that nobody is told about is a silent
// mutation of the knowledge base: hook stderr is not reliably surfaced, so the
// report rides the injected digest, where the agent (and through it the
// operator) actually sees it. Every face therefore renders the note IN FRONT OF
// the resume payload, and must heal BEFORE rendering so the restored entries
// are in the render.
//
// ONCE PER PROCESS, NOT PER TURN. The pi face's `before_agent_start` fires on
// every user message (verified in pi 0.73.1: emitted from the per-message path
// in agent-session.js, not once per session), and the wal is gitignored, so it
// survives `git switch`. Healing on every turn therefore re-appends entries
// committed only on another branch into whatever branch is checked out now —
// reproduced during review on a real checkout, where a single heal restored a
// foreign branch's entry into the working tree. Healing once per process
// restores the ADR-0064 cadence (a session-start event) on every face, and is
// the boundary a "session-start recovery" was always meant to have.

import { renderResume } from './engine.js';
import { recoverFromJournal } from './journal.js';
import { brainDir, withExclusive, writeMeta } from './storage.js';

/** Per-process latch — see "ONCE PER PROCESS" above. */
let healedThisProcess = false;

/** Test-only: forget the latch so a suite can exercise repeated heals. */
export function resetHealLatchForTests(): void {
  healedThisProcess = false;
}

/**
 * Recover journaled entries lost from entries.jsonl, and return the operator
 * note to prepend to the session's injection ('' when nothing was restored).
 *
 * Operates on the ambient brain (`brainDir()`) deliberately: the lock and the
 * freshness stamp are ambient too, so a `brain` parameter would recover one
 * brain while locking and stamping another — a trap for the cross-repo callers
 * of ADR-0063.
 *
 * Fail-open by contract: recovery must never cost a session its start, so every
 * error is swallowed and the caller gets ''.
 */
export function healBrain(): string {
  if (healedThisProcess) return '';
  healedThisProcess = true;
  try {
    const rec = withExclusive(() => recoverFromJournal(brainDir()));
    if (rec.restored <= 0) return '';
    // Build the note BEFORE any further I/O. writeMeta() can throw (read-only
    // mount, ENOSPC, a directory where the file should be — all reproduced in
    // review), and if that throw reached the outer catch the entries would be
    // restored while the note was swallowed: exactly the silent mutation this
    // module's header forbids.
    const note =
      `⚠ vfkb restored ${rec.restored} journaled entr${rec.restored === 1 ? 'y' : 'ies'} ` +
      `lost from entries.jsonl — likely a destructive git operation on uncommitted brain ` +
      `state (ADR-0064). Verify with kb_list and commit the brain on your next topic branch.\n\n`;
    try {
      // Restores bypass appendRecord (no re-journaling loop), so refresh the
      // freshness meta — a long-lived index consumer must not keep serving a
      // pre-restore view. A failure here degrades the INDEX, never the report.
      writeMeta();
    } catch {
      /* stale freshness stamp is survivable; a silent restore is not */
    }
    return note;
  } catch {
    return ''; // fail-open — recovery must never error a session start
  }
}

/**
 * The full session-start read: heal, then render — in that order, so restored
 * entries are in the render and the note leads it.
 *
 * Shared by every face that answers "where did we leave off": the `kb_resume`
 * MCP tool and the `vfkb resume` CLI verb. Having them call this rather than
 * `renderResume` directly is what stopped #205 from having a third and fourth
 * uncovered surface.
 */
export function resumePayload(project: string, session?: Parameters<typeof renderResume>[1]): string {
  const note = healBrain();
  return note + renderResume(project, session);
}
