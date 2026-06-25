// Per-session state, isolated by KB_SESSION_ID (mykb L4: a single global pointer
// let concurrent sessions clobber each other). State lives under <brain>/.sessions/
// <id>.json — under the brain mount (survives container restart), NOT /tmp. Without
// a session id, state is in-memory only (single-session default; nothing to clobber).
//
// ADR-0020 (session-continuity): each session's file is ONE record in an append-only
// log (per-session-id → never clobbered across sessions). The record carries the
// SIGNALS of the session (injected/captured ids, turn count, timestamps, an optional
// asserted operator note + asserted caller signals) — NOT a prose summary. The resume
// DIGEST is DERIVED from these signals against the live brain at render time
// (engine.renderResume), so it cannot go stale.

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { brainDir } from './storage.js';

function now(): string {
  return new Date().toISOString();
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

  // The append-only record log: every persisted session record, newest-first by lastAt.
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
