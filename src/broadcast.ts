// ADR-0063 §3 — `vfkb broadcast`: write one cross-repo record fact into each
// target repo's brain, through the engine, stamping mechanically what the v1
// convention leaves to discipline (the `cross-repo` tag, the CROSS-REPO marker
// with origin + date). Refusals are per-target and loud — a partial broadcast
// must be visible, never silent — and the writer NEVER commits the target
// (§4: the entry rides the target's own ADR-0033 discipline).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { addEntry } from './engine.js';
import { defaultProject } from './storage.js';
import { SCHEMA_VERSION } from './version.js';

export interface BroadcastResult {
  target: string;
  ok: boolean;
  id?: string;
  /** git commit posture — the durability summary ADR-0063 §3 requires */
  posture?: string;
  reason?: string;
}

/** The resident-pin tags a broadcast record must never carry (ADR-0063 §1). */
const FORBIDDEN_TAGS = new Set(['handoff', 'next']);

function targetBrainDir(target: string): string {
  const abs = resolve(target);
  return basename(abs) === '.vfkb' ? abs : join(abs, '.vfkb');
}

function gitPosture(repoDir: string): string {
  try {
    const git = (...a: string[]) =>
      execFileSync('git', ['-C', repoDir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    const parked = branch === 'main' || branch === 'master';
    return `uncommitted; target on ${branch}${parked ? ' (parked — rides until a topic-branch brain commit)' : ''}`;
  } catch {
    return 'uncommitted; target not a git repository';
  }
}

/**
 * Broadcast one record to N target brains. Origin is derived from the INVOKING
 * repo's project label, captured before any env switching. Targets without a
 * `.vfkb/manifest.json` are refused (never bootstrap a wire-less brain —
 * ADR-0063 §3), as are brains whose schema the running engine does not support
 * (promoting doctor's diagnostic to a hard refusal).
 */
export function broadcast(
  text: string,
  targets: string[],
  opts: { op?: string; tags?: string[] } = {},
): BroadcastResult[] {
  const origin = defaultProject();
  const date = new Date().toISOString().slice(0, 10);
  const extraTags = opts.tags ?? [];
  for (const t of extraTags) {
    if (FORBIDDEN_TAGS.has(t)) {
      throw new Error(
        `broadcast: tag '${t}' is forbidden on cross-repo records — it claims the resident's ADR-0049 continuity pin (ADR-0063 §1)`,
      );
    }
  }
  const op = (opts.op || 'OPERATION').toUpperCase();
  const stamped = /^CROSS-REPO /.test(text)
    ? text
    : `CROSS-REPO ${op} (${date}, from ${origin}): ${text}`;

  const results: BroadcastResult[] = [];
  for (const target of targets) {
    const brain = targetBrainDir(target);
    const repoDir = resolve(brain, '..');
    const manifestPath = join(brain, 'manifest.json');
    if (!existsSync(manifestPath)) {
      results.push({ target, ok: false, reason: `no brain (missing ${manifestPath}) — never bootstrap a wire-less brain (ADR-0063 §3)` });
      continue;
    }
    let schema: unknown;
    try {
      schema = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { schema_version?: unknown }).schema_version;
    } catch {
      results.push({ target, ok: false, reason: 'unreadable manifest.json' });
      continue;
    }
    if (schema !== SCHEMA_VERSION) {
      results.push({ target, ok: false, reason: `brain schema v${String(schema)} unsupported by engine schema v${SCHEMA_VERSION}` });
      continue;
    }
    // brainDir() resolves VFKB_DATA_DIR fresh on every call (the RFC-013/033
    // verified transport), so an env swap scopes the engine write to the target.
    const prev = process.env.VFKB_DATA_DIR;
    try {
      process.env.VFKB_DATA_DIR = brain;
      const e = addEntry('fact', stamped, { role: 'executor', tags: ['cross-repo', ...extraTags] });
      results.push({ target, ok: true, id: e.id, posture: gitPosture(repoDir) });
    } catch (err) {
      results.push({ target, ok: false, reason: (err as Error).message });
    } finally {
      if (prev === undefined) delete process.env.VFKB_DATA_DIR;
      else process.env.VFKB_DATA_DIR = prev;
    }
  }
  return results;
}
