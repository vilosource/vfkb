---
type: RFC
title: "RFC-030: Update awareness — GitHub Releases as the announcement channel, `vfkb doctor --check-remote` as the opt-in version check; no phone-home, ever"
description: "Once RFC-028/029 exist, users can be behind. This RFC decides how they find out: GitHub Releases + CHANGELOG for watchers (free), and an opt-in `vfkb doctor --check-remote` that compares the installed CLI against the npmjs `latest` dist-tag — offline-silent, cached, and worded with the axis-(b) discipline (say exactly what the code compares). Auto-checks at session start and any telemetry are rejected by name. Touching doctor's output surface triggers the doctor-staleness L4 re-run per the fix/doctor-currency-line precedent."
status: "Accepted → ADR-0058 (ratified 2026-07-11)"
timestamp: 2026-07-11
---

# RFC-030: Update awareness

- **Status:** Accepted → [ADR-0058](../adr/ADR-0058-update-awareness.md) (ratified 2026-07-11)
- **Date:** 2026-07-11
- **Deciders:** operator + Claude
- **Relates:** [RFC-025](RFC-025-going-public-release-engineering.md) (umbrella, W4);
  [RFC-028](RFC-028-versioning-and-release-automation.md) (produces the Releases/CHANGELOG),
  [RFC-029](RFC-029-npm-delivery-channel.md) (produces the npmjs `latest` tag and `--version`);
  [RFC-024](RFC-024-staleness-detection-and-delivery-honesty.md) §1 — the shipped
  marketplace-staleness check this extends to a second channel, including its hard-won wording
  lesson.

## Context

A user who installs vfkb has no way to learn a newer version exists short of revisiting the
repo. The plugin channel already has half an answer (doctor's marketplace-clone staleness
check, shipped and live-verified 2026-07-10). The npm channel, once RFC-029 opens it, has none.

Two house constraints shape any answer:

- **Offline-first, no phone-home.** vfkb runs air-gapped; an update check must never be a
  startup tax, a failure mode, or a telemetry channel. Anything that calls out does so only
  when explicitly asked.
- **The axis-(b) meta-lesson** (operator-verified gotcha, 2026-07-10): a diagnostic's healthy-
  branch wording once claimed more than the code compared, and the overclaim *survived* an L4
  and a unit test — the proof passed because the claim got more confident, not more true. Any
  currency line must state exactly which two things it compared, and nothing else.

## Decision (proposed)

1. **GitHub Releases + `CHANGELOG.md` are the canonical announcement channel** (free with
   RFC-028). Repo watchers get native notifications; the changelog is "what changed". No
   further announcement machinery until demand is observed.
2. **`vfkb doctor --check-remote`** grows a **version-currency check for the npm channel**:
   - Compares the **running CLI's version** (RFC-029's `--version` source) against the **npmjs
     registry's `latest` dist-tag** for `@vilosource/vfkb`, and says exactly that:
     "installed <v> vs npmjs latest <v>" — never "you are up to date" in any wording that
     implies a comparison the code did not make (axis-(b) discipline).
   - **Opt-in only**: runs solely under the `--check-remote` flag (the shape RFC-024 proposed
     for remote checks). Plain `vfkb doctor` stays fully offline.
   - **Offline-silent**: registry unreachable/timeout (bounded, a few seconds) → one line,
     `npm currency: skipped (registry unreachable)` — a note, never a WARN, never nonzero exit.
   - **Cached 24h** in the brain dir's gitignored derived state, so repeated doctor runs don't
     re-fetch; `--check-remote` always states whether it answered from cache or live.
   - **Remedy line** names the actual command (`npm i -g @vilosource/vfkb@latest`) only once
     the channel exists (RFC-029 step 5's same restraint).
3. **Rejected by name, so they stay rejected**:
   - auto-check on session start or in hooks (startup tax; hooks fail open, so the result could
     silently vanish anyway; and it is phone-home by another name);
   - any telemetry, usage analytics, or "check-in" — vfkb never calls home un-asked;
   - update *nagging* (banners on every command) — doctor is the diagnostic surface; currency
     is diagnostic information.

**Proof shape:** the check's logic (compare, cache, offline paths, wording) is deterministic —
unit tests with an injected registry response, including the unreachable and cache-hit paths and
a **wording assertion** on the healthy line (the axis-(b) regression guard: the test fails if the
line claims more than the compared pair). Because this **changes doctor's observed output
surface**, the doctor-staleness L4 (RFC-024 §1's harness) is **re-run** on the implementing
branch per the fix/doctor-currency-line precedent — the deterministic tests prove the logic; the
re-run proves the agent-facing surface still reads correctly.

## Consequences

- Doctor becomes the one place a user asks "am I current?" for both channels (marketplace clone
  today, npm after RFC-029) — one habit, two channels, symmetric wording.
- The 24h cache introduces a staleness window in the staleness detector itself; acceptable and
  disclosed in the output ("cached <age>").
- The npmjs registry becomes a soft dependency of one *opt-in* flag; its outage degrades to a
  skipped line, which the unit tests pin.
- RFC-024 §1's axis (b) for the *plugin* channel (installed vs clone offer) remains gated and
  is **not** smuggled in here — this RFC adds a new channel's check, not the gated comparison.

## Alternatives considered

- **`update-notifier`-style automatic background check**: rejected as default behavior
  (phone-home); its useful UX survives as the opt-in flag.
- **A separate `vfkb update-check` verb**: rejected — currency is a health property; doctor is
  the health surface, and RFC-024 already put the sibling check there.
- **In-CLI self-update (`vfkb update`)**: rejected — package managers own installation;
  reimplementing them is surface without value and a fresh delivery risk.
