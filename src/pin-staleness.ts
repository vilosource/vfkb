// RFC-043 Part 0 (accepted by ADR-0084 §5; vfkb#386): which commits came after the pinned
// handoff, never counting the one that carries it. The git layer — the engine stays
// git-free and receives this as an injected `PinStalenessProvider` (Part A).
//
// Capability DEMONSTRATED by scenarios/records/stale-handoff-anchor.json (Parts 0/1) and
// scenarios/records/stale-pin-floor.json (Part A), on settings-file wiring. Delivery through
// the plugin is unproven until its install-path record is re-pinned (ADR-0051).
//
// One computation feeds three surfaces, so they cannot disagree: B3 on Stop (stale iff S is
// non-empty), the UserPromptSubmit line, and Part A's list under `## Last handoff`.
//
// The rule, as RFC-043 Part 0 states it, with ADR-0084 §5's settled points. Inputs: the pin
// p (the engine's `latestHandoff`, ADR-0082 §2), u = p.created, the brain's pathspec.
//   2. T = rev-list -1 --first-parent --before=u HEAD (may be empty: the pin predates history).
//   3. Carrier C: when HEAD's committed brain holds a line with p.id AND p.created, the first
//      first-parent commit whose diff adds that id+created (`log -G`). Otherwise no carrier.
//   4. S = the first-parent commits in [T..]HEAD that touch non-brain paths.
//   5. Drop C itself. With a carrier, drop members that are ancestors of C authored at or
//      before u (a rebase re-dates committer dates, keeps author dates). With NO carrier
//      (B′, ADR-0084 §5.2), drop every member authored at or before u. Instants, never strings.
//   6. Stale iff S is non-empty.
//
// Decide-step outcomes implemented here (ruling 54802539cda7; brain decisions on the #386
// branch): D1 the single-entry cache file `<brain>/.signals/pin-staleness.json`; D8 one
// shared 1.5 s deadline from provider entry, failures not cached; D10 cwd-first repo
// resolution with an in-tree-brain fallback.
//
// Hosts (decide D9): rule 5's squash case assumes a squash commit's author date is the
// merge time — git's own `merge --squash` default, observed on GitHub. GitLab and Bitbucket
// are UNVERIFIED (Tier-0 probe: vfkb#400). A host that kept the original
// author date could only make this quieter (like RFC-043 case 11), never noisier.
//
// Failure posture is RFC-043's: every failure is toward silence. `null` means "unknown"
// (no annotation, B3 quiet) and is never cached.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { PinStalenessProvider, StaleCommit } from './engine.js';
import type { KnowledgeEntry } from './types.js';
import { GIT_READ_MAX_BUFFER } from './git-buffer.js';
import { realPath, relativeReal } from './realpath.js';
import { COMMITTED_BRAIN_PATHS } from './storage.js';

export type { StaleCommit } from './engine.js';

/** Throws on any failure (non-zero exit, timeout, spawn error). Injectable for tests. */
export type GitRunner = (args: string[], cwd: string, o: { timeout: number; maxBuffer?: number }) => string;

export const defaultGit: GitRunner = (args, cwd, o) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: o.timeout,
    maxBuffer: o.maxBuffer,
  });

/** Decide D8: one shared deadline per computation, from provider entry. */
export const PIN_STALENESS_BUDGET_MS = 1500;

/** Bumped whenever the rule changes, so a cached answer from an older rule is never served. */
export const PIN_STALENESS_RULE = 'rfc043-part0/bprime/created/1';

export interface PinRef {
  id: string;
  created: string;
}

export interface PinStalenessOpts {
  git?: GitRunner;
  /** a `now()` instant past which nothing more is spawned and the answer is `null` */
  deadline?: number;
  /** monotonic clock, ms (default `performance.now`) */
  now?: () => number;
  /** false → neither read nor write the cache file (tests) */
  cache?: boolean;
}

