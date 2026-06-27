# ADR-0024: Corroborated promotion re-stamps provenance verified (trust elevation is agent-observable)

- **Status:** Accepted (self-ratified; flagged for operator glance)
- **Date:** 2026-06-27
- **Deciders:** operator (pre-decided shape, operator-veto) + Claude
- **Origin:** the 2026-06-27 Track-4 build finding (recorded in [ADR-0023](ADR-0023-scenario-contract-first.md)
  Context #3 and the roadmap Track-4 findings): corroborated promotion ([ADR-0021](ADR-0021-auto-distill-and-curator.md)
  §4) elevated the **zone** but **not** the agent-visible trust label, so a promoted and an unpromoted
  distilled lesson read identically to an agent — "delivered as trusted" was **zone-deep only**, with no
  observable effect. The shape below was pre-decided in [H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md)
  §4 (D-iii) for an unattended run.
- **Applies / extends:** [ADR-0021](ADR-0021-auto-distill-and-curator.md) §4 (corroborated promotion — this
  makes its trust elevation observable), [ADR-0011](ADR-0011-envelope-richness.md) (trust is **derived**; this
  adds a non-destructive provenance re-stamp as the second input to that derivation),
  [FEATURES](../FEATURES.md) §3.6 (the trust gradient). Built scenario-first per
  [ADR-0023](ADR-0023-scenario-contract-first.md).

## Context

`promoteIfCorroborated` (ADR-0021 §4) moved an `incoming` distilled candidate to the `established` zone once
it accrued ≥2 net corroborating signals. But trust, as rendered to an agent, is **derived** (ADR-0011): the
✓/⚠ glyph and the `verified` search filter (D-i) key on `provenance.status`, which stayed `unverified`
(role-derived: the author role remained `executor`). So promotion changed the zone — invisible to the agent —
while every trust surface still said "unverified candidate." The L4 `corroborated-promotion` scenario could
therefore only be asserted at the **deterministic** gate, not as an agent contrast (it has no observable
contrast to assert).

Separately, the distiller baked the literal string `"(unverified)"` into the candidate gotcha's **immutable
text**. Because the never-rewrite Brake (ADR-0021) forbids editing text, a later verified relabel would leave
the entry showing a ✓ glyph over text that still reads "(unverified)" — a self-contradiction.

## Decision

Corroborated promotion makes its trust elevation **agent-observable**, via two changes:

1. **`promoteIfCorroborated` also re-stamps `provenance.status = 'verified'`** (after the zone move).
   Corroboration-by-recurrence **is** the independent second signal §3.6 calls for — the *recurrence* asserts
   the lesson, not its author — so it is legitimate to flip the derived-trust input. The re-stamp is a new,
   **metadata-only** engine primitive `setProvenanceStatus(id, status)` that leaves the entry's **text
   byte-identical**, so the never-rewrite Brake is untouched. The promoted lesson now enters the verified-only
   view (`kb_search verified=true`, D-i) and renders with the ✓ glyph.
2. **The distiller stops baking `"(unverified)"` into new candidate text.** Trust is carried by the
   glyph/provenance, not the prose, so a subsequent verified relabel never contradicts the text. This is
   **text-Brake-safe**: it changes only *newly* distilled candidates; existing entries are never rewritten.

The deterministic `corroborated-promotion` scenario stays as the §4 gate (zone + refusal logic); a new
agent-observable scenario `promotion-relabel` asserts that a promoted lesson is returned by
`kb_search verified=true` while an unpromoted one is excluded — written + run RED before this change (the
promoted lesson returned `NONE`), green after.

## Consequences

- **+** ADR-0021 §4's "delivered as trusted" is now real: an agent can *observe* a corroborated lesson as
  verified knowledge (✓ glyph, verified-only filter), closing the 2026-06-27 finding.
- **+** The never-rewrite Brake is preserved — `setProvenanceStatus` is metadata-only; the unit Brake (text
  byte-identical through promotion) still passes.
- **+** Glyph/text no longer contradict after a relabel (the `"(unverified)"` text removal).
- **−** A second independent trust authority now exists (corroboration, alongside human authorship). Bounded:
  it requires ≥2 net signals (ADR-0021 §4 threshold) and only ever flips `unverified → verified` on
  promotion; machine extraction still cannot self-mint trust on a single distillation.
- **Neutral:** `setProvenanceStatus` is intentionally narrow (no zone/status/text); the broader question of a
  general provenance lifecycle (stale/expired transitions) is out of scope here.

## Alternatives Considered

- **Leave promotion zone-only (status quo).** Rejected — it is exactly the finding: no agent-observable
  effect, so the §4 promotion claim is undeliverable.
- **Re-derive trust from zone (`established` ⇒ verified) instead of a stored re-stamp.** Rejected — couples two
  orthogonal axes (zone = injection/retention; provenance = trust), and human-authored established entries vs
  machine-promoted ones would become indistinguishable; an explicit re-stamp keeps the provenance trail.
- **Rewrite the text to drop "(unverified)" on promotion.** Rejected — violates the never-rewrite Brake; fixed
  at the source instead (don't bake it into new text).

## Related

[ADR-0021](ADR-0021-auto-distill-and-curator.md) (corroborated promotion this completes),
[ADR-0011](ADR-0011-envelope-richness.md) (derived trust), [ADR-0023](ADR-0023-scenario-contract-first.md)
(the scenario-first method used), [FEATURES](../FEATURES.md) §3.6 (trust gradient). Roadmap:
[H4-DEVELOPMENT-ROADMAP](../H4-DEVELOPMENT-ROADMAP.md) §4 D-iii. Code: `setProvenanceStatus` (engine),
`promoteIfCorroborated` (curator), distiller candidate text. Scenario: `promotion-relabel`.
