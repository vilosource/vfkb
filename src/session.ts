// Per-session state, isolated by session id (mykb L4: a single global pointer
// let concurrent sessions clobber each other). State lives under <brain>/.sessions/
// <id>.json — under the brain mount (survives container restart), NOT /tmp. Without
// a session id, state is in-memory only (single-session default; nothing to clobber).
//
// ADR-0039 (v2 session backbone): the id normally comes from the HARNESS — Claude Code
// delivers `session_id` on every hook's stdin JSON, and the hooks thread it here via
// effectiveSessionId(). KB_SESSION_ID is an optional OVERRIDE (for harnesses that
// can't supply stdin the same way), not the only path. Verified 2026-07-06 (CLI
// v2.1.201): the stdin id is stable across `claude -p --resume` turns of one
// conversation, so records keyed on it accumulate correctly.
//
// ADR-0020 (session-continuity): each session's file is ONE record in an append-only
// log (per-session-id → never clobbered across sessions). The record carries the
// SIGNALS of the session (injected/captured ids, turn count, timestamps, an optional
// asserted operator note + asserted caller signals) — NOT a prose summary. The resume
// DIGEST is DERIVED from these signals against the live brain at render time
// (engine.renderResume), so it cannot go stale.

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { brainDir } from './storage.js';

function now(): string {
  return new Date().toISOString();
}

// ADR-0039: resolve the effective session id for a hook invocation.
// KB_SESSION_ID (when set) OVERRIDES the harness-supplied stdin id.
export function effectiveSessionId(payloadId?: string): string | undefined {
  return process.env.KB_SESSION_ID || payloadId || undefined;
}

// Best-effort git branch at session start (identity surface, ADR-0039). The hooks run
// at the session cwd (the repo); outside a work tree this is undefined, never a throw.
function currentBranch(): string | undefined {
  try {
    const r = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], {
      encoding: 'utf8',
      timeout: 2000,
    });
    const b = (r.stdout || '').trim();
    return r.status === 0 && b ? b : undefined;
  } catch {
    return undefined;
  }
}

export interface SessionSignal {
  label: string;
  value: string;
}

export interface SessionData {
  sessionId?: string;
  startedAt: string;
  lastAt: string;
  turnCount: number;
  injectedIds: string[];
  capturedIds: string[]; // Tier-B captured tool-call entry ids this session
  note?: string; // optional ASSERTED operator intent ("next: …")
  signals?: SessionSignal[]; // optional ASSERTED caller signals (commit/test verdicts)
  // Identity/attribution surface (ADR-0039) — captured when the record is CREATED
  // (session start), preserved on subsequent loads: which agent, on which branch,
  // from which process, produced this session's work.
  agentRole?: string; // e.g. "executor" — from $VFKB_AGENT_ROLE when the harness sets it
  agentLabel?: string; // free-form label — from $VFKB_AGENT_LABEL when set
  branch?: string; // git branch at session start (best-effort)
  pid?: number; // pid of the process that created the record
}

export class SessionState {
  private data: SessionData;
  private injected = new Set<string>();
  private captured = new Set<string>();
  private file: string | null;
  readonly sessionId?: string;

  private constructor(file: string | null, sessionId?: string) {
    this.file = file;
    this.sessionId = sessionId;
    const ts = now();
    this.data = {
      sessionId,
      startedAt: ts,
      lastAt: ts,
      turnCount: 0,
      injectedIds: [],
      capturedIds: [],
      // Identity surface (ADR-0039) — stamped at record creation, best-effort.
      agentRole: process.env.VFKB_AGENT_ROLE || undefined,
      agentLabel: process.env.VFKB_AGENT_LABEL || undefined,
      branch: currentBranch(),
      pid: process.pid,
    };
    if (file && existsSync(file)) {
      try {
        const loaded = JSON.parse(readFileSync(file, 'utf8')) as Partial<SessionData>;
        this.data = {
          sessionId,
          startedAt: loaded.startedAt ?? ts,
          lastAt: loaded.lastAt ?? ts,
          turnCount: loaded.turnCount ?? 0,
          injectedIds: loaded.injectedIds ?? [],
          capturedIds: loaded.capturedIds ?? [],
          note: loaded.note,
          signals: loaded.signals,
          // preserve the CREATION-time identity; never restamp on later loads
          agentRole: loaded.agentRole,
          agentLabel: loaded.agentLabel,
          branch: loaded.branch,
          pid: loaded.pid,
        };
        this.injected = new Set(this.data.injectedIds);
        this.captured = new Set(this.data.capturedIds);
      } catch {
        /* corrupt session file → start fresh */
      }
    }
  }

  static load(sessionId = process.env.KB_SESSION_ID): SessionState {
    if (!sessionId) return new SessionState(null); // ephemeral, in-memory only
    const dir = join(brainDir(), '.sessions');
    const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
    return new SessionState(join(dir, `${safe}.json`), sessionId);
  }

  // The CONCURRENT-SESSION REGISTRY (ADR-0039 §4): every persisted session record
  // against this brain, newest-first by lastAt. This is the surface other mechanisms
  // consult to ask "which other sessions are/were active against this brain" —
  // e.g. ADR-0040's lock logs its holder against it, and a future contradiction
  // check can scope "concurrent" by [startedAt, lastAt] overlap. Append-only: one
  // file per session id, never a shared mutable singleton.
  static records(): SessionData[] {
    const dir = join(brainDir(), '.sessions');
    if (!existsSync(dir)) return [];
    const out: SessionData[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as SessionData);
      } catch {
        /* skip a corrupt record */
      }
    }
    return out.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  }

  isInjected(id: string): boolean {
    return this.injected.has(id);
  }
  markInjected(ids: string[]): void {
    for (const id of ids) this.injected.add(id);
  }
  recordCaptured(id: string): void {
    this.captured.add(id);
  }
  get capturedIds(): string[] {
    return [...this.captured];
  }
  setNote(text: string): void {
    this.data.note = text;
  }
  addSignal(label: string, value: string): void {
    (this.data.signals ??= []).push({ label, value });
  }
  bumpTurn(): void {
    this.data.turnCount++;
  }
  get turnCount(): number {
    return this.data.turnCount;
  }
  get startedAt(): string {
    return this.data.startedAt;
  }

  save(): void {
    if (!this.file) return; // ephemeral
    this.data.sessionId = this.sessionId;
    this.data.lastAt = now();
    this.data.injectedIds = [...this.injected];
    this.data.capturedIds = [...this.captured];
    const dir = join(brainDir(), '.sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data), 'utf8');
  }
}
