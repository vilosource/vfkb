---
type: Decision
title: "ADR-0058: Update awareness — GitHub Releases canonical; opt-in `doctor --check-remote` npm currency; no phone-home (accepts RFC-030)"
description: "Users learn about new versions from GitHub Releases + CHANGELOG (free with ADR-0056) and from an opt-in doctor --check-remote line comparing the installed CLI against the npmjs latest dist-tag — saying exactly that (axis-(b) wording discipline, pinned by a unit-level wording assertion), offline-silent, cached 24h with age disclosed. Session-start auto-checks, telemetry, nagging, and in-CLI self-update are rejected by name. Doctor's surface changes → the doctor-staleness L4 is re-run."
status: "Accepted"
timestamp: 2026-07-11
---

# ADR-0058: Update awareness

- **Status:** Accepted
- **Date:** 2026-07-11
- **RFC:** [RFC-030](../rfc/RFC-030-update-awareness.md) (accepted 2026-07-11; the full check
  specification and rejected alternatives live there)
- **Relates:** [ADR-0053](ADR-0053-going-public-sequencing.md) (umbrella; W4, last in build
  order); [ADR-0056](ADR-0056-versioning-and-release-automation.md) (Releases/CHANGELOG),
  [ADR-0057](ADR-0057-npm-delivery-channel.md) (`--version` + the `latest` tag compared
  against); [RFC-024](../rfc/RFC-024-staleness-detection-and-delivery-honesty.md) §1 (the
  shipped marketplace-staleness sibling and its wording lesson — its gated axis (b) is NOT
  smuggled in here).

## Context

Once releases exist (ADR-0056/0057), installed copies can be behind. The plugin channel has a
shipped staleness check; the npm channel needs one. Two house constraints bind: offline-first
with **no phone-home defaults**, and the axis-(b) meta-lesson (operator-verified gotcha,
2026-07-10) — a diagnostic's confident overclaim survived an L4 and a unit test; currency
wording must state exactly which two things were compared.

## Decision

1. **GitHub Releases + CHANGELOG.md are the canonical announcement channel.** No further
   machinery until demand is observed.
2. **`vfkb doctor --check-remote` gains an npm currency line**: running CLI version vs the
   npmjs **`latest` dist-tag** for `@vilosource/vfkb`, phrased as exactly that comparison;
   **opt-in only** (plain `doctor` stays fully offline); **offline-silent** (bounded timeout →
   `npm currency: skipped (registry unreachable)`, a note, never a WARN, never nonzero);
   **cached 24h** in gitignored derived state, cache-vs-live and cache age disclosed; the
   remedy line names the real command only once the channel exists (ADR-0057 step 5's
   restraint).
3. **Rejected by name, so they stay rejected**: session-start/hook auto-checks, telemetry or
   any un-asked network call, update nagging outside doctor, in-CLI self-update.

**Proof shape:** deterministic unit tests with an injected registry response — unreachable,
cache-hit, and current/behind paths — including a **wording assertion** on the healthy line
(fails if the line claims more than the compared pair: the axis-(b) regression guard). Because
doctor's observed output surface changes, the **doctor-staleness L4 (RFC-024 §1 harness) is
re-run** on the implementing branch, per the fix/doctor-currency-line precedent.

## Consequences

- Doctor becomes the one "am I current?" surface for both channels — one habit, symmetric
  wording.
- The 24h cache is a disclosed staleness window inside the staleness detector; accepted.
- The npmjs registry becomes a soft dependency of one opt-in flag; outage degrades to a
  skipped line, pinned by test.
