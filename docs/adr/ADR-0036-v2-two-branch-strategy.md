# ADR-0036: v2 development uses a dedicated long-lived `v2` branch; `main` stays release-only

- **Status:** Accepted
- **Date:** 2026-07-05
- **Deciders:** operator + Claude

## Context

`docs/V2-VISION.md` opens the next fork: H4 is complete, the in-repo frontier is
exhausted, and v2 is explicitly a **breaking-changes-allowed** re-ratification of the
roadmap. `main`, meanwhile, is the released, currently-supported version — consumers
(including vilonotes, dogfooding vfkb in production via kagent) depend on it staying
stable. Developing v2 directly against `main` would mean either freezing v1 fixes for
the duration of a multi-initiative rewrite, or letting half-built breaking changes leak
into the released branch. Both are unacceptable, and this is a well-trodden problem —
most projects that develop a breaking next-major version alongside a still-supported
release solve it the same way.

## Decision

Two long-lived branches, not one:

- **`main`** — the released v1. Unchanged from today: protected, PR-only, receives
  **only patches/fixes to the current release**. No v2 initiative lands here directly.
- **`v2`** — a new long-lived integration branch, cut from `main` once, acting as v2's
  own trunk. Every v2 initiative from `docs/V2-VISION.md` §3 branches from `v2` and PRs
  back into `v2` (never into `main`), following the same branch → PR → review discipline
  this repo already uses for `main`.

Mechanics:

- **v1 hotfixes** keep flowing to `main` exactly as today.
- **`v2` is synced from `main` regularly** — merge `main` into `v2` after every v1
  hotfix (not batched, not occasional) so the branches never diverge far enough for
  reconciliation to become its own project.
- **Docs are the one exception.** RFCs, ADRs, and vision/notes docs (including
  `V2-VISION.md` itself, this ADR, and `docs/NOTES-multi-agent-concurrency-corner-cases.md`)
  are non-breaking and keep landing on `main` via the normal PR flow — writing about a
  decision isn't the same as building it. The rule that matters is **v2 *code* never
  lands on `main` until v2 ships**; docs describing v2 belong where people already
  browse `docs/`.
- **`v2` gets the same branch protection `main` has** — no direct pushes, PR required,
  CI runs independently on both branches. It is long-lived and shared, so it earns the
  same discipline as `main`, not "anything goes because it isn't released yet."
- **Cutover is a future decision, not this one.** When v2 is ready to ship, the options
  (merge `v2` into `main` as one large reviewed merge, or promote `v2` to be the new
  `main` and rename the old one for continued patch support) are both viable and don't
  need to be chosen now.

## Consequences

- **+** `main` stays exactly as stable as it is today throughout all of v2's
  development — v1 consumers (vilonotes included) see zero disruption.
- **+** v2 initiatives get real code review and CI on `v2` before they're anywhere near
  release, instead of accumulating on an ungoverned scratch branch.
- **+** Regular `main`→`v2` syncing keeps the eventual cutover cheap; the alternative
  (sync rarely, reconcile once at the end) is the classic long-lived-branch failure mode.
- **−** Extra ceremony: two protected branches to maintain, and every v1 hotfix now
  implies a follow-up sync into `v2`, not just a single merge to `main`.
- **Neutral:** docs continuing to land on `main` during v2 development means `main`'s
  `docs/` tree will describe capabilities that don't exist in `main`'s own code yet
  (they exist on `v2`). This is already true in practice (`V2-VISION.md` itself) and is
  treated as acceptable — docs are explicitly marked pre-RFC/proposed until their code
  ships.

## Alternatives Considered

- **Develop v2 directly on `main` behind feature flags** — rejected: v2's initiatives
  are breaking-changes-allowed by design (schema changes, removed fields, a different
  storage interface); flag-gating changes of that shape is more ceremony than a second
  branch, not less, and this repo's philosophy already avoids feature-flag shims
  (`CLAUDE.md`: "avoid... feature flags... when you can just change the code").
- **Full Git Flow (`develop`/`release`/`hotfix` branches)** — rejected as more ceremony
  than this repo's scale needs; the two-branch model here is Git Flow's `develop`
  concept applied at major-version granularity, without the rest of its branch types.
- **Let `v2` diverge freely and reconcile once at the end** — rejected: this is the
  well-known failure mode long-lived branches fall into; regular `main`→`v2` syncs are
  cheap insurance against it.
