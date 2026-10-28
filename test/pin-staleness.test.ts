// RFC-043 Part 0 (ADR-0084 §5; vfkb#386) — the standing gate for the anchor rule (decide D3).
//
// Every row of the prototype table (anchor-proto.sh, 18 cases) and of round 4 (r4-cases.sh,
// r4-shallow.sh) is rebuilt here with REAL git, the same shell lines as the probe scripts,
// and the production function is asserted to return the EXACT ordered set S (subjects,
// newest first). Expected values are transcribed from the B′ column of
// docs/research/probes/stop-nudge-2026-10-19/rfc043-review/sandbox/r4/bp-all.created.out
// and r4-cases.created.out / r4-shallow.created.out (the `created`-key re-run). They are
// never parsed from those files (decide D3: the fixture must stay readable on its own).
//
// Disclosed-miss rows (11, N1–N4, N6) are asserted QUIET on purpose: a future change to them
// must be a deliberate edit here, with a brain decision (RFC-043 DoD).

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cachedPinStaleness,
  computePinStaleness,
  defaultGit,
  escapeRegex,
  PIN_STALENESS_RULE,
  staleRepoRoot,
  type GitRunner,
} from '../src/pin-staleness.js';
import { handoffIsStale, pinnedHandoff } from '../src/stop-reminder.js';
import { latestHandoff } from '../src/engine.js';

// Real git across ~40 sandbox repos: generous per-test limits so a loaded machine is not a
// false red (the suite runs files in parallel).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// ── the shell harness: the probe's own helpers, byte-for-byte where it matters ────────────
const PRE = String.raw`
set +e
c(){ GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q --allow-empty -m "$2"; }
entry(){ printf '{"id":"%s","type":"fact","text":"t","tags":["%s"],"created":"%s","updated":"%s"}\n' "$1" "$3" "${'$'}{4:-$2}" "$2" >> .vfkb/entries.jsonl; }
fresh(){ cd "$WORK"; rm -rf "$1"; mkdir "$1"; cd "$1"; git init -q -b main; mkdir .vfkb; echo a>a; git add -A; c 2026-01-01T00:00:00Z init; }
`;

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

let WORK = '';
beforeAll(() => {
  WORK = mkdtempSync(join(tmpdir(), 'vfkb-p0-'));
});

