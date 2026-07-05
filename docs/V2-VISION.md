# vfkb v2 — vision & design notes

**Status:** proposed / pre-RFC consolidation — nothing here is decided. This is the
brainstorm from a 2026-07-05 session written down so it isn't lost, structured so each
initiative can graduate into its own RFC. **Breaking changes are explicitly allowed** —
this is what `STATUS-AND-ROADMAP.md` and `CLAUDE.md`'s "Current state" section call
*the next fork*: H4 is complete, the in-repo frontier is exhausted, and re-ratifying the
roadmap is the acknowledged next step. Treat this doc as the opening move of that
re-ratification, not the ratification itself.

**How to read this:** §1 is the one architectural correction/insight worth understanding
before anything else, because several later initiatives build on it. §2 is the initiative
list itself. §3 is a rough sequencing note. §4 is explicit non-goals. None of it is an ADR
— per this repo's own process (decide-then-ADR, RFC = proposed decision), each initiative
that survives discussion should become a numbered RFC under `docs/rfc/` before it's built.

---

## 1. The session mechanism is already the right shape — it's just not switched on

This surfaced from a question worth recording precisely, because the first framing of it
was subtly off and the corrected version turns out to be a stronger foundation for v2 than
the original framing suggested.

**The question:** now that vfkb runs multiple parallel agent sessions against one
project's brain, can we reuse whatever mechanism used to disambiguate multiple *projects*
sharing one brain back in mykb?

**What's actually true, verified against `docs/IMPLEMENTATION-PLAN.md` §2 (the "Lessons
from mykb" record) and `src/session.ts`:**

- mykb's multi-*project* concern and its session-clobbering concern were **two separate
  lessons**, not one mechanism serving both. The multi-project concern (L-series "single
  central brain") was resolved by an entirely different, already-settled design axis:
  vfkb went **per-project brain** (`D2e`/`D2g` — flat, project = implicit scope, no
  in-brain project field at all). `VFKB_PROJECT` today is confirmed (grep of `src/`) to be
  nothing more than a human-readable label used by `vfkb doctor` to check `.mcp.json` and
  `.claude/settings.json` agree — it is not a disambiguation key on any stored entry.
- The mechanism that actually matters here is **lesson L4**, and it is *already* exactly
  about concurrent sessions, not projects:

  > **L4** — mykb did: one global `.active` workspace pointer. Taught: **concurrent
  > sessions silently clobber each other**. vfkb does: **per-session isolation via
  > `KB_SESSION_ID` from day one**, a file per session under the brain dir (survives
  > container restart, not `/tmp`).

  `src/session.ts`'s own header comment says the same thing verbatim: *"mykb L4: a single
  global pointer let concurrent sessions clobber each other."* `SessionState` already
  keys state as `<brain>/.sessions/<sessionId>.json` — one file per session id, never a
  shared mutable singleton — and `SessionState.records()` already reads back **every**
  persisted session record, sorted newest-first. That is, unadorned, **already a registry
  of concurrent sessions against this brain.**

**So the corrected version of the insight is stronger than the original:** this isn't "an
old mechanism built for a different problem that we could repurpose." It's a mechanism
**already purpose-built, from day one, for exactly the concurrent-multiple-sessions
problem** — it just isn't reliably engaged today. Verified in this session: none of the
four hook commands in this repo's own `.claude/settings.json` (`SessionStart`,
`PreToolUse`, `Stop`, `SessionEnd`) set `KB_SESSION_ID`. Per `SessionState.load()`, no id
→ ephemeral in-memory state, nothing persisted. This matches the already-recorded GAP-1
finding: *"KB_SESSION_ID is NOT set in this repo's live hook wiring... the only robust
state-free signal at hook time is the git-HEAD-delta of `entries.jsonl`."*

