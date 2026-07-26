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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { renderResume } from './engine.js';
import { recoverFromJournal } from './journal.js';
import { effectiveSessionId } from './session.js';
import { brainDir, withExclusive, writeMeta } from './storage.js';

/** Per-process latch — see "ONCE PER PROCESS" above. */
let healedThisProcess = false;

/**
 * A PROCESS latch is not enough on the pi tier, and that gap is the whole
 * reason this marker exists. `src/pi-mcp-bridge.ts` is connect-per-call: every
 * `kb_resume` spawns a fresh `dist/mcp-server.js`, so a fresh process gets a
 * fresh latch and heals again — the unbounded re-restore loop the latch was
 * supposed to close, on the tier it was built for.
 *
 * So the latch is backed by a marker in the brain:
 *   - when a session id is available (the Claude hook carries one in its
 *     payload), the marker keys on it — genuinely once per session, and a NEW
 *     session still heals immediately, so the Claude face loses nothing;
 *   - when there is none (a bridge-spawned MCP process), fall back to a time
 *     window, because "same session" is unknowable there and an unbounded loop
 *     is worse than a bounded delay.
 */
const MARKER_DEBOUNCE_MS = Number(process.env.VFKB_HEAL_DEBOUNCE_MS ?? 15 * 60 * 1000);
const markerPath = (brain: string) => join(brain, '.journal', '.healed');

/**
 * THE WALL CLOCK IS SCOPED TO ONE FACE, and getting that wrong was a silent
 * data-loss regression. An earlier version applied the time window to every
 * caller. But `effectiveSessionId()` reads only `$KB_SESSION_ID` or an argument
 * — the Claude hook's real session id arrives on **stdin** — so with no id
 * threaded through, every face fell to the clock, and a brand-new session
 * starting within the window did NOT recover a brain destroyed by
 * `git checkout --`. That is RFC-034 incident 1 going unrecovered, silently,
 * where the pre-#205 engine recovered it.
 *
 * So: a face that knows its session id keys on that (a new session always
 * heals). A face that is a fresh PROCESS PER CALL — only the MCP server as
 * spawned by pi's connect-per-call bridge — opts into the window explicitly,
 * because that is the one place an unbounded re-restore loop is possible and
 * "same session" is genuinely unknowable. Everything else heals, as it always did.
 */
function alreadyHealed(brain: string, sid: string | undefined, debounce: boolean): boolean {
  try {
    const raw = readFileSync(markerPath(brain), 'utf8');
    const m = JSON.parse(raw) as { sessionId?: string; at?: number };
    if (sid) return m.sessionId === sid;
    if (!debounce) return false; // fresh process, known session boundary → heal
    return typeof m.at === 'number' && Date.now() - m.at < MARKER_DEBOUNCE_MS;
  } catch {
    return false; // no marker, or unreadable → heal (fail toward recovery)
  }
}

function stampHealed(brain: string, sid: string | undefined): void {
  try {
    const p = markerPath(brain);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ sessionId: sid, at: Date.now() }), 'utf8');
  } catch {
    /* the marker is an optimisation, never a correctness requirement */
  }
}

/** Test-only: forget the latch so a suite can exercise repeated heals. */
export function resetHealLatchForTests(brain?: string): void {
  healedThisProcess = false;
  try {
    const b = brain ?? brainDir();
    if (existsSync(markerPath(b))) writeFileSync(markerPath(b), JSON.stringify({ at: 0 }), 'utf8');
  } catch {
    /* nothing to clear */
  }
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
export function healBrain(opts: { sessionId?: string; debounce?: boolean } = {}): string {
  if (healedThisProcess) return '';
  const brain = brainDir();
  // The caller's id wins: only it can know the harness payload's session id.
  const sid = opts.sessionId ?? effectiveSessionId();
  if (alreadyHealed(brain, sid, opts.debounce === true)) {
    healedThisProcess = true;
    return '';
  }
  try {
    const rec = withExclusive(() => recoverFromJournal(brain));
    // Latch on SUCCESS, not on entry: latching first meant one transient failure
    // (a raced lock, EBUSY) disabled healing for the rest of the process.
    healedThisProcess = true;
    stampHealed(brain, sid);
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
export function resumePayload(
  project: string,
  session?: Parameters<typeof renderResume>[1],
  opts: { sessionId?: string; debounce?: boolean } = {},
): string {
  const note = healBrain(opts);
  return note + renderResume(project, session);
}