/** Run a shell step in `dir` (relative to WORK) with the probe helpers loaded. */
function sh(script: string, dir = '.'): void {
  execFileSync('bash', ['-c', PRE + `cd "$WORK/${dir}" 2>/dev/null || cd "$WORK"\n` + script], {
    cwd: WORK,
    env: { ...process.env, ...GIT_ENV, WORK },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

const subjectsOf = (cwd: string, brain: string, id: string, created: string, git?: GitRunner): string[] | null => {
  const r = computePinStaleness(cwd, brain, { id, created }, { git, deadline: performance.now() + 30_000 });
  return r ? r.commits.map((c) => c.subject) : null;
};

interface Row {
  row: string;
  /** shell run before the assertion, inside the case repo (after `setup`) */
  step?: string;
  id: string;
  created: string;
  expected: string[];
  /** cwd relative to WORK (default: the case dir) */
  cwd?: string;
  /** brain path relative to WORK (default: <cwd>/.vfkb) */
  brain?: string;
  /** today's boolean (the pre-#386 tree diff), recorded for the RED observation */
  today: boolean;
}
interface Case {
  dir: string;
  setup: string;
  rows: Row[];
}

const Q = [] as string[]; // readability: an expected-quiet set

// The prototype's 18 rows (anchor-proto.sh), then round 4 (r4-cases.sh, r4-shallow.sh).
const CASES: Case[] = [
  {
    dir: 'squash',
    setup: `fresh squash; git switch -q -c topic
entry P1 2026-01-02T00:00:00.000Z handoff; git add -A; c 2026-01-02T01:00:00Z "topic: pin"
echo b>b; git add -A; c 2026-01-03T00:00:00Z "topic: code after pin"
git switch -q main; git merge -q --squash topic; c 2026-01-04T00:00:00Z "squash topic (#1)"`,
    rows: [
      { row: '1 squash carries pin', id: 'P1', created: '2026-01-02T00:00:00.000Z', expected: Q, today: true },
      {
        row: '1b squash, then another PR',
        step: 'echo x>x; git add -A; c 2026-01-05T00:00:00Z "squash other (#2)"',
        id: 'P1',
        created: '2026-01-02T00:00:00.000Z',
        expected: ['squash other (#2)'],
        today: true,
      },
    ],
  },
  {
    dir: 'noff',
    setup: `fresh noff; git switch -q -c t2
entry P2 2026-01-05T00:00:00.000Z handoff; git add -A; c 2026-01-05T01:00:00Z "t2: pin"
git switch -q main; GIT_COMMITTER_DATE=2026-01-06T00:00:00Z GIT_AUTHOR_DATE=2026-01-06T00:00:00Z git merge -q --no-ff t2 -m "merge t2"`,
    rows: [{ row: '2 no-ff merge carries pin', id: 'P2', created: '2026-01-05T00:00:00.000Z', expected: Q, today: false }],
  },
  {
    // ADR-0082 §2 / ADR-0084 §5.1: under `created` keys the retag keeps P3's first created.
    dir: 'retag',
    setup: `fresh retag; entry P3 2026-01-02T00:00:00.000Z fact; git add -A; c 2026-01-02T01:00:00Z "P3 first version"
echo c>c; git add -A; c 2026-01-07T00:00:00Z code1
echo d>d; git add -A; c 2026-01-08T00:00:00Z code2
entry P3 2026-01-09T00:00:00.000Z handoff 2026-01-02T00:00:00.000Z; git add -A; c 2026-01-09T01:00:00Z "retag P3"`,
    rows: [
      { row: '3 retagged old entry', id: 'P3', created: '2026-01-02T00:00:00.000Z', expected: ['code2', 'code1'], today: true },
      {
        row: '3b retagged, then code',
        step: 'echo e>e; git add -A; c 2026-01-10T00:00:00Z code3',
        id: 'P3',
        created: '2026-01-02T00:00:00.000Z',
        expected: ['code3', 'code2', 'code1'],
        today: true,
      },
    ],
  },
  {
    dir: 'uncommitted',
    setup: `fresh uncommitted; echo b>b; git add -A; c 2026-01-02T00:00:00Z "code before pin"
entry P4 2026-01-03T00:00:00.000Z handoff`,
    rows: [
      { row: '4 uncommitted pin, nothing after', id: 'P4', created: '2026-01-03T00:00:00.000Z', expected: Q, today: false },
      {
        row: '4b uncommitted pin, code committed after',
        step: 'echo k>k; git add k; c 2026-01-04T00:00:00Z "code after pin"',
        id: 'P4',
        created: '2026-01-03T00:00:00.000Z',
        expected: ['code after pin'],
        today: true,
      },
    ],
  },
  {
    dir: 'case2',
    setup: `fresh case2; git switch -q -c feat; echo f>f; git add -A; c 2026-02-03T00:00:00Z "F feature (pre-pin)"
git switch -q main; echo p>p; git add -A; c 2026-02-02T00:00:00Z "P main (pre-pin)"
entry PX 2026-02-04T00:00:00.000Z handoff; git add -A; c 2026-02-04T12:00:00Z "C carries pin"
GIT_COMMITTER_DATE=2026-02-05T00:00:00Z GIT_AUTHOR_DATE=2026-02-05T00:00:00Z git merge -q --no-ff feat -m "M merge feat (post-pin)"`,
    rows: [
      {
        row: '5 committed pin, then true merge (R3-M1)',
        id: 'PX',
        created: '2026-02-04T00:00:00.000Z',
        expected: ['M merge feat (post-pin)'],
        today: true,
      },
    ],
  },
  {
    dir: 'case2u',
    setup: `fresh case2u; git switch -q -c feat; echo f>f; git add -A; c 2026-02-03T00:00:00Z "F feature (pre-pin)"
git switch -q main; echo p>p; git add -A; c 2026-02-02T00:00:00Z "P main (pre-pin)"
GIT_COMMITTER_DATE=2026-02-05T00:00:00Z GIT_AUTHOR_DATE=2026-02-05T00:00:00Z git merge -q --no-ff feat -m "M merge feat (post-pin)"
entry PU 2026-02-04T00:00:00.000Z handoff`,
    rows: [
      {
        row: '6 uncommitted pin, true merge after (R3-M2)',
        id: 'PU',
        created: '2026-02-04T00:00:00.000Z',
        expected: ['M merge feat (post-pin)'],
        today: true,
      },
    ],
  },
  {
    dir: 'case3',
    setup: `fresh case3; git switch -q -c topic
entry PE 2026-03-02T10:00:00.000Z handoff
echo k>k; git add k; c 2026-03-02T11:00:00Z "K code after the handoff"
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E session-end brain commit"`,
    rows: [
      {
        row: '7 handoff -> code -> brain commit (R3-B1)',
        id: 'PE',
        created: '2026-03-02T10:00:00.000Z',
        expected: ['K code after the handoff'],
        today: true,
      },
      {
        row: '7b ...then squash-merged to main',
        step: 'git switch -q main; git merge -q --squash topic; c 2026-03-03T00:00:00Z "squash topic (#3)"',
        id: 'PE',
        created: '2026-03-02T10:00:00.000Z',
        expected: Q,
        today: true,
      },
    ],
  },
  {
    dir: 'outside',
    setup: `fresh outside; rm -rf .vfkb; OUT=$WORK/outside-brain; rm -rf "$OUT"; mkdir -p "$OUT/.vfkb"
( cd "$OUT"; entry PO 2026-01-03T00:00:00.000Z handoff )
echo b>b; git add -A; c 2026-01-02T00:00:00Z "code before pin"`,
    rows: [
      {
        row: '8 outside-tree brain, nothing after',
        id: 'PO',
        created: '2026-01-03T00:00:00.000Z',
        brain: 'outside-brain/.vfkb',
        expected: Q,
        today: false,
      },
      {
        row: '8b outside-tree brain, code after',
        step: 'echo k>k; git add -A; c 2026-01-04T00:00:00Z "code after pin"',
        id: 'PO',
        created: '2026-01-03T00:00:00.000Z',
        brain: 'outside-brain/.vfkb',
        expected: ['code after pin'],
        today: true,
      },
    ],
  },
  {
    dir: 'rebase',
    setup: `fresh rebase; git switch -q -c topic
echo a1>a1; git add -A; c 2026-01-02T00:00:00Z "A1 topic code (pre-pin)"
entry PR 2026-01-03T00:00:00.000Z handoff; git add -A; c 2026-01-03T01:00:00Z "topic: pin"
git switch -q main; echo m1>m1; git add -A; c 2026-01-04T00:00:00Z "M1 main (post-pin)"
git switch -q topic; GIT_COMMITTER_DATE=2026-01-05T00:00:00Z git rebase -q main`,
    rows: [
      {
        row: '9 rebase onto main that moved after the pin',
        id: 'PR',
        created: '2026-01-03T00:00:00.000Z',
        expected: ['M1 main (post-pin)'],
        today: true,
      },
    ],
  },
  {
    dir: 'rebase0',
    setup: `fresh rebase0; git switch -q -c topic
echo a1>a1; git add -A; c 2026-01-02T00:00:00Z "A1 topic code (pre-pin)"
entry PR 2026-01-03T00:00:00.000Z handoff; git add -A; c 2026-01-03T01:00:00Z "topic: pin"
GIT_COMMITTER_DATE=2026-01-05T00:00:00Z git rebase -q --force-rebase main`,
    rows: [{ row: '9b force-rebase, no upstream change', id: 'PR', created: '2026-01-03T00:00:00.000Z', expected: Q, today: true }],
  },
  {
    // The hand-written root-brain line gets created = its updated (a first version), as in
    // rerun-created.sh.
    dir: 'root',
    setup: `fresh root; rm -rf .vfkb
printf '{"id":"PT","type":"fact","text":"t","tags":["handoff"],"created":"2026-01-03T00:00:00.000Z","updated":"2026-01-03T00:00:00.000Z"}\\n' > entries.jsonl
git add -A; c 2026-01-03T01:00:00Z "root: pin"`,
    rows: [
      { row: '10 root brain, committed pin', id: 'PT', created: '2026-01-03T00:00:00.000Z', brain: 'root', expected: Q, today: false },
      {
        row: '10b root brain, code after',
        step: 'echo k>k; git add -A; c 2026-01-04T00:00:00Z "code after pin"',
        id: 'PT',
        created: '2026-01-03T00:00:00.000Z',
        brain: 'root',
        expected: ['code after pin'],
        today: true,
      },
    ],
  },
  {
    dir: 'rebasemerge',
    setup: `fresh rebasemerge; git switch -q -c other
GIT_AUTHOR_DATE=2026-01-02T00:00:00Z GIT_COMMITTER_DATE=2026-01-02T00:00:00Z sh -c 'echo o>o; git add -A; git commit -q -m "O other PR (authored pre-pin)"'
git switch -q main; git switch -q -c topic
entry PB 2026-01-03T00:00:00.000Z handoff; git add -A; c 2026-01-03T01:00:00Z "topic: pin"
git switch -q main; GIT_COMMITTER_DATE=2026-01-04T00:00:00Z git cherry-pick other >/dev/null
git merge -q --squash topic; c 2026-01-05T00:00:00Z "squash topic (#4)"`,
    rows: [
      // The disclosed residual miss (RFC-043): asserted quiet so a change is deliberate.
      { row: '11 pre-pin-authored PR rebase-merged below carrier', id: 'PB', created: '2026-01-03T00:00:00.000Z', expected: Q, today: true },
    ],
  },
  // ── round 4 ──
  {
    dir: 'n1',
    setup: `fresh n1; git switch -q -c topic
entry Q1 2026-03-02T10:00:00.000Z handoff
echo k>k; git add -A; c 2026-03-02T11:00:00Z "K code+brain in one commit"`,
    rows: [{ row: 'N1 single mixed commit (disclosed: code inside the carrier)', id: 'Q1', created: '2026-03-02T10:00:00.000Z', expected: Q, today: true }],
  },
  {
    dir: 'n2',
    setup: `fresh n2; git switch -q -c topic
echo k>k; git add -A; c 2026-03-02T09:00:00Z "K code (authored pre-pin)"
entry Q2 2026-03-02T10:00:00.000Z handoff
echo k2>>k; git add k; GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git commit -q --amend --no-edit
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E brain commit"`,
    rows: [{ row: 'N2 amend (disclosed)', id: 'Q2', created: '2026-03-02T10:00:00.000Z', expected: Q, today: true }],
  },
  {
    dir: 'n3',
    setup: `fresh n3; git switch -q -c topic
entry Q3 2026-03-02T10:00:00.000Z handoff
echo k>k; git add k; GIT_AUTHOR_DATE=2026-03-01T00:00:00Z GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git commit -q -m "K --date in the past"
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E brain commit"`,
    rows: [{ row: 'N3 back-dated author (disclosed)', id: 'Q3', created: '2026-03-02T10:00:00.000Z', expected: Q, today: true }],
  },
  {
    dir: 'n4',
    setup: `fresh n4; git switch -q -c topic
echo a1>a1; git add -A; c 2026-03-02T09:00:00Z "A1 code (pre-pin)"
entry Q4 2026-03-02T10:00:00.000Z handoff
echo a2>>a1; git add a1; GIT_AUTHOR_DATE=2026-03-02T11:00:00Z GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git commit -q --fixup HEAD
GIT_COMMITTER_DATE=2026-03-02T11:30:00Z GIT_SEQUENCE_EDITOR=: git rebase -q -i --autosquash main
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E brain commit"`,
    rows: [{ row: 'N4 fixup autosquash (disclosed)', id: 'Q4', created: '2026-03-02T10:00:00.000Z', expected: Q, today: true }],
  },
  {
    dir: 'n5',
    setup: `fresh n5; git switch -q -c topic
echo a1>a1; git add -A; c 2026-03-02T09:00:00Z "A1 code (pre-pin)"
entry Q5 2026-03-02T10:00:00.000Z handoff
GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git rebase -q --force-rebase main`,
    // B′ (ADR-0084 §5.2): quiet. Plain rule B would list A1 — a missing B′ fails this row.
    rows: [{ row: 'N5 uncommitted pin, force-rebase (B′)', id: 'Q5', created: '2026-03-02T10:00:00.000Z', expected: Q, today: true }],
  },
  {
    dir: 'n5b',
    setup: `fresh n5b; git switch -q -c topic
echo a1>a1; git add -A; c 2026-03-02T09:00:00Z "A1 code (pre-pin)"
git switch -q main; echo m1>m1; git add -A; c 2026-03-02T10:30:00Z "M1 main (post-pin)"
git switch -q topic
entry Q5 2026-03-02T10:00:00.000Z handoff
GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git rebase -q main`,
    rows: [
      { row: 'N5b uncommitted pin, rebase onto moved main (B′)', id: 'Q5', created: '2026-03-02T10:00:00.000Z', expected: ['M1 main (post-pin)'], today: true },
    ],
  },
  {
    dir: 'n6',
    setup: `fresh n6; git switch -q -c b1; entry Q6 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "b1: pin"
git switch -q main; git switch -q -c b2; echo z>z; git add -A; c 2026-03-02T11:00:00Z "b2: code post-pin"
git switch -q main; git switch -q -c b3; echo y>y; git add -A; c 2026-03-02T11:10:00Z "b3: code post-pin"
git switch -q main; GIT_COMMITTER_DATE=2026-03-02T12:00:00Z GIT_AUTHOR_DATE=2026-03-02T12:00:00Z git merge -q --no-ff b1 b2 b3 -m "OCT octopus"`,
    rows: [{ row: 'N6 octopus carries pin (disclosed)', id: 'Q6', created: '2026-03-02T10:00:00.000Z', expected: Q, today: true }],
  },
  {
    dir: 'n7',
    setup: `fresh n7; git switch -q -c topic; echo t0>t0; git add -A; c 2026-03-01T00:00:00Z "T0 topic code (pre-pin)"
git switch -q main; git switch -q -c pr; entry Q7 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "pr: pin"
git switch -q main; git merge -q --squash pr; c 2026-03-02T11:00:00Z "S1 squash pr (carries pin)"
echo s2>s2; git add -A; c 2026-03-02T12:00:00Z "S2 other PR (post-pin)"
git switch -q topic; echo t1>t1; git add -A; c 2026-03-02T13:00:00Z "T1 topic code (post-pin)"
GIT_COMMITTER_DATE=2026-03-02T14:00:00Z GIT_AUTHOR_DATE=2026-03-02T14:00:00Z git merge -q --no-ff main -m "MM merge main into topic"`,
    rows: [{ row: 'N7 merge main into topic', id: 'Q7', created: '2026-03-02T10:00:00.000Z', expected: ['T1 topic code (post-pin)'], today: true }],
  },
  {
    // decide D2: a same-id re-version keeps its first created; the observed flip
    // quiet → STALE {K} is accepted (the pin's text still predates K).
    dir: 'n8',
    setup: `fresh n8; entry Q8 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "C1 pin v1"
echo k>k; git add -A; c 2026-03-02T11:00:00Z "K code"
entry Q8 2026-03-02T12:00:00.000Z handoff 2026-03-02T10:00:00.000Z; git add -A; c 2026-03-02T12:30:00Z "C2 pin v2"`,
    rows: [
      { row: 'N8 pin re-versioned after code (D2 flip)', id: 'Q8', created: '2026-03-02T10:00:00.000Z', expected: ['K code'], today: true },
      {
        row: 'N8b v3 uncommitted, HEAD holds v2 (D2 flip)',
        step: 'entry Q8 2026-03-02T13:00:00.000Z handoff 2026-03-02T10:00:00.000Z',
        id: 'Q8',
        created: '2026-03-02T10:00:00.000Z',
        expected: ['K code'],
        today: true,
      },
    ],
  },
  {
    dir: 'n9',
    setup: `fresh n9; git switch -q --orphan orph; git rm -rq --cached . ; rm -f a
entry Q9 2025-12-01T00:00:00.000Z handoff; git add -A; c 2026-01-02T00:00:00Z "orphan root carries pin"
echo k>k; git add -A; c 2026-01-03T00:00:00Z "K code"`,
    rows: [
      { row: 'N9 orphan, empty T, code after', id: 'Q9', created: '2025-12-01T00:00:00.000Z', expected: ['K code'], today: true },
      { row: 'N9b orphan, empty T, nothing after', step: 'git reset -q --hard HEAD~1', id: 'Q9', created: '2025-12-01T00:00:00.000Z', expected: Q, today: false },
    ],
  },
  {
    // +03:00 author date: 09:30Z is BEFORE u in UTC. A string compare would keep it.
    dir: 'n10',
    setup: `fresh n10; git switch -q -c topic
echo a1>a1; git add -A; GIT_AUTHOR_DATE=2026-03-02T12:30:00+03:00 GIT_COMMITTER_DATE=2026-03-02T12:30:00+03:00 git commit -q -m "A1 (09:30Z, pre-pin)"
entry Q10 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "C pin"
GIT_COMMITTER_DATE=2026-03-02T11:00:00Z git rebase -q --force-rebase main`,
    rows: [{ row: 'N10 +03:00 author date, instant compare', id: 'Q10', created: '2026-03-02T10:00:00.000Z', expected: Q, today: true }],
  },
  {
    dir: 'n11',
    setup: `fresh n11; git switch -q -c topic
entry Q11 2026-03-02T10:00:00.000Z handoff
echo k>k; git add k; c 2026-03-02T11:00:00Z "K code after the handoff"
git add .vfkb/entries.jsonl; c 2026-03-02T12:00:00Z "E brain commit"
git worktree add -q --detach ../n11-wt HEAD`,
    rows: [
      { row: 'N11 detached HEAD in a linked worktree', id: 'Q11', created: '2026-03-02T10:00:00.000Z', cwd: 'n11-wt', expected: ['K code after the handoff'], today: true },
    ],
  },
  {
    dir: 'n12',
    setup: `fresh n12; git clone -q . ../n12-up; cd ../n12-up; echo o>o; git add -A; c 2026-03-02T11:00:00Z "O upstream PR (post-pin)"; cd ../n12
entry Q12 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "C local brain commit"
git remote add up ../n12-up; git fetch -q up; GIT_COMMITTER_DATE=2026-03-02T12:00:00Z git rebase -q up/main`,
    rows: [{ row: 'N12 pull --rebase, upstream post-pin PR', id: 'Q12', created: '2026-03-02T10:00:00.000Z', expected: ['O upstream PR (post-pin)'], today: true }],
  },
  {
    // The shallow boundary (RFC-043 disclosure): the grafted root reads as the carrier.
    dir: 'sh',
    setup: `fresh sh-src
entry QS 2026-03-02T10:00:00.000Z handoff; git add -A; c 2026-03-02T10:30:00Z "C pin"
echo x>x; git add -A; c 2026-03-03T00:00:00Z "X post-pin code"
echo y>y; git add -A; c 2026-03-04T00:00:00Z "Y post-pin code"
cd "$WORK"; rm -rf sh; git clone -q --depth 2 "file://$WORK/sh-src" sh`,
    rows: [{ row: 'S1 shallow --depth 2 (disclosed: lists only Y)', id: 'QS', created: '2026-03-02T10:00:00.000Z', expected: ['Y post-pin code'], today: true }],
  },
];

describe('RFC-043 Part 0 — every prototype and round-4 row, exact set (created keys, B′)', () => {
  for (const k of CASES) {
    describe(k.dir, () => {
      beforeAll(() => sh(k.setup));
      for (const r of k.rows) {
        it(`${r.row} → ${r.expected.length ? `STALE {${r.expected.join('|')}}` : 'quiet'}`, () => {
          if (r.step) sh(r.step, k.dir);
          const cwd = join(WORK, r.cwd ?? k.dir);
          const brain = r.brain ? join(WORK, r.brain) : join(cwd, '.vfkb');
          expect(subjectsOf(cwd, brain, r.id, r.created)).toEqual(r.expected);
          // The boolean face agrees with the set.
          expect(handoffIsStaleFor(cwd, brain, r.id, r.created)).toBe(r.expected.length > 0);
        });
      }
    });
  }
});

/** The boolean through the cached path, for an explicit pin (no brain-file selection). */
function handoffIsStaleFor(cwd: string, brain: string, id: string, created: string): boolean {
  return (cachedPinStaleness(cwd, brain, { id, created }, { cache: false, deadline: performance.now() + 30_000 })?.commits.length ?? 0) > 0;
}

// The pre-#386 answers (the tree diff), kept beside each row: the rows where the rule
// changes the boolean are the ones the RED run observed failing (1, 7b, 9b, N5 and those
// the disclosed misses make quiet; 3 and N8 flipped already with #371's created key).
describe('the rows where Part 0 changes the boolean answer', () => {
  const changed = CASES.flatMap((k) => k.rows.filter((r) => r.today !== r.expected.length > 0).map((r) => r.row.split(' ')[0]));
  it('are exactly the cause-1 squash rows, the rebase rows and the disclosed silences', () => {
    expect(changed).toEqual(['1', '7b', '9b', '11', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N10']);
  });
});

// ── rule 1 (R3-M3): one selector ──────────────────────────────────────────────────────────
describe('rule 1 — B3 selects the pin with latestHandoff (R3-M3)', () => {
  it('an old handoff-tagged line plus a newer untagged version of the same id is NOT the pin', () => {
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-p0-sel-'));
    const L = (id: string, tags: string[], created: string, updated = created) =>
      JSON.stringify({
        id,
        type: 'fact',
        text: id,
        tags,
        zone: 'established',
        author: { role: 'human' },
        provenance: { status: 'verified', date: created },
        validity: { valid_from: created },
        created,
        updated,
      }) + '\n';
    writeFileSync(
      join(brain, 'entries.jsonl'),
      L('REALPIN', ['handoff'], '2026-01-01T09:00:00.000Z') +
        L('HIJACK', ['handoff'], '2026-01-01T10:00:00.000Z') +
        L('HIJACK', ['handoff-topic'], '2026-01-01T10:00:00.000Z', '2026-01-02T00:00:00.000Z'),
    );
    expect(pinnedHandoff(brain)?.id).toBe('REALPIN');
    const prev = process.env.VFKB_DIR;
    process.env.VFKB_DIR = brain;
    delete process.env.VFKB_DATA_DIR;
    try {
      expect(latestHandoff()?.id).toBe('REALPIN');
    } finally {
      process.env.VFKB_DIR = prev;
    }
  });
});

// ── regex escaping in the carrier lookup ─────────────────────────────────────────────────
describe('the carrier lookup escapes regex metacharacters', () => {
  it('escapeRegex covers . * [ ] $ ^ \\', () => {
    expect(escapeRegex('a.b*c[d]e$f^g\\h')).toBe('a\\.b\\*c\\[d\\]e\\$f\\^g\\\\h');
  });
  it('an id full of metacharacters still finds its own carrier and not a look-alike', () => {
    // `.` unescaped would let id "a.c" match a line for "abc"; `*` and `[` would break -G.
    sh(`fresh meta; git switch -q -c topic
printf '{"id":"abc","type":"fact","text":"t","tags":["handoff"],"created":"2026-01-02T00:00:00.000Z","updated":"2026-01-02T00:00:00.000Z"}\\n' >> .vfkb/entries.jsonl
git add -A; c 2026-01-02T01:00:00Z "look-alike line"
echo b>b; git add -A; c 2026-01-02T02:00:00Z "code between"
printf '{"id":"a.c*[x]$^","type":"fact","text":"t","tags":["handoff"],"created":"2026-01-02T00:00:00.000Z","updated":"2026-01-02T00:00:00.000Z"}\\n' >> .vfkb/entries.jsonl
git add -A; c 2026-01-02T03:00:00Z "real carrier"
git switch -q main; git merge -q --squash topic; c 2026-01-03T00:00:00Z "squash (#9)"`);
    const cwd = join(WORK, 'meta');
    // Squash carries the pin → quiet. A wrong (unescaped) pattern would miss the carrier or
    // pick the look-alike, and B′ would then list the squash.
    expect(subjectsOf(cwd, join(cwd, '.vfkb'), 'a.c*[x]$^', '2026-01-02T00:00:00.000Z')).toEqual([]);
  });
});

// ── failure at each step, through an injected git runner ─────────────────────────────────
describe('a failed lookup at each step degrades to its defined case', () => {
  const failing =
    (pred: (args: string[]) => boolean): GitRunner =>
    (args, cwd, o) => {
      if (pred(args)) throw new Error('injected failure');
      return defaultGit(args, cwd, o);
    };
  const at = (dir: string) => join(WORK, dir);
  beforeAll(() => {
    // re-use built repos: squash (1b state), rebase (9), uncommitted (4b state)
    for (const k of CASES.filter((c) => ['squash', 'rebase', 'uncommitted', 'case3'].includes(c.dir))) {
      sh(k.setup);
      for (const r of k.rows) if (r.step) sh(r.step, k.dir);
    }
  });

  it('toplevel fails everywhere → null (silent)', () => {
    const g = failing((a) => a[0] === 'rev-parse' && a[1] === '--show-toplevel');
    expect(subjectsOf(at('squash'), join(at('squash'), '.vfkb'), 'P1', '2026-01-02T00:00:00.000Z', g)).toBeNull();
  });
  it('rev-list for T throws → null, NOT an empty T (which would list from the root)', () => {
    const g = failing((a) => a[0] === 'rev-list' && a.includes('-1'));
    expect(subjectsOf(at('squash'), join(at('squash'), '.vfkb'), 'P1', '2026-01-02T00:00:00.000Z', g)).toBeNull();
  });
  it('show HEAD: fails → no carrier → B′ (the squash is listed, as today flags it)', () => {
    const g = failing((a) => a[0] === 'show');
    expect(subjectsOf(at('squash'), join(at('squash'), '.vfkb'), 'P1', '2026-01-02T00:00:00.000Z', g)).toEqual([
      'squash other (#2)',
      'squash topic (#1)',
    ]);
  });
  it('the -G carrier search fails → no carrier → B′', () => {
    const g = failing((a) => a.some((x) => x.startsWith('-G')));
    expect(subjectsOf(at('squash'), join(at('squash'), '.vfkb'), 'P1', '2026-01-02T00:00:00.000Z', g)).toEqual([
      'squash other (#2)',
      'squash topic (#1)',
    ]);
  });
  it('the S log fails → null (not stale)', () => {
    const g = failing((a) => a[0] === 'log' && a.some((x) => x.startsWith('--format=%H%x00')));
    expect(subjectsOf(at('squash'), join(at('squash'), '.vfkb'), 'P1', '2026-01-02T00:00:00.000Z', g)).toBeNull();
  });
  it('the ancestry lookup fails → every member it guards is dropped (toward silence)', () => {
    const g = failing((a) => a[0] === 'rev-list' && a.some((x) => x.endsWith('..HEAD')));
    expect(subjectsOf(at('rebase'), join(at('rebase'), '.vfkb'), 'PR', '2026-01-03T00:00:00.000Z', g)).toEqual([]);
  });
  it('an unreadable author date drops that commit', () => {
    const g: GitRunner = (args, cwd, o) => {
      const out = defaultGit(args, cwd, o);
      if (args[0] === 'log' && args.some((x) => x.startsWith('--format=%H%x00')))
        return out.replace(/\0\d+\0/g, '\0garbage\0');
      return out;
    };
    expect(subjectsOf(at('uncommitted'), join(at('uncommitted'), '.vfkb'), 'P4', '2026-01-03T00:00:00.000Z', g)).toEqual([]);
  });
  it('an unparsable pin created → null', () => {
    expect(subjectsOf(at('squash'), join(at('squash'), '.vfkb'), 'P1', 'not-a-date')).toBeNull();
  });
});

// ── decide D10: the repo is cwd's, else the in-tree brain's ──────────────────────────────
describe('staleRepoRoot (decide D10)', () => {
  const b = () => ({ left: () => 10_000 }) as never;
  it('cwd in a repo → cwd root', () => {
    const r = staleRepoRoot(join(WORK, 'case3'), join(WORK, 'case3', '.vfkb'), defaultGit, b());
    expect(r && existsSync(r)).toBe(true);
  });
  it('cwd not a repo + in-tree brain → the brain repo root', () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'vfkb-p0-norepo-'));
    const r = staleRepoRoot(notRepo, join(WORK, 'case3', '.vfkb'), defaultGit, b());
    expect(r).toBeTruthy();
    expect(subjectsOf(notRepo, join(WORK, 'case3', '.vfkb'), 'PE', '2026-03-02T10:00:00.000Z')).not.toBeNull();
  });
  it('cwd not a repo + standalone brain (own .git) → undefined', () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'vfkb-p0-norepo-'));
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-p0-standalone-'));
    execFileSync('git', ['init', '-q'], { cwd: brain });
    expect(staleRepoRoot(notRepo, brain, defaultGit, b())).toBeUndefined();
  });
  it('cwd not a repo + brain whose parent is not a repo → undefined', () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'vfkb-p0-norepo-'));
    const brain = join(notRepo, '.vfkb');
    mkdirSync(brain);
    expect(staleRepoRoot(notRepo, brain, defaultGit, b())).toBeUndefined();
  });
});

