---
type: RFC
title: "RFC-025: Going public — release engineering, versioning, and update awareness"
description: "PR #113 gave vfkb a public face (README + MIT). This RFC proposes everything between that and a repo strangers can safely depend on: a pre-public disclosure audit (the gate), test CI, community hygiene files, release-please-driven versioning with a reviewable release PR, npm trusted publishing gated by an npm-channel install-path L4 (buildable today, unlike the plugin one), and update awareness via GitHub Releases + an opt-in `vfkb doctor` version check. Five workstreams, each its own PR chain; W0 blocks the visibility flip, everything else can land before it."
status: "Accepted → ADR-0053 (ratified 2026-07-11)"
timestamp: 2026-07-11
---

# RFC-025: Going public — release engineering, versioning, and update awareness

- **Status:** Accepted → [ADR-0053](../adr/ADR-0053-going-public-sequencing.md) (ratified 2026-07-11)
- **Date:** 2026-07-11
- **Deciders:** operator + Claude
- **Relates:**
  [ADR-0050](../adr/ADR-0050-l4-dod-constitutional-brake.md) /
  [ADR-0051](../adr/ADR-0051-delivery-honesty.md) — the DoD and delivery-honesty rules this RFC
  applies to two *new* delivery channels (npmjs, GitHub Releases);
  [RFC-024](RFC-024-staleness-detection-and-delivery-honesty.md) — §1 built doctor's marketplace
  staleness check (axis a) and gated axis (b) and the plugin install L4 (§4, blocked upstream);
  the npm-channel install proof proposed here is **not** blocked by that gate — it is a different
  channel with no upstream dependency;
  [ADR-0045](../adr/ADR-0045-vfkb-claude-code-plugin.md) — the plugin distribution this RFC
  must coordinate releases with;
  [ADR-0052](../adr/ADR-0052-review-gate.md) — the review gate every implementation PR here rides.

## Context

PR #113 shipped the public README and MIT LICENSE. The repo is otherwise still shaped like a
private workshop:

1. **CI proves the wrong thing to a stranger.** The only workflow is `review-gate.yml`; `npm test`
   (265 tests) never runs in CI. A public repo whose README cites its test suite must run that
   suite on every PR, visibly.
2. **No community hygiene.** No CONTRIBUTING.md (and this repo has genuinely unusual contribution
   rules: review-gate records, ADR/RFC-first, L4 DoD, no AI attribution), no SECURITY.md, no code
   of conduct, no issue/PR templates, no CODEOWNERS.
