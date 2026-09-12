// Path comparison against git's answers. Node stdlib only, no project imports —
// the durability journal depends on this, and that module deliberately carries
// no engine dependencies.
//
// WHY THIS EXISTS. `git rev-parse --show-toplevel` (and every other path git
// prints) is a REALPATH: git resolves symlinks before it answers. Paths the
// engine holds are whatever the caller spelled — `VFKB_DATA_DIR`, `cwd`,
// `mkdtempSync(tmpdir())`. The moment either side traverses a symlink the two
// spellings disagree, and `relative()`/`resolve()` compare spellings, not
// inodes. `resolve()` does NOT resolve symlinks; only `realpathSync` does.
//
// The failure is silent and one-directional — `relative()` returns a path that
// climbs OUT of the repo (`../../../var/folders/…`), which git then reports as
// "no such path", i.e. an ordinary negative answer. Nothing throws. Every
// caller reads it as "not committed" / "nothing changed" / "not the repo root":
//
//   - journal.ts  — prune saw no pair as committed, so the WAL grew forever.
//   - stop-reminder.ts — the stale-handoff nudge (ADR-0034) never fired.
//   - doctor.ts   — `brainIsRoot` was false for a root brain, firing the FAIL
//                   whose remedy is "remove <path>/.git": the project's own
//                   history, on a healthy repo.
//
// This is NOT a macOS curiosity. macOS makes it constant (`/var` → `/private/var`,
// so every `tmpdir()` path is symlinked), which is why the test suite failed only
// there — but any symlinked checkout hits it on any platform, including the
// `~/VFKB/<name>` layout this project's own onboarding creates.
//
// The lesson was already written down three times in this codebase before these
// three sites missed it: `git.ts insideSurroundingRepo` ("REALPATH FIRST"),
// `doctor.ts isUnder` ("a /tmp that resolves to /private/tmp compares honestly
// rather than by spelling"), and `.claude/vfkb-guard.mjs samePath`. Prefer these
// helpers over hand-rolling a fourth copy.

import { realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

/**
 * The path's real location — resolving as much of it as actually exists.
 *
 * `realpathSync` throws on a missing path, and callers routinely ask about files
 * that are about to be created (`<brain>/entries.jsonl` on a fresh brain), so a
 * fallback is required rather than defensive.
 *
 * That fallback must NOT be a bare `resolve()`. A missing leaf says nothing about
 * its ancestors, and it is the ancestors that carry the symlink: resolving only
 * the spelling of `<link>/repo/.vfkb/entries.jsonl` leaves `<link>` unresolved and
 * reproduces the very defect this module exists to remove, narrowed to the
 * fresh-brain case. So walk up to the nearest ancestor that DOES exist, realpath
 * that, and re-attach the missing tail. (Caught by this module's own test, which
 * asked for a path two segments deep that had not been created.)
 */
export function realPath(p: string): string {
  const abs = resolve(p);
  let head = abs;
  const tail: string[] = [];
  // A root directory always exists, so this terminates.
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return abs; // reached the root without a hit
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

/**
 * `path.relative(from, to)` with both sides realpath'd — for building a pathspec
 * or a repo-relative key out of a git-reported root and an engine-held path.
 *
 * Always returns POSIX separators: git pathspecs use `/` on every platform.
 */
export function relativeReal(from: string, to: string): string {
  return relative(realPath(from), realPath(to)).split(sep).join('/');
}

/** Do these two paths name the same location, symlinks and spelling aside? */
export function samePathReal(a: string, b: string): boolean {
  return realPath(a) === realPath(b);
}
