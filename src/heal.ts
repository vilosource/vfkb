// Brain healing at session start — the ONE place every harness face calls.
//
// ADR-0064 §2 put journal recovery in the Claude Code session-start hook, and
// RFC-034 §2 names that hook literally — so the pi face and `kb_resume` never
// healed (issue #205). That was survivable while pi was experimental; it is not
// now that the pi package is delivered and proven (ADR-0066): a pi-only
// consumer whose uncommitted brain is destroyed by a careless git operation had
// no recovery path at all, while a Claude consumer in the same repo did.
//
// This module exists rather than exporting the logic from journal.ts because
// storage.ts already imports journal.ts — pulling withExclusive/writeMeta into
// journal.ts would close an import cycle. Nothing imports this but the faces.
//
// THE NOTE IS THE LOUD CHANNEL. A restore that nobody is told about is a silent
// mutation of the knowledge base: hook stderr is not reliably surfaced, so the
// report rides the injected digest, where the agent (and through it the
// operator) actually sees it. Every face therefore renders the note IN FRONT OF
// the resume payload, and must call heal BEFORE rendering so the restored
// entries are in the render.

import { recoverFromJournal } from './journal.js';
import { brainDir, withExclusive, writeMeta } from './storage.js';

/**
 * Recover journaled entries lost from entries.jsonl, and return the operator
 * note to prepend to the session's injection ('' when nothing was restored).
 *
 * Fail-open by contract: recovery must never cost a session its start, so every
 * error is swallowed. Idempotent (recoverFromJournal restores nothing on a
 * second pass), so calling it on every injection is safe.
 */
export function healBrain(brain: string = brainDir()): string {
  try {
    const rec = withExclusive(() => recoverFromJournal(brain));
    if (rec.restored <= 0) return '';
    // Restores bypass appendRecord (no re-journaling loop), so refresh the
    // freshness meta here — a long-lived index consumer must not keep serving
    // a pre-restore view.
    writeMeta();
    return (
      `⚠ vfkb restored ${rec.restored} journaled entr${rec.restored === 1 ? 'y' : 'ies'} ` +
      `lost from entries.jsonl — likely a destructive git operation on uncommitted brain ` +
      `state (ADR-0064). Verify with kb_list and commit the brain on your next topic branch.\n\n`
    );
  } catch {
    return ''; // fail-open — recovery must never error a session start
  }
}