// ── decide D1: the per-brain cache ───────────────────────────────────────────────────────
describe('the (pin, created, HEAD, toplevel, brainRel) cache (decide D1)', () => {
  const counting = () => {
    const calls: string[][] = [];
    const git: GitRunner = (args, cwd, o) => {
      calls.push(args);
      return defaultGit(args, cwd, o);
    };
    return { calls, git };
  };
  const repo = () => {
    const dir = `cache-${Math.random().toString(36).slice(2, 8)}`;
    sh(`fresh ${dir}
entry PC 2026-01-02T00:00:00.000Z handoff; git add -A; c 2026-01-02T01:00:00Z "pin"
echo k>k; git add -A; c 2026-01-03T00:00:00Z "K after pin"`);
    const cwd = join(WORK, dir);
    return { dir, cwd, brain: join(cwd, '.vfkb') };
  };
  const pin = { id: 'PC', created: '2026-01-02T00:00:00.000Z' };
  const cacheFile = (brain: string) => join(brain, '.signals', 'pin-staleness.json');

  it('the same key: exactly the two rev-parse calls, no recompute', () => {
    const { cwd, brain } = repo();
    expect(cachedPinStaleness(cwd, brain, pin)?.commits.map((c) => c.subject)).toEqual(['K after pin']);
    const { calls, git } = counting();
    expect(cachedPinStaleness(cwd, brain, pin, { git })?.commits.map((c) => c.subject)).toEqual(['K after pin']);
    expect(calls).toEqual([
      ['rev-parse', '--show-toplevel'],
      ['rev-parse', 'HEAD'],
    ]);
  });
  it('a moved HEAD recomputes', () => {
    const { dir, cwd, brain } = repo();
    cachedPinStaleness(cwd, brain, pin);
    sh('echo m>m; git add -A; c 2026-01-04T00:00:00Z "M later"', dir);
    const { calls, git } = counting();
    expect(cachedPinStaleness(cwd, brain, pin, { git })?.commits.map((c) => c.subject)).toEqual(['M later', 'K after pin']);
    expect(calls.length).toBeGreaterThan(2);
  });
  it('a new pin recomputes', () => {
    const { cwd, brain } = repo();
    cachedPinStaleness(cwd, brain, pin);
    const { calls, git } = counting();
    expect(cachedPinStaleness(cwd, brain, { id: 'PC2', created: '2026-01-05T00:00:00.000Z' }, { git })?.commits).toEqual([]);
    expect(calls.length).toBeGreaterThan(2);
  });
  it('a corrupt cache file recomputes and is rewritten', () => {
    const { cwd, brain } = repo();
    cachedPinStaleness(cwd, brain, pin);
    writeFileSync(cacheFile(brain), '{not json');
    expect(cachedPinStaleness(cwd, brain, pin)?.commits.map((c) => c.subject)).toEqual(['K after pin']);
    const raw = JSON.parse(readFileSync(cacheFile(brain), 'utf8'));
    expect(raw.key.rule).toBe(PIN_STALENESS_RULE);
    expect(raw.commits.map((c: { subject: string }) => c.subject)).toEqual(['K after pin']);
  });
  it('a cached value for another toplevel is never served', () => {
    const { cwd, brain } = repo();
    cachedPinStaleness(cwd, brain, pin);
    const raw = JSON.parse(readFileSync(cacheFile(brain), 'utf8'));
    raw.key.toplevel = '/somewhere/else';
    raw.commits = [{ hash: 'f'.repeat(40), short: 'fffffff', subject: 'POISON' }];
    writeFileSync(cacheFile(brain), JSON.stringify(raw));
    expect(cachedPinStaleness(cwd, brain, pin)?.commits.map((c) => c.subject)).toEqual(['K after pin']);
  });
  it('a cache write that fails still returns the result', () => {
    if (process.getuid?.() === 0) return; // root ignores the mode bits
    const { cwd, brain } = repo();
    mkdirSync(join(brain, '.signals'), { recursive: true });
    chmodSync(join(brain, '.signals'), 0o500);
    try {
      expect(cachedPinStaleness(cwd, brain, pin)?.commits.map((c) => c.subject)).toEqual(['K after pin']);
      expect(existsSync(cacheFile(brain))).toBe(false);
    } finally {
      chmodSync(join(brain, '.signals'), 0o700);
    }
  });
  it('a failed (timed-out) computation is not cached; the next run computes', () => {
    const { cwd, brain } = repo();
    let t = 0;
    const now = () => t;
    const git: GitRunner = (args, c, o) => {
      const out = defaultGit(args, c, o);
      if (args[0] === 'rev-list') t = 10_000; // the clock jumps past the deadline mid-run
      return out;
    };
    expect(cachedPinStaleness(cwd, brain, pin, { git, now, deadline: 1500 })).toBeNull();
    expect(existsSync(cacheFile(brain))).toBe(false);
    expect(cachedPinStaleness(cwd, brain, pin)?.commits.map((c) => c.subject)).toEqual(['K after pin']);
  });
});

