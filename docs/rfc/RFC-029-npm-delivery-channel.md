---
type: RFC
title: "RFC-029: The npm delivery channel — trusted publishing behind a pack-based install proof"
description: "vfkb has never been published anywhere; the README documents source-install only, by design (delivery honesty). This RFC opens the npm channel the right way round: first vfkb --version, then a containerized install-path proof (npm pack → clean container → content-asserted install, with a broken-pack contrast arm) that runs RED today, then trusted publishing (OIDC, provenance) to public npmjs on the release tag, then a post-publish canary — and only after the canary is green does the README gain the npm install command. Unlike the plugin install L4 (RFC-024 §4), nothing upstream blocks this channel."
status: "Proposed"
timestamp: 2026-07-11
---

# RFC-029: The npm delivery channel

- **Status:** Proposed
- **Date:** 2026-07-11
- **Deciders:** operator + Claude
- **Relates:** [RFC-025](RFC-025-going-public-release-engineering.md) (umbrella, W3);
  [RFC-028](RFC-028-versioning-and-release-automation.md) — supplies the tag that triggers
  publishing; [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) /
  [ADR-0051](../adr/ADR-0051-delivery-honesty.md) — the rules this RFC exists to satisfy
  *before* the first publish; [RFC-024](RFC-024-staleness-detection-and-delivery-honesty.md)
  §4 — the plugin-channel analog, gated upstream; this channel has no such blocker.

## Context

ADR-0051's core lesson: a capability can be DEMONSTRATED and simultaneously unreachable,
because **delivery is its own capability** with its own failure modes — and its failures
present as quiet successes (`exit 0`, "Unknown command"). The plugin channel learned this the
hard way and its install proof is gated on upstream tag support. The npm channel is about to be
*born*; it can be born proven. Current state: `publishConfig` targets GitHub Packages (an auth
wall that kills `npx` and casual adoption), the package has never been published, and
`vfkb --version` does not exist — there is not even a way for an installed copy to say what it is.

## Decision (proposed)

Ordered; each step is the next one's prerequisite:

1. **`vfkb --version`** — prints the package version (read from the package's own
   `package.json` at runtime; exact mechanism decided at implementation, asserted by test).
   Trivial under the strict parser (issue #95). Needed by the install proof, RFC-030's update
   check, and every future bug report.
2. **The install-path proof: `scenarios/npm-install-path.mjs`** — scenario-contract-first
   (ADR-0023); this is an **e2e container proof, not an LLM L4** (proof fits the capability,
   ADR-0029 — no agent judgment is involved in installing a package):
   - **Fresh arm**: `npm pack` → clean `node:20` container (no repo mount, no registry needed)
     → `npm i -g <tarball>` → assert as **content, never exit codes** (the quiet-success rule):
     `vfkb --version` output equals `package.json`'s version; `vfkb init && vfkb add fact … &&
     vfkb list` round-trips the entry text; `vfkb-mcp` completes an MCP `initialize` handshake
     over stdio.
   - **Contrast arm (must-fail)**: the same flow with a deliberately broken pack (e.g. `files`
     stripped of `dist/`) must go RED on the content assertions. A proof that cannot fail
     proves nothing.
   - **RED first, today**: the fresh arm fails right now because `--version` does not exist —
     the contract is committed and observed RED before step 1 lands, then flips green with it.
   - Runs in CI on release-please's release PR (RFC-028) — the pack-based arm needs no
     registry, so the proof gates the release *before* anything is published.
3. **Publish workflow** — on the `vX.Y.Z` tag: publish `@vilosource/vfkb` to **public npmjs**
   via **trusted publishing** (GitHub Actions OIDC — no long-lived token secret) with
   **provenance attestation**; `publishConfig` flips from GitHub Packages to npmjs in the
   implementing PR. (Trusted-publishing setup happens on npmjs at first publish; the workflow
   asserts provenance was attached — observed, not assumed.)
4. **Post-publish canary** — same workflow, after publish: `npm i -g @vilosource/vfkb@<new>`
   from the **real registry** in a clean container, same content assertions as the fresh arm.
   This is the delivery proof for the channel as users actually reach it.
5. **Only then, the docs claim** — a follow-up PR adds `npm install -g @vilosource/vfkb` /
   `npx` to the README's install section, citing the canary run. The claim follows the
   observation (the same restraint PR #113 exercised by omitting it).
6. **Cross-repo coordination** — a vfkb release does not auto-update the plugin (it vendors its
   own engine copy, ADR-0045). The PR template (RFC-027) carries the "does the plugin need a
   re-vendor?" checklist line; automation is **gated** on that line being forgotten once.

## Consequences

- The npm channel enters life with `DELIVERY: proven` semantics — the state the plugin channel
  is still working toward — and the README never carries an unobserved install command.
- Publishing becomes irreversible in the npm sense (versions deprecate, never delete); the
  canary failing *after* publish means a deprecate + patch cycle, which is why the pack-based
  arm gates *before* publish.
- CI acquires a docker dependency on release PRs only (the container arms); ordinary PRs are
  unaffected.
- npmjs account security becomes part of the project's threat model; OIDC trusted publishing
  removes the long-lived-token class of that risk.

## Alternatives considered

- **GitHub Packages (status quo config)**: rejected — requires auth even for public reads;
  kills `npx` and casual adoption; npmjs is where Node users look.
- **Token-based publish (`NPM_TOKEN` secret)**: rejected where OIDC is available — a standing
  secret is a standing liability; provenance comes with the OIDC path.
- **Publish first, prove after**: rejected by name — that is the exact sequence ADR-0051 was
  written against, reproduced on a new channel.
- **Reusing the plugin's install L4 machinery**: rejected — different channel, different failure
  modes (marketplace clone/version cache vs. pack contents/bin wiring); sharing a harness would
  couple the unblocked proof to the blocked one.
