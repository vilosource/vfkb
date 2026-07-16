# `install-path` L4 — prove plugin delivery (implementation plan)

> **Status:** ✅ **DONE (2026-07-16) — delivery is PROVEN.** All three phases shipped: Phase 0
> (ADR-0060 tagging), Phase 1 (`scenarios/install-path.mjs`, RED-verified), Phase 2 (the live metered
> run — **DEMONSTRATED 3/3**: fresh 3/3, upgrade 3/3, contrast 0/3). The version-bound record
> `scenarios/records/install-path.json` flipped `DELIVERY-STATUS.json` to `proven` (vfkb-claude-plugin#20).
> Delivery must be **re-proven every release** (RELEASING.md re-pin checklist) to stay proven. Brain:
> decision `6df924d7b464`. *(Original plan preserved below for the record.)*
>
> _Original status:_ PLAN — PROPOSED. Un-gated by explicit operator request (RFC-024 §4). Grounded
> 2026-07-16 against the live plugin repo (`plugin.json` v0.5.0, then zero git tags, the
> `hooks-smoke.mjs` harness, `release-gate.mjs`, `DELIVERY-STATUS.json`, `RELEASING.md`). Build work
> was all in `vilosource/vfkb-claude-plugin`.

## 0. Goal & scope

**Goal:** produce the one artifact that closes vfkb's longest-standing honesty gap — a **DEMONSTRATED,
version-bound `scenarios/records/install-path.json`** proving that a consumer can **install and
upgrade** the plugin through the *real* marketplace path and get a working capability. When it lands,
the plugin's release gate **auto-flips** `DELIVERY-STATUS.json` from `delivery: "unproven"` to
`"proven"` and the mandated disclosure drops.

**Why it doesn't exist yet (ADR-0051).** Every current L4 either uses `--plugin-dir` (a source-tree
load that bypasses the whole install machinery) or — in the case of `hooks-smoke.mjs` — a
**directory-source** marketplace over the local checkout, which installs the working tree with **no
clone and no version resolution** (`scenarios/hooks-smoke.mjs:116`). Neither exercises what a real
consumer does: resolve a **github** marketplace at a **released version**, install it, and later
**upgrade** to a newer version. That is *delivery*, and it has never been observed end-to-end.

**In scope:** the plugin repo — a new `scenarios/install-path.mjs`, its committed record, adopting
release tagging, and the doc/gate updates that follow.

**Out of scope:**
- The vfkb **engine** (`~/VFKB/vfkb/src/`) — no change; this is packaging/delivery, not the engine.
- **`vfkb doctor` stale-clone detection** (RFC-024 §1) — a *detection* problem, separately tracked and
  unrelated to this *proof*. This plan does not touch it.
- Proving delivery on **every** platform/OS — one sandboxed Linux path, per ADR-0022.

## 1. The exact done-condition (don't over-build)

The gate does the accounting for us. `scenarios/release-gate.mjs`:

```
const DELIVERY_PROOF = 'install-path';                      // hard-coded (line 72)
const derived = checkRecord(repo, DELIVERY_PROOF, version).ok ? 'proven' : 'unproven';  // line 444-445
// fails CI if DELIVERY-STATUS.json.delivery !== derived    // line 447
```

So "done" = **`scenarios/records/install-path.json` exists, is DEMONSTRATED (≥2/3 per ADR-0022), and is
bound to the shipping `pluginVersion`.** `DELIVERY-STATUS.json.delivery` is **not a dial** — the gate
derives truth from the record and fails on any hand-edit mismatch (`DELIVERY-STATUS.json:15-18`). We
never flip it ourselves; landing the record flips it.

**Corollary — the recurring re-pin.** `checkRecord` is **version-bound**: the record must match the
release's `pluginVersion`, exactly like the other three live records (`RELEASING.md` "Pre-tag
checklist" §3). So once delivery is proven, **every subsequent release must re-pin `install-path`
against the new version** to stay `proven`. Per the operator's standing directive (thoroughness over
budget — the ~12-session cost is **not** a constraint), the policy is to **re-pin on every release**;
we do not let delivery lapse to `unproven` to save sessions. §6 records this.

## 2. What already exists vs. the delta to build

`scenarios/hooks-smoke.mjs` (277 lines) is a **reusable delivery-shaped harness** — the plan reuses its
primitives rather than reinventing them:

| Primitive (`hooks-smoke.mjs`) | What it gives us |
|---|---|
| `stageCreds(home)` (line 73) | `claudeAiOauth`-only creds into a sandbox HOME (ADR-0022 §8) |
| `buildSandbox(wired)` (line 85) | isolated `HOME` + seeded project repo on a topic branch; `claude plugin marketplace add` + `plugin install` |
| `turn(sb, prompt, allowedTools)` (line 121) | one metered `claude -p` turn in the sandbox HOME |
| `mcpToolNames()` (line 145) | asserts the 9 `kb_*` tools resolve |