**The concrete v2 fix — and it's cheap:** Claude Code's hook stdin already carries a real
`session_id` on every invocation (verified earlier this session for the `Stop` and
`SessionEnd` payloads: `session_id, transcript_path, cwd, ...`). Nothing needs to *invent*
a session id or thread a new env var through hook command strings by hand — `cli hook
<sub>` should simply **read `session_id` from its own stdin JSON** and use that as
`KB_SESSION_ID` internally, instead of depending on an environment variable nothing
currently sets. This closes GAP-1 outright, for every session, with no harness-side
wiring change at all.

**Then widen the mechanism's job**, since it's already the right shape to carry more than
resume-digest bookkeeping:

- `SessionData` gains an identity/attribution surface (agent role/label if known, git
  branch at session start, pid) so every entry written during a session can be stamped
  with `session_id` — closing the "same git identity for every agent, no attribution
  trail" corner case from `docs/NOTES-multi-agent-concurrency-corner-cases.md` at the
  knowledge layer, independent of what git commit identity is used.
- `SessionState.records()` becomes the thing other v2 concurrency mechanisms *consult* —
  the advisory lock (§2.1) and any future contradiction check (RFC-012) can ask "which
  other sessions are active against this brain right now" instead of operating blind.

This is the one-line thesis for the rest of the document: **v2 doesn't need a new
concurrent-session concept. It needs to finally turn on the one that's already there, and
stop scoping it to resume bookkeeping alone.**

---

## 2. Initiatives

### 2.1 Concurrency & merge safety
Directly out of `docs/NOTES-multi-agent-concurrency-corner-cases.md`, now buildable on
top of §1's session backbone:

- **A git merge driver for `entries.jsonl`.** Verified empirically (this session): two
  branches independently appending to the tail of a JSONL file from a common ancestor
  *do* conflict on merge. A `.gitattributes` + small merge script that concatenates and
  orders (e.g. by each entry's own timestamp) instead of stopping turns a guaranteed
  manual-resolution point into a non-event.
- **A local advisory lock around `kb_add`/`kb_supersede`**, scoped to one `VFKB_DATA_DIR`,
  to close the TOCTOU gap where two processes each read-then-decide-then-append against a
  stale snapshot. Now that sessions are real (§1), the lock can be session-aware rather
  than a bare mutex — e.g. logging which session held it.
- **Stamp `session_id` (and, once known, `agent_id`) on every entry**, sourced from §1's
  now-reliable session state.

### 2.2 Schema honesty
Small in isolation, each a breaking change today, each a documented-but-silent gap:

- **Make `why` a real field.** Currently `cli.ts`'s `cleanText()` strips `--why <value>`
  before `addEntry` ever sees it; `AddOpts`/`KnowledgeEntry` have no such field; it only
  survives if the caller folds it into `text` by hand. Docs show `--why` as if it works —
  it doesn't (verified gotcha, this repo). v2 should give decisions a real `why` column.
- **Validate the whole envelope at the read boundary**, not just `tags` (which got a
  defensive default after a tagless entry crashed `index-store.ts`). Other optional
  fields (e.g. `validity.valid_until`) are still unguarded. A schema parse (zod, already a
  dependency) at ingestion kills this entire crash class permanently instead of patching
  it field-by-field as each one is discovered live.
- **Formalize contradiction/supersede fields** as real structure rather than inferring
  them from prose — gives RFC-012 (deterministic contradiction surfacing) a structural
  hook instead of text-sniffing.

### 2.3 Scale — the read path doesn't scale today
`readAll()` re-parses the entire `entries.jsonl` on every single call (verified this
session — no in-process cache, which is *why* cross-session visibility is already
correct, but it's also why this doesn't scale). Fine at hundreds of entries, not at tens
of thousands. Proposal: keep JSONL as the git-friendly, committed, append-only source of
truth, but add a real rebuildable index (same philosophy as today's gitignored
`index-meta.json` cache, just an actual query engine instead of a linear scan) rather than
re-reading and re-parsing the whole log per call.

### 2.4 Storage backend abstraction
The earlier "should the brain be hosted?" discussion concluded that a wholesale swap to a
hosted service fixes the write-time coordination and stale-visibility problems (§2.1's
TOCTOU gap, and cross-session staleness) but **reverses a principle already ratified in
two repos** — vfkb's own [ADR-0019](adr/ADR-0019-self-hosted-design-brain.md) ("the brain
ships with the repo") and vilonotes' `AGENTS.md` ("durable state lives only in this repo,
no shared volumes, no second source of truth") — and trades them for a single point of
failure, a need for real auth, and the loss of git's implicit review-gate (an entry is
only "real" once its PR merges).