// ── decide D8: one shared budget ─────────────────────────────────────────────────────────
describe('the shared 1.5 s budget (decide D8)', () => {
  it('past the deadline, no further git child is spawned and the answer is null', () => {
    sh(`fresh budget
entry PB 2026-01-02T00:00:00.000Z handoff; git add -A; c 2026-01-02T01:00:00Z "pin"
echo k>k; git add -A; c 2026-01-03T00:00:00Z "K"`);
    const cwd = join(WORK, 'budget');
    const calls: string[][] = [];
    let t = 0;
    const git: GitRunner = (args, c, o) => {
      calls.push(args);
      const out = defaultGit(args, c, o);
      if (calls.length === 2) t = 2_000;
      return out;
    };
    expect(
      cachedPinStaleness(cwd, join(cwd, '.vfkb'), { id: 'PB', created: '2026-01-02T00:00:00.000Z' }, { git, now: () => t, deadline: 1500, cache: false }),
    ).toBeNull();
    expect(calls.length).toBe(2);
  });
  it('a fractional time left still yields a valid child timeout (the #385 ERR_OUT_OF_RANGE)', () => {
    const cwd = join(WORK, 'budget');
    const seen: number[] = [];
    const git: GitRunner = (args, c, o) => {
      seen.push(o.timeout);
      return defaultGit(args, c, { ...o, timeout: 30_000 });
    };
    cachedPinStaleness(cwd, join(cwd, '.vfkb'), { id: 'PB', created: '2026-01-02T00:00:00.000Z' }, { git, now: () => 0, deadline: 0.4, cache: false });
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(Number.isInteger(s) && s >= 1).toBe(true);
  });
});