**The delta — three things `hooks-smoke` does *not* do:**
1. It marketplace-adds a **directory source** (the local checkout: `marketplace add REPO`,
   `hooks-smoke.mjs:114`). A directory source **creates no clone and carries no version** — it cannot
   model "install release X" or "upgrade X→Y" (RFC-024 §4, `[probe]`). The delivery proof must use a
   **github source at a pinned ref/version**.
2. It has no **upgrade** arm — the single most important, least-evidenced delivery behavior.
3. Its contrast arm just omits the plugin; the delivery contrast must **remove the capability** from an
   installed plugin (see the trap in §4).

## 3. Phase 0 — adopt release tagging (the unblock · no metered cost)

The `upgrade` arm needs **"the previous release"** to be resolvable by a durable ref. The plugin repo
has **zero git tags** (`git tag` = empty, confirmed 2026-07-16); releases are hand-cut version bumps
in `plugin/.claude-plugin/plugin.json` (`RELEASING.md`), so a hardcoded SHA "rots at the next release"
(RFC-024 §4). Ref-pinning itself is **not** the blocker — `marketplace add owner/repo@ref` records
`{source:github,repo,ref}` and works (RFC-024 §"the fix that does not work", `[probe]`). Tagging just
makes "previous release" a durable name instead of a rotting SHA.

**Steps:**
1. **Investigate `claude plugin tag`** — RFC-024 names it as the prerequisite but its exact semantics
   are **unverified**. Confirm what it does (tags a plugin release? writes to `marketplace.json`?
   interacts with the version cache?) via `claude plugin tag --help` and a throwaway sandbox. Record
   the finding — this is the plan's biggest unknown.
2. **If `claude plugin tag` does what we need**, adopt it in `RELEASING.md`'s checklist (tag on every
   version bump). **If it doesn't**, fall back to plain **git tags** `vX.Y.Z` at each release commit +
   a github-source marketplace pinned to the tag — RFC-024 confirms `@ref` resolution works, so this
   fallback is sufficient on its own.