3. **No release story.** Version is `0.1.0` and has never moved. No tags, no CHANGELOG, no GitHub
   Releases, `publishConfig` points at GitHub Packages, and the package has never been published
   anywhere. The README deliberately documents source-install only (PR #113, delivery honesty).
4. **No update awareness.** A user who installs vfkb today has no way to learn a new version
   exists except re-visiting the repo. `vfkb --version` does not even exist. (The *plugin* channel
   already has half an answer: doctor's marketplace staleness check, RFC-024 §1.)
5. **The repo history was written in private.** Commits carry a corporate email; CLAUDE.md names
   an internal registry host; the committed brain (200+ entries) narrates internal projects and
   machines. None of this is a *secret* (GitGuardian has watched every push), but "no credentials"
   and "nothing you mind strangers reading" are different bars, and flipping visibility publishes
   **all history retroactively**.

Constraints this proposal honors, because they are what makes vfkb vfkb:

- **Deterministic backstop over probabilistic gate** — release checks are Brakes, not prose.
- **Delivery honesty (ADR-0051)** — no install command is documented until that exact channel has
  been observed working; the quiet-success trap means content assertions, not exit codes.
- **The operator reviews releases** — nothing ships because a robot decided to; `main` stays
  protected and every release is a mergeable, readable artifact.
- **Offline-first, no phone-home** — vfkb runs air-gapped today; update checks must be opt-in and
  fail silent, never a startup tax or a telemetry channel.

## Decision (proposed)

Five workstreams. **W0 gates the visibility flip**; W1–W4 are ordered by dependency but can all
land while the repo is still private. Each numbered item is one PR unless noted.

**Decomposition (ASDLC):** this RFC is the **umbrella** — it holds the shared context, the
sequencing, and the cross-cutting rejected alternatives. Each workstream is its own decidable
RFC, ratified and built independently, each carrying its own proof contract:
[RFC-026](RFC-026-pre-public-disclosure-gate.md) (W0) ·
[RFC-027](RFC-027-public-ci-and-community-hygiene.md) (W1) ·
[RFC-028](RFC-028-versioning-and-release-automation.md) (W2) ·
[RFC-029](RFC-029-npm-delivery-channel.md) (W3) ·
[RFC-030](RFC-030-update-awareness.md) (W4).
Where a child refines a detail below, **the child governs**. On acceptance the children become
ADRs; this umbrella is accepted as the sequencing decision itself.

### W0 — Pre-public disclosure audit (the gate; operator-heavy)

1. **History sweep**: run a secrets scanner over *full history* (e.g. `gitleaks` locally — result
   recorded in the brain, not committed), plus a targeted grep for internal hostnames, customer
   names, and person names across history, docs, and `.vfkb/entries.jsonl`.
2. **Operator ruling on identity/infra exposure**: the commit-author email and the internal
   registry hostname in CLAUDE.md are visible-by-design or must be scrubbed — decide explicitly.
   (Scrubbing history means rewriting it; that is a one-way door and must happen *before* the
   flip or not at all.)
3. **Brain triage**: skim the committed brain for entries that reference other private repos or
   internal context that shouldn't headline a public repo. The brain is a feature — "200+ real
   entries" is the README's proof point — so the default is *keep*; the audit is for surprises.
4. On flip day: enable GitHub **secret scanning + push protection** (free for public repos),
   confirm branch protection (review-gate **and** the new test workflow required), set repo
   description/topics/social preview.

### W1 — CI and community hygiene (independent of everything else)

1. **`test.yml`**: `npm ci && npm run build && npm test` on PRs and `main`, Node 20/22/24 matrix,
   actions SHA-pinned. Becomes a required check. README gets the badge (which then becomes true).
2. **`dependabot.yml`**: grouped monthly updates for npm (2 runtime deps + dev) and GitHub
   Actions. Low noise; supply-chain hygiene a public repo is judged on.
3. **Hygiene files** (one PR): `CONTRIBUTING.md` (branch→PR discipline, conventional commits,
   ADR/RFC-first for significant changes, the review gate — including the policy that
   **maintainers run the gate on external PRs**, contributors are not expected to produce
   `reviews/<sha>.json` — the L4 DoD, and the no-AI-attribution commit rule stated plainly);
   `SECURITY.md` (GitHub private vulnerability reporting; supported-versions table = latest 0.x);
   `CODE_OF_CONDUCT.md` (Contributor Covenant, mykb precedent); issue templates (bug/feature) and
   a PR template that asks the DoD question ("does this need an L4, or is it a structural
   invariant?"); `CODEOWNERS` (`* @vilosource`).

### W2 — Versioning and release automation

1. **Semver, 0.x honestly stated**: breaking changes allowed in minors until 1.0; PATCH = fixes,
   MINOR = features/breaking. The README already says "may move before 1.0". **1.0 criteria**
   (recorded now, decided later): storage schema, CLI surface, and MCP tool set frozen; install
   proven on both channels (npm L4 + plugin install L4 when unblocked).
2. **release-please** (PR-based release automation): parses the Conventional Commit history the
   repo *already writes* (`fix:`, `feat:`, `docs:`, `chore:` are the existing house style),
   maintains a standing **release PR** with the version bump + generated `CHANGELOG.md`. Merging
   that PR — an operator act, on a reviewable diff — creates the tag and the GitHub Release.
   This is the only release mechanism that is itself a PR, which is why it fits: the release
   artifact rides the same branch-protection + review path as everything else.
3. **Convention enforcement**: a light PR-title/commit lint (commitlint on the PR's commits) as a
   non-required CI check first; promote to required only if drift is actually observed
   (evidence-gated, per house rule).

### W3 — npm publishing (the new delivery channel, with its proof)

1. **`vfkb --version`** (prereq, trivial under the new strict parser): prints the package version
   embedded at build time. Needed by the install proof, doctor, and every future bug report.
2. **npm install-path L4** — *the ADR-0051 lesson applied before the first publish, not after the
   first incident.* Dockerized scenario: `npm pack` → clean Node 20 container → `npm i -g` the
   tarball → assert `vfkb --version` **content** (not exit code) matches `package.json`, `vfkb
   init && vfkb add && vfkb list` round-trips, and `vfkb-mcp` completes an MCP `initialize`
   handshake. Contrast arm: a deliberately broken pack (e.g. `files` missing `dist`) must go red.
   Unlike the plugin install L4 (RFC-024 §4, blocked on upstream `claude plugin tag`), **nothing
   blocks this one** — the channel is ours end to end. Runs in CI on the release PR.
3. **Publish workflow**: on release tag, publish `@vilosource/vfkb` to **public npmjs** via
   **trusted publishing** (GitHub Actions OIDC — no long-lived NPM_TOKEN) with **provenance
   attestation**. `publishConfig` flips from GitHub Packages to npmjs in the same PR.
4. **Post-publish canary** (same workflow, after publish): `npm i -g @vilosource/vfkb@<new>` from
   the real registry in a clean container, same content assertions. Only after this goes green
   does the README's install section gain the `npm install` command (a follow-up PR the workflow
   can remind about — delivery honesty: the docs claim follows the observed install).
5. **Cross-repo coordination**: a vfkb release does *not* auto-update the plugin (ADR-0045: the
   plugin vendors its own engine copy). The release PR template gains a checklist line — "does
   vfkb-claude-plugin need a re-vendor bump?" — manual first; automation (a workflow that opens
   an issue on the plugin repo per release) is **gated** on the checklist being forgotten once.

### W4 — Update awareness (how users learn a new version exists)

Layered, cheapest-first; every layer is pull or opt-in — **no phone-home by default, ever**:

1. **GitHub Releases + CHANGELOG.md** (free with W2): repo watchers get native notifications;
   the changelog is the canonical "what changed".
2. **`vfkb doctor --check-remote`**: opt-in flag (the exact shape RFC-024 proposed for remote
   checks) that compares the running version against the npm registry's `latest` dist-tag.
   Offline/registry-down → one quiet `skipped (offline)` line, never an error. Result cached
   24h next to the other derived state (gitignored). **Wording discipline**: the check compares
   *your installed CLI* against *the npmjs latest tag* and must say exactly that — the axis-(b)
   meta-lesson (operator-verified gotcha, 2026-07-10) showed a doctor line claiming more than the
   code compares survives L4s and reviews; and per the fix/doctor-currency-line precedent,
   changing doctor's observed output surface requires re-running the doctor-staleness L4.
3. **Plugin channel**: already covered — doctor's marketplace staleness check + remedy (shipped,
   live-verified 2026-07-10). Axis (b) (installed vs clone offer) stays gated per RFC-024 §1.
4. **Explicitly rejected for now**: auto-check on session start or in hooks (startup tax +
   privacy posture violation + hooks-fail-open means the result could silently vanish anyway),
   and any telemetry/analytics (nothing to decide — vfkb never calls home).

### What this RFC does NOT propose (named non-goals)

- No docs site / GitHub Pages (README + `docs/` carry it until demand is observed).
- No coverage gates, no eslint/prettier adoption (separate decision if ever; `tsc` is the floor).
- No monorepo restructure, no changesets, no automatic plugin re-vendoring (gated above).
- No 1.0 (criteria recorded in W2; the decision is its own future RFC).

## Consequences

- Conventional Commits stop being style and become load-bearing (release-please derives versions
  from them). The house history already conforms; the risk is a mislabeled `feat:`/`fix:`, which
  the release PR review catches — that is precisely why the release is a PR.
- Two new required checks (`test`, later the release-time L4) lengthen PR latency by ~1–2 min.
- Publishing creates a public artifact trail (npm provenance, GitHub Releases) that cannot be
  unshipped — versions can be deprecated but not deleted. That is the point.
- The W0 identity/infra ruling may force a history rewrite decision; deferring it past the flip
  makes it permanent. This RFC forces the question while it is still cheap.
- Maintainer surface grows: dependabot PRs, release PRs, external issues. All are batched or
  operator-paced; nothing auto-merges.

## Alternatives considered

- **semantic-release** (fully automatic publish on push to `main`): rejected — releases without a
  reviewable artifact violate the operator-reviews-releases constraint, and it fights branch
  protection. The failure mode it optimizes away (forgetting to release) is better solved by a
  standing release PR you can *see*.
- **changesets**: rejected — designed for multi-package repos and demands a changeset file per
  PR; ceremony without benefit for a single package with disciplined commit messages.
- **Manual releases** (operator runs `npm version && npm publish` locally): rejected — no
  provenance, no gate can run, bus-factor of one, and the corporate-Nexus local npm environment
  makes local publishing actively error-prone (`ENOTFOUND` off-VPN was hit during development).
- **update-notifier-style auto-check in the CLI**: rejected as default behavior (phone-home);
  its UX survives as the opt-in `doctor --check-remote`.
- **Publishing to GitHub Packages** (status quo config): rejected — requires auth even for
  public installs, which kills `npx`/casual adoption; npmjs is where Node users look.
