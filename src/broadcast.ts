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
import { writeManifest } from './manifest.js';
import { defaultProject } from './storage.js';
import { SCHEMA_VERSION } from './version.js';

export interface BroadcastResult {
  target: string;
  ok: boolean;
  id?: string;
  /** git commit posture — the durability summary ADR-0063 §3 requires */
  posture?: string;
  reason?: string;
  /** true when a wired-but-manifest-less brain had its manifest engine-written first (#193) */
  healed?: boolean;
}

/** The resident-pin tags a broadcast record must never carry (ADR-0063 §1). */
const FORBIDDEN_TAGS = new Set(['handoff', 'next']);

function targetBrainDir(target: string): string {
  const abs = resolve(target);
  return basename(abs) === '.vfkb' ? abs : join(abs, '.vfkb');
}

function gitPosture(repoDir: string): string {
  const git = (...a: string[]) =>
    execFileSync('git', ['-C', repoDir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    const parked = branch === 'main' || branch === 'master';
    return `uncommitted; target on ${branch}${parked ? ' (parked — rides until a topic-branch brain commit)' : ''}`;
  } catch {
    // rev-parse HEAD fails on a repo with no commits yet — distinguish that
    // from "not a repo at all" (review finding: unborn HEAD was misreported).
    try {
      if (git('rev-parse', '--is-inside-work-tree') === 'true') {
        return 'uncommitted; target git repository on an unborn branch (no commits yet)';
      }
    } catch {
      /* fall through */
    }
    return 'uncommitted; target not a git repository';
  }
}

/**
 * Broadcast one record to N target brains. Origin is derived from the INVOKING
 * repo's project label, captured before any env switching. Targets without a
 * brain are refused (never bootstrap a wire-less brain — ADR-0063 §3): no
 * `entries.jsonl` means wire-less; a wired brain merely missing its
 * `manifest.json` (plugin-born, vfkb#193) is healed, visibly. Brains whose
 * schema the running engine does not support are refused (promoting doctor's
 * diagnostic to a hard refusal).
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
  // No-double-stamp applies only to a COMPLETE marker (op + date + origin) —
  // a bare "CROSS-REPO " prefix must not waive the stamping this command
  // exists to mechanize (review finding: the loose prefix test let a record
  // land with no origin and no date, the ADR-0051 §3 quiet-success shape).
  const MARKER = /^CROSS-REPO \S+ \(\d{4}-\d{2}-\d{2}, from [^)]+\):/;
  const stamped = MARKER.test(text) ? text : `CROSS-REPO ${op} (${date}, from ${origin}): ${text}`;

  const results: BroadcastResult[] = [];
  const written = new Set<string>();
  for (const target of targets) {
    const brain = targetBrainDir(target);
    // "Exactly one record per affected repo" (ADR-0063 §1) also holds across
    // path spellings of the same target within one broadcast.
    if (written.has(brain)) {
      results.push({ target, ok: false, reason: 'duplicate target (already written in this broadcast)' });
      continue;
    }
    const repoDir = resolve(brain, '..');
    const manifestPath = join(brain, 'manifest.json');
    let healed = false;
    if (!existsSync(manifestPath)) {
      // §3's rule is "never bootstrap a WIRE-LESS brain". A brain with a live
      // entries.jsonl is wired — the manifest is just missing because only
      // `vfkb init` ever writes it (plugin-born brains, vfkb#193). Heal it
      // (engine-written stamp) instead of refusing; refuse only when there are
      // no entries at all, which is the true wire-less case.
      if (!existsSync(join(brain, 'entries.jsonl'))) {
        results.push({ target, ok: false, reason: `no brain (no entries.jsonl in ${brain}) — never bootstrap a wire-less brain (ADR-0063 §3)` });
        continue;
      }
      try {
        writeManifest(brain);
      } catch (err) {
        // Per-target and loud, never a thrown abort — a heal failure on one
        // target must not swallow the rest of a partial broadcast.
        results.push({ target, ok: false, reason: `manifest heal failed: ${(err as Error).message}` });
        continue;
      }
      healed = true;
    }
    let schema: unknown;
    try {
      schema = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { schema_version?: unknown }).schema_version;
    } catch {
      results.push({ target, ok: false, reason: 'unreadable manifest.json' });
      continue;
    }
    if (schema !== SCHEMA_VERSION) {
      results.push({ target, ok: false, reason: `brain schema ${JSON.stringify(schema)} unsupported by engine schema v${SCHEMA_VERSION}` });
      continue;
    }
    // brainDir() resolves VFKB_DATA_DIR fresh on every call (the RFC-013/033
    // verified transport), so an env swap scopes the engine write to the target.
    const prev = process.env.VFKB_DATA_DIR;
    try {
      process.env.VFKB_DATA_DIR = brain;
      const e = addEntry('fact', stamped, { role: 'executor', tags: [...new Set(['cross-repo', ...extraTags])] });
      written.add(brain);
      results.push({ target, ok: true, id: e.id, posture: gitPosture(repoDir), ...(healed ? { healed } : {}) });
    } catch (err) {
      // healed still reported on failure — the manifest stamp happened even
      // though the record did not land (heal is never silent).
      results.push({ target, ok: false, reason: (err as Error).message, ...(healed ? { healed } : {}) });
    } finally {
      if (prev === undefined) delete process.env.VFKB_DATA_DIR;
      else process.env.VFKB_DATA_DIR = prev;
    }
  }
  return results;
}