Proposal for v2: don't pick a side — **define a pluggable storage-backend interface**.
JSONL-on-disk stays the default and is what ADR-0019 committed to. A project that
explicitly wants the hosted tradeoff (e.g. because it's hit the TOCTOU/staleness pain
hard enough to accept the tradeoffs) can opt into a different backend without vfkb forcing
one architecture on everyone. This also gives §2.3's index work a clean seam to land in.

### 2.5 Known warts, closed now that breaking changes are affordable
- **GAP-1, closed properly** — see §1. Not a new idea, just finally fixable at the root
  instead of patched with the B2 fallback-handoff floor RFC-011 shipped as a stopgap.
- **L4 evaluation records pin `image_digest`/timestamp globally** even when only one
  scenario in a multi-scenario suite was re-run, so a partial re-run can misrepresent a
  full-suite validation (verified gotcha, this repo). v2: make these fields per-scenario.
- **A first-class concurrent-writer test** in the unit/L4 pyramid. Nothing in the fast
  gate today simulates N processes hitting the brain at once — exactly the class of bug
  this whole line of discussion has been about. Given §1's session registry and §2.1's
  lock, this becomes straightforward to write deterministically (spawn N in-process
  writers against one temp brain dir, assert no lost entries / no crash).
- **Revisit RFC-003** (embedding reranker) — currently gated behind "a second live
  phrasing-robustness miss, or an explicit request." v2's breaking-changes freedom lowers
  the cost of building it proactively if semantic search is wanted as a v2 pillar rather
  than a bolt-on later. Not a recommendation to build it now — just noting the gate
  reasoning changes in a v2 context.

### 2.6 More speculative
- **Branch/scope tagging on entries** — let an entry declare "written on branch X, not
  yet merged" explicitly, rather than relying on git's line-merge behavior by accident.
  Directly motivated by corner cases #10 (prose-doc merge conflicts on singleton
  roadmap/plan files) and #12 (stale mental model across branches) in
  `docs/NOTES-multi-agent-concurrency-corner-cases.md`. Underspecified — needs its own
  design pass before it's RFC-able.

---

## 3. Rough sequencing (not a locked roadmap)

1. **§1 (session backbone) first.** It's cheap (read stdin, not a new subsystem), and
   §2.1's lock/attribution and §2.5's GAP-1 fix both depend on it existing.
2. **§2.2 (schema honesty)** can happen in parallel — it's independent of everything else
   here and each item (`why` field, envelope validation) is self-contained.
3. **§2.1 (merge driver + lock + attribution)** next, once §1 lands.
4. **§2.3/§2.4 (scale + backend abstraction)** are the biggest lift — sequence after the
   above are proven, since the backend interface should be shaped by real experience with
   the lock/attribution work, not designed speculatively ahead of it.
5. **§2.6** stays a note until there's a concrete trigger (a real cross-branch collision
   observed live), matching this repo's own "evidence-gated builds" rule.

## 4. Explicit non-goals for v2

- **Not** reviving a single shared brain across multiple projects — that axis is settled
  (per-project brain, `VFKB_PROJECT` stays a label, not a scope key).
- **Not** proposing a hosted-by-default brain — §2.4 is opt-in pluggability, not a
  reversal of ADR-0019.
- **Not** deciding the embedding reranker question — §2.5 only notes the gate reasoning
  changes, it doesn't trigger the build.
- **Not** an RFC itself — this doc doesn't ship an ADR-grade decision; each initiative
  above earns its own RFC (Track 9 or a new roadmap track, per the next re-ratification)
  before implementation starts.