3. **Retro-tag** the current release (`v0.5.0` at `HEAD`) and **at least one prior release** (mine the
   `re-vendor … vX.Y.Z` commit history for the previous version's commit), so the `upgrade` arm has a
   real `old → new` pair to traverse.
4. **Record the decision as an ADR** in the plugin repo (plugin versioning & tagging policy) — this is
   a genuine standard-setting choice, and the release gate/RELEASING.md reference it.

**Exit:** `git tag` lists ≥2 releases; `claude plugin marketplace add vilosource/vfkb-claude-plugin@v0.5.0`
resolves in a sandbox. No live sessions spent.

## 4. Phase 1 — build `scenarios/install-path.mjs` (RED-verified · no metered cost until run)

Reuse the `hooks-smoke` primitives (§2); swap the directory source for a **github source at a pinned
ref**. Three arms, DEMONSTRATED ≥2/3:

- **`fresh`** — sandbox HOME → `marketplace add vilosource/vfkb-claude-plugin@<current-tag>` →
  `plugin install vfkb@vfkb --scope project` → a metered turn invoking `/vfkb:brief` → capability
  **present**.
- **`upgrade`** — `marketplace add …@<previous-tag>` → install → capability **absent/old** →
  `marketplace update` (advance the clone to current) → `plugin update vfkb@vfkb --scope project` →
  metered turn → capability **present**. *(Two metered turns: pre + post.)*
- **`contrast`** (the can-fail arm) — install current, but with the capability **removed** → **absent**.

**Traps to bake in — all pre-discovered in RFC-024 §4 `[probe]`, so we don't rediscover them at cost:**
- A **github** source clones **shallowly**; rewinding to a previous ref needs `git fetch --unshallow`
  first.
- `plugin install --scope project` needs a project dir containing `.claude/settings.json`, and
  **auto-writes `enabledPlugins`** — seed the sandbox project accordingly.
- The **`contrast` arm must delete BOTH** `plugin/skills/brief/` **and** `plugin/agents/briefer.md`.
  Deleting only the skill leaves the Haiku briefer agent `Task`-spawnable, able to **forge** a `haiku`
  entry in `modelUsage` and defeat the predicate.
- **Predicate:** the `/vfkb:brief` sentinel appears in `result` **and** a `haiku` model appears in
  `modelUsage`. Assert **neither** exit code **nor** `is_error` (ADR-0051 quiet-success trap: a missing
  capability presents as a clean exit-0 run).
- The **`upgrade` arm's two runs share one mutable brain** — the pre-run can perturb the post-run's
  predicate; isolate or reset between them.
- **The plugin's own hooks fire inside every arm.** `SessionEnd` auto-commits `.vfkb/entries.jsonl`;
  it no-ops only on the default branch (`src/session-end.ts` returns `on-default-branch` first), so the
  sandbox project must stay on its default branch, mirroring `hooks-smoke`'s design.
- The **`plugin update` "Restart to apply" step is the least-evidenced** in the whole design — whether
  a fresh `claude -p` counts as that restart is **unobserved**; on-disk state suggests yes. Phase 1's
  RED run must confirm this before Phase 2 spends the metered budget.
- Creds: `claudeAiOauth` only, sandboxed HOME, scrubbed in a `finally` (ADR-0022 §8). Never touch the
  operator's real `~/.claude`.

**RED-verify (the can-fail check, no metered cost):** run the arms against a deliberately-broken setup
(e.g. contrast wiring, or a bogus ref) and confirm they **fail** — a proof that can't fail proves
nothing (ADR-0029). Stop here until the operator green-lights the metered run.

## 5. Phase 2 — the metered run (~12 live sessions)

- **Scale:** `3×1 (fresh) + 3×2 (upgrade pre+post) + 3×1 (contrast)` ≈ **12 live sessions** per full run
  (RFC-024 §4). Run **one docker/agent session at a time** (ADR-0022). Cost is **not** a gate (operator
  directive: thoroughness over budget) — run more trials than the 2/3 minimum if it hardens the proof.
- **The only checkpoint before Phase 2 is correctness, not spend:** confirm Phase 1's arms are
  RED-verified and the `plugin update` restart step is observed to work (§4). That is a soundness
  review of the harness, not a budget approval.
- Produce `scenarios/records/install-path.json`, **version-bound to the shipping `pluginVersion`**
  (v0.5.0, or the then-current if a release intervenes), DEMONSTRATED ≥2/3.
- `node scenarios/release-gate.selftest.mjs && node scenarios/release-gate.mjs` → green, with the
  `[delivery]` Brake now deriving `proven`.
- The gate auto-flips `DELIVERY-STATUS.json` → `proven`; **remove the disclosure** from `README.md`
  (the gate stops requiring it once `derived === 'proven'`).
- Update `RELEASING.md`: add `install-path` to the pre-tag re-pin checklist (§3) and rewrite the
  "Delivery honesty" section from "blocked upstream" to "proven at vX.Y.Z; re-pin per §6 policy".
- Record a `decision` in the vfkb brain + a plugin-repo ADR: delivery proven, with the version and
  record id.

## 6. Decisions to nail (flag for the operator before Phase 2)

1. **`claude plugin tag` — real or fallback?** The plan's biggest unknown (Phase 0 step 1). If the
   command doesn't exist or doesn't pin, we use git tags + `@ref` — cheap and RFC-024-confirmed.
2. **Re-pin cadence — DECIDED: every release.** Version-binding means staying `proven` costs **+~12
   sessions every release**. Per the operator's standing directive (thoroughness over budget), we
   **re-pin on every release** and keep delivery continuously `proven`. The ADR-0051 option of letting
   delivery lapse to `unproven`-with-disclosure to save sessions is **rejected** here — cost is not a
   constraint, and continuous proof is the more honest state. (This reverses the plan's first draft,
   which recommended the cost-saving lapse.)
3. **How many prior versions to retro-tag** — the `upgrade` arm needs one (`old→new`) at minimum;
   default to tagging **all** identifiable prior releases so the upgrade matrix can be broadened later
   without re-mining history.

## 7. Risks & guardrails

- **Harness correctness** is the main risk (not spend — cost is not a constraint here). A flawed arm
  produces a *false* proof, which is worse than none; the RED-verify gate and the `plugin update`
  restart observation (§4) exist to catch that before Phase 2.
- **Credential hygiene** (ADR-0022 §8) — the largest safety surface; reuse `hooks-smoke`'s
  `stageCreds` + `finally` scrub verbatim, sandbox HOME only.
- **The `plugin update` restart ambiguity** (§4) could invalidate the `upgrade` arm's post-run — de-risk
  it in Phase 1's RED run, not in Phase 2's metered run.
- **Honesty until it lands:** per ADR-0051, until `install-path.json` is committed, every release note,
  ADR, and handoff **must keep saying "delivery is unproven"** — this plan does not change that; it is
  the path to *earning* the flip.

## 8. Definition of Done

- `scenarios/records/install-path.json` — DEMONSTRATED ≥2/3, version-bound, with a can-fail contrast
  arm (four ADR-0051 clauses: isolated · observed-not-asserted · before declaring done · capable of
  failing).
- `release-gate.mjs` green with `[delivery]` deriving `proven`; `DELIVERY-STATUS.json` auto-flipped;
  README disclosure removed.
- Phase-0 tagging ADR + `RELEASING.md` updated (checklist + re-pin cadence policy from §6).
- A brain `decision` recording delivery proven (version + record id), and this plan's status flipped to
  DONE.
- **Sequencing:** §3 (no cost) → §4 (no cost, RED-verified) → **stop for operator go-ahead** → §5
  (metered). The plan is safe to execute through Phase 1 without spending a single live session.