export interface PinStalenessResult {
  /** Part 0's S, newest first. Empty → not stale. */
  commits: StaleCommit[];
}

export interface PinStalenessKey {
  rule: string;
  id: string;
  created: string;
  head: string;
  toplevel: string;
  brainRel: string;
}

// child_process rejects a fractional timeout (ERR_OUT_OF_RANGE) — the #385 lesson: a raw
// `performance.now()` difference silently disabled every git read there.
export const ms = (t: number): number => Math.max(1, Math.floor(t));

/** BRE metacharacters for `git log -G` (`.` is the one real ids/dates carry). */
export const escapeRegex = (s: string): string => s.replace(/[.[\]*^$\\]/g, '\\$&');

class Budget {
  readonly deadline: number;
  readonly now: () => number;
  constructor(o: PinStalenessOpts) {
    this.now = o.now ?? (() => performance.now());
    this.deadline = o.deadline ?? this.now() + PIN_STALENESS_BUDGET_MS;
  }
  /** ms left, or throws when none: the pre-call check, so a spent budget spawns nothing. */
  left(): number {
    const l = this.deadline - this.now();
    if (l <= 0) throw new Error('pin-staleness: budget spent');
    return ms(l);
  }
}

/**
 * Decide D10: the repo whose commits are counted. cwd first (the hook faces' cwd is the
 * session cwd, and a standalone brain's own repo holds only brain files, so brain-first
 * would make S structurally empty). Only when cwd is not in a repo, and the brain is
 * in-tree (no `.git` of its own), the brain's owning repo. Otherwise `undefined`.
 */
