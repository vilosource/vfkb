---
type: Decision
title: "ADR-0057: The npm delivery channel — trusted publishing behind a pack-based install proof (accepts RFC-029)"
description: "The npm channel is born proven: vfkb --version first; then scenarios/npm-install-path.mjs — an e2e container proof (pack → clean node:20 → content-asserted install: --version equals package.json, add/list round-trip, MCP initialize handshake) with a broken-pack must-fail arm, committed RED before --version exists and run on release PRs pre-publish; then OIDC trusted publishing with provenance to public npmjs on the release tag; then a post-publish canary from the real registry — and only after the canary is green does the README gain the npm install command."
status: "Accepted"
timestamp: 2026-07-11
---

# ADR-0057: The npm delivery channel

- **Status:** Accepted
- **Date:** 2026-07-11
- **RFC:** [RFC-029](../rfc/RFC-029-npm-delivery-channel.md) (accepted 2026-07-11; the ordered
  step contract and rejected alternatives live there)
- **Relates:** [ADR-0053](ADR-0053-going-public-sequencing.md) (umbrella; W3);
  [ADR-0056](ADR-0056-versioning-and-release-automation.md) (supplies the triggering tag);
  [ADR-0050](ADR-0050-l4-dod-constitutional-brake.md) /
  [ADR-0051](ADR-0051-delivery-honesty.md) (the rules satisfied *before* first publish);
  [RFC-024](../rfc/RFC-024-staleness-detection-and-delivery-honesty.md) §4 (the plugin-channel
  analog, still gated upstream — this channel has no such blocker);
  [ADR-0029](ADR-0029-sandbox-proven-definition-of-done.md) ("proof fits the capability": an
  install proof is a container e2e, not an LLM L4).

## Context

ADR-0051's lesson: delivery is its own capability, and its failures present as quiet successes.
The plugin channel learned that after the fact and its install proof is blocked upstream. The
npm channel is about to be *born* — it can be born proven. Today: never published anywhere,
`publishConfig` targets GitHub Packages (an auth wall that kills `npx`), and `vfkb --version`
does not exist.

## Decision

Ordered; each step gates the next:

1. **`vfkb --version`** — prints the package version; the mechanism is asserted by test.
2. **`scenarios/npm-install-path.mjs`** — scenario-contract-first (ADR-0023): fresh arm
   (`npm pack` → clean `node:20` container → `npm i -g` tarball → **content assertions only**:
   `--version` equals `package.json`, `init`/`add`/`list` round-trip, `vfkb-mcp` MCP
   `initialize` handshake) + **broken-pack must-fail arm** (e.g. `files` without `dist/` goes
   red on content). Committed and observed **RED before step 1 lands**. Runs on release PRs —
   pack-based, no registry needed, so it gates *before* publish.
3. **Publish workflow** on the `vX.Y.Z` tag: `@vilosource/vfkb` to **public npmjs** via OIDC
   **trusted publishing** (no long-lived token) with **provenance attestation**, asserted
   attached; `publishConfig` flips off GitHub Packages in the implementing PR.
4. **Post-publish canary**: install the just-published version from the real registry in a
   clean container, same content assertions — the proof of the channel as users reach it.
5. **The docs claim comes last**: README gains `npm install -g @vilosource/vfkb` only after an
   observed green canary, citing the run (PR #113's restraint, kept).
6. **Plugin coordination stays manual** (PR-template checklist line); automation is gated on
   the checklist being forgotten once.

## Consequences

- The npm channel enters life delivery-proven — the state the plugin channel is still working
  toward.
- npm versions deprecate, never delete; the pack-based arm gating pre-publish is what keeps
  "deprecate + patch" a rare path.
- CI gains a docker dependency on release PRs only.
- npmjs account security joins the threat model; OIDC removes the standing-token class of it.