describe('a hung git is cut at the budget (decide D8)', () => {
  it('git that sleeps 10 s → null within ~1.5 s, and the render is byte-identical to no provider', async () => {
    const { renderContextBundle, addEntry } = await import('../src/engine.js');
    const { gitPinStalenessProvider } = await import('../src/pin-staleness.js');
    const bin = mkdtempSync(join(tmpdir(), 'vfkb-p0-slowgit-'));
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec sleep 10\n');
    chmodSync(join(bin, 'git'), 0o755);
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-p0-slowbrain-'));
    const prev = { path: process.env.PATH, dir: process.env.VFKB_DIR, data: process.env.VFKB_DATA_DIR };
    process.env.VFKB_DIR = brain;
    delete process.env.VFKB_DATA_DIR;
    try {
      addEntry('fact', 'a pin', { role: 'human', tags: ['handoff'] });
      const base = renderContextBundle('t');
      process.env.PATH = `${bin}:${prev.path}`;
      const t0 = performance.now();
      const out = renderContextBundle('t', undefined, { pinStaleness: gitPinStalenessProvider(join(WORK, 'case3'), brain) });
      const wall = performance.now() - t0;
      expect(out).toBe(base);
      expect(wall).toBeLessThan(2500);
      expect(existsSync(join(brain, '.signals', 'pin-staleness.json'))).toBe(false); // failure not cached
    } finally {
      process.env.PATH = prev.path;
      if (prev.dir === undefined) delete process.env.VFKB_DIR;
      else process.env.VFKB_DIR = prev.dir;
      if (prev.data !== undefined) process.env.VFKB_DATA_DIR = prev.data;
    }
  });
});

describe('handoffIsStale stays the boolean face', () => {
  it('reads the pin from the brain and answers from Part 0', () => {
    const cwd = join(WORK, 'case3');
    sh(CASES.find((c) => c.dir === 'case3')!.setup);
    // the probe brain lines are minimal (no zone/author); pinnedHandoff materializes them
    expect(handoffIsStale(cwd, join(cwd, '.vfkb'))).toBe(true);
  });
});