export function staleRepoRoot(cwd: string, brain: string, run: GitRunner, b: Budget): string | undefined {
  try {
    return run(['rev-parse', '--show-toplevel'], cwd, { timeout: b.left() }).trim() || undefined;
  } catch {
    /* fall through */
  }
  if (existsSync(join(brain, '.git'))) return undefined;
  try {
    return run(['rev-parse', '--show-toplevel'], dirname(realPath(brain)), { timeout: b.left() }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The brain's place in the repo, moved here unchanged from `handoffIsStale`. Three shapes;
 * each of the first two was a live defect when it was wrong, because a wrong pathspec does
 * not error — it silently answers "no non-brain change".
 */
export function brainPathspec(root: string, brain: string): { brainRel: string; paths: string[]; ent: string | null } {
  // relativeReal, not relative: git's root is a realpath and `brain` may not be.
  const brainRel = relativeReal(root, brain);
  if (brainRel === '') {
    // ROOT brain (VFKB_DATA_DIR=.): `:(exclude)` with an empty pattern excludes everything,
    // so exclude the brain's committed PATHS instead (the shared list).
    return { brainRel, paths: ['.', ...COMMITTED_BRAIN_PATHS.map((f) => `:(exclude)${f}`)], ent: 'entries.jsonl' };
  }
  if (brainRel === '..' || brainRel.startsWith('../') || isAbsolute(brainRel)) {
    // OUTSIDE the worktree (a `<repo>/.vfkb` symlinked to a standalone brain): nothing in
    // this tree to exclude, and no carrier can exist (B′ applies).
    return { brainRel, paths: ['.'], ent: null };
  }
  return { brainRel, paths: ['.', `:(exclude)${brainRel}`], ent: `${brainRel}/entries.jsonl` };
}

/** Does HEAD's committed brain hold the pin's version (its id AND its created)? Parsed, not grepped. */
function pinInHead(text: string, pin: PinRef): boolean {
  for (const line of text.split('\n')) {
    if (!line.includes(pin.id)) continue;
    try {
      const r = JSON.parse(line) as { id?: unknown; created?: unknown };
      if (r.id === pin.id && r.created === pin.created) return true;
    } catch {
      /* a malformed line is not the pin */
    }
  }
  return false;
}

interface Prepared {
  root: string;
  paths: string[];
  ent: string | null;
  uMs: number;
  key: PinStalenessKey;
}

/** The cache key's inputs: repo root, brain pathspec, HEAD. `null` → silent. Throws on budget. */
function prepare(cwd: string, brain: string, pin: PinRef, run: GitRunner, b: Budget): Prepared | null {
  const uMs = Date.parse(pin.created);
  if (!pin.id || !Number.isFinite(uMs)) return null;
  const root = staleRepoRoot(cwd, brain, run, b);
  if (!root) return null;
  const { brainRel, paths, ent } = brainPathspec(root, brain);
  const head = run(['rev-parse', 'HEAD'], root, { timeout: b.left() }).trim();
  if (!head) return null;
  return { root, paths, ent, uMs, key: { rule: PIN_STALENESS_RULE, id: pin.id, created: pin.created, head, toplevel: root, brainRel } };
}

/**
 * Part 0 for one pin, no cache. `null` = unknown (toplevel/HEAD/T/S failed, or the budget
 * ran out) → silent. `{commits: []}` = not stale.
 */
export function computePinStaleness(
  cwd: string,
  brain: string,
  pin: PinRef,
  opts: PinStalenessOpts = {},
): (PinStalenessResult & { key: PinStalenessKey }) | null {
  const run = opts.git ?? defaultGit;
  const b = new Budget(opts);
  try {
    const p = prepare(cwd, brain, pin, run, b);
    if (!p) return null;
    return { ...computeFromKey(p.root, p.paths, p.ent, pin, p.uMs, run, b), key: p.key };
  } catch {
    return null; // a step that must succeed failed, or the budget ran out → silent
  }
}

function computeFromKey(
  root: string,
  paths: string[],
  ent: string | null,
  pin: PinRef,
  uMs: number,
  run: GitRunner,
  b: Budget,
): PinStalenessResult {
  // 2. First-parent timestamp anchor. A throw here is a failure (→ null), NOT an empty T:
  //    an empty T lists from the root.
  const T = run(['rev-list', '-1', '--first-parent', `--before=${pin.created}`, 'HEAD'], root, { timeout: b.left() }).trim();
  // 3. Carrier. Every failure here means "no carrier" — rule 5 then runs B′.
  let C = '';
  if (ent) {
    try {
      const atHead = run(['show', `HEAD:${ent}`], root, { timeout: b.left(), maxBuffer: GIT_READ_MAX_BUFFER });
      if (pinInHead(atHead, pin)) {
        const pattern = `"id":"${escapeRegex(pin.id)}".*"created":"${escapeRegex(pin.created)}"`;
        C =
          run(['log', '--first-parent', '--reverse', '--format=%H', `-G${pattern}`, 'HEAD', '--', ent], root, {
            timeout: b.left(),
          })
            .split('\n')
            .find((l) => l.trim())
            ?.trim() ?? '';
      }
    } catch (e) {
      if (b.deadline - b.now() <= 0) throw e; // out of budget is a failure, not "no carrier"
      C = '';
    }
  }
  // 4. Candidates, with author dates and subjects in one call.
  const range = T ? `${T}..HEAD` : 'HEAD';
  const raw = run(['log', '--first-parent', '--format=%H%x00%at%x00%s', range, '--', ...paths], root, {
    timeout: b.left(),
  });
  const S = raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => {
      const [hash, at, ...rest] = l.split('\0');
      return { hash, at: Number(at), subject: rest.join('\0') };
    })
    .filter((c) => /^[0-9a-f]{7,}$/.test(c.hash));
  // 5. Drops. Ancestors of C among S: S is on HEAD's first-parent chain and so is C, so a
  //    member is an ancestor of C iff it is NOT in C..HEAD's first-parent list (one call,
  //    instead of a merge-base per member). A failed lookup drops every member it guards.
  let newerThanC: Set<string> | null = null;
  if (C) {
    try {
      newerThanC = new Set(
        run(['rev-list', '--first-parent', `${C}..HEAD`], root, { timeout: b.left() })
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      );
    } catch (e) {
      if (b.deadline - b.now() <= 0) throw e;
      newerThanC = null;
    }
  }
  const authoredByU = (at: number): boolean => !Number.isFinite(at) || at * 1000 <= uMs; // unreadable → drop
  const kept = S.filter((c) => {
    if (C) {
      if (c.hash === C) return false; // the carrier itself
      if (newerThanC === null) return false; // ancestry unknown → drop (toward silence)
      const ancestorOfC = !newerThanC.has(c.hash);
      return !(ancestorOfC && authoredByU(c.at));
    }
    return !authoredByU(c.at); // B′: no carrier, no ancestry condition
  });
  b.left(); // a result that finished past the deadline is still "over budget" → null
  return { commits: kept.map((c) => ({ hash: c.hash, short: c.hash.slice(0, 7), subject: c.subject })) };
}

// ── the cache (decide D1) ────────────────────────────────────────────────────────────────

const cachePath = (brain: string): string => join(brain, '.signals', 'pin-staleness.json');

const sameKey = (a: PinStalenessKey, b: unknown): boolean => {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return (Object.keys(a) as (keyof PinStalenessKey)[]).every((k) => o[k] === a[k]);
};

function readCache(brain: string, key: PinStalenessKey): StaleCommit[] | undefined {
  try {
    const raw = JSON.parse(readFileSync(cachePath(brain), 'utf8')) as { key?: unknown; commits?: unknown };
    if (!sameKey(key, raw.key) || !Array.isArray(raw.commits)) return undefined;
    const ok = raw.commits.every(
      (c) =>
        c &&
        typeof c === 'object' &&
        typeof (c as StaleCommit).hash === 'string' &&
        typeof (c as StaleCommit).short === 'string' &&
        typeof (c as StaleCommit).subject === 'string',
    );
    return ok ? (raw.commits as StaleCommit[]) : undefined;
  } catch {
    return undefined; // absent, unparsable, wrong shape → recompute
  }
}

function writeCache(brain: string, key: PinStalenessKey, commits: StaleCommit[]): void {
  try {
    mkdirSync(join(brain, '.signals'), { recursive: true });
    const f = cachePath(brain);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ key, commits, computedAt: new Date().toISOString() }), 'utf8');
    renameSync(tmp, f);
  } catch {
    /* a failed write costs a recompute next time, never the answer */
  }
}

