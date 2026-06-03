// Per-session state, isolated by KB_SESSION_ID (mykb L4: a single global pointer
// let concurrent sessions clobber each other). State lives under <brain>/.sessions/
// <id>.json — under the brain mount (survives container restart), NOT /tmp. Without
// a session id, state is in-memory only (single-session default; nothing to clobber).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { brainDir } from './storage.js';

interface SessionData {
  injectedIds: string[];
  turnCount: number;
}

export class SessionState {
  private data: SessionData = { injectedIds: [], turnCount: 0 };
  private injected = new Set<string>();
  private file: string | null;

  private constructor(file: string | null) {
    this.file = file;
    if (file && existsSync(file)) {
      try {
        this.data = JSON.parse(readFileSync(file, 'utf8')) as SessionData;
        this.injected = new Set(this.data.injectedIds);
      } catch {
        /* corrupt session file → start fresh */
      }
    }
  }

  static load(sessionId = process.env.KB_SESSION_ID): SessionState {
    if (!sessionId) return new SessionState(null); // ephemeral, in-memory only
    const dir = join(brainDir(), '.sessions');
    return new SessionState(join(dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`));
  }

  isInjected(id: string): boolean {
    return this.injected.has(id);
  }
  markInjected(ids: string[]): void {
    for (const id of ids) this.injected.add(id);
  }
  bumpTurn(): void {
    this.data.turnCount++;
  }
  get turnCount(): number {
    return this.data.turnCount;
  }

  save(): void {
    if (!this.file) return; // ephemeral
    this.data.injectedIds = [...this.injected];
    const dir = join(brainDir(), '.sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data), 'utf8');
  }
}