/**
 * Part 0 with the per-brain cache in front. A hit costs `rev-parse --show-toplevel`,
 * `rev-parse HEAD` and one small file read (RFC-043 Part A's Cost paragraph, for pi). Only
 * completed results are cached; a timed-out or failed computation writes nothing.
 */
export function cachedPinStaleness(
  cwd: string,
  brain: string,
  pin: PinRef,
  opts: PinStalenessOpts = {},
): PinStalenessResult | null {
  const run = opts.git ?? defaultGit;
  const b = new Budget(opts);
  try {
    const p = prepare(cwd, brain, pin, run, b);
    if (!p) return null;
    if (opts.cache !== false) {
      const hit = readCache(brain, p.key);
      if (hit) return { commits: hit };
    }
    const res = computeFromKey(p.root, p.paths, p.ent, pin, p.uMs, run, b);
    if (opts.cache !== false) writeCache(brain, p.key, res.commits);
    return res;
  } catch {
    return null;
  }
}

/** The Part A provider for one checkout: pin → S, or null. Shared by every face. */
export function gitPinStalenessProvider(
  cwd: string,
  brain: string,
  opts: Omit<PinStalenessOpts, 'deadline'> = {},
): PinStalenessProvider {
  // The deadline starts when the provider is CALLED (decide D8), not when it is built.
  return (pin: KnowledgeEntry) => cachedPinStaleness(cwd, brain, { id: pin.id, created: pin.created }, opts)?.commits ?? null;
}
