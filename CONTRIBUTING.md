# Contributing to vfkb

vfkb has some conventions that aren't the default for GitHub projects. This document is the
contract: it tells you what a maintainer expects, so a PR doesn't stall on something you had no
way to guess.

## Branch and PR — never `main`

All work lands on a topic branch and ships as a pull request. Nobody — maintainers included —
commits or pushes directly to `main`. Branch protection enforces this; a PR is the only path in.

- Branch from a fresh `main`.
- Keep the PR scoped to one change. Small, reviewable diffs merge faster than large ones.
- CI must be green: `test.yml` (npm ci → build → vitest, Node 20/22/24) and `review-gate.yml` are
  both required checks.

## Conventional Commits

Commit messages (and PR titles, since squash-merge uses them) follow
[Conventional Commits](https://www.conventionalcommits.org/): `feat: …`, `fix: …`, `docs: …`,
`chore: …`, `ci: …`, etc. This isn't cosmetic — release automation (ADR-0056) parses these
prefixes to generate the changelog and pick the next version, so a mislabeled commit produces a
wrong entry in a real release.

## No AI attribution — hard rule

Commits and PR descriptions in this repo **must not** carry AI-attribution trailers or markers:
no `Co-Authored-By: Claude` (or any other AI tool/assistant), no "Generated with …" footers, no
🤖, no `noreply@anthropic.com` or equivalent. This holds regardless of what tooling you used to
help write the change.

A commit-msg hook enforces this for maintainer commits. If your PR's commits carry this kind of
trailer, you'll be asked to reword them (`git commit --amend` / interactive rebase) before merge —
this isn't a judgment on how you worked, it's just keeping the history clean.

## Decisions before code

Significant, architecture-level changes don't start as a PR — they start as a **written proposal**.

- Proposals live in [`docs/rfc/`](docs/rfc/README.md) as RFCs (Nygard format: Context, Decision,
  Consequences, Alternatives Considered).
- On acceptance, an RFC becomes an **ADR** in [`docs/adr/`](docs/adr/README.md) — the immutable,
  numbered decision record.
- If you're proposing something structural (a new dependency, a changed data format, a new
  workflow, a behavior change an agent will rely on), open the RFC first. If you're not sure
  whether your change counts, ask in the PR or issue before doing the work — it's cheaper to find
  out early.

Small fixes, docs corrections, and refactors that don't change behavior don't need this — just
open the PR.

## The Definition-of-Done question

Before a change is considered done, we ask what kind of claim it's making:

- **Structural invariant** (something that must always hold, e.g. a schema constraint, a
  guardrail) → prove it with a deterministic unit/integration test.
- **User-facing capability** (something an agent or human will actually *use*) → prove it with an
  agent-driven L4 scenario, observed end-to-end in a sandbox, per ADR-0050. A test suite passing
  is not the same claim as "this works when someone tries to use it."

If you're not sure which bucket your change falls in, say so in the PR — a maintainer will help
decide. Don't guess and skip the proof.

## The review gate — what external contributors do (and don't) need to do

vfkb requires an adversarial pre-merge review record (`reviews/<sha>.json`, ADR-0052) for changes
to implementation paths. **External contributors are not expected to produce this file.** A
maintainer runs the adversarial review gate against your PR and files the record as part of
merging it. You don't need `reviews/` tooling, a maintainer role, or any special access to
contribute — just open the PR and a maintainer will run the gate.

## Build, test, run

Requires **Node >= 20** (CI matrix: 20, 22, 24).

```bash
npm ci
npm run build   # tsc -> dist/
npm test        # vitest — the fast deterministic gate
```

`npm run build` runs automatically before `npm test` (`pretest`). There is no lint/format step
required yet; keep changes consistent with the surrounding code style.

## Reporting bugs and requesting features

Use the issue templates — they ask for the minimum a maintainer needs to triage: what you
expected, what happened, and how to reproduce it. A vague "it doesn't work" without a repro is
usually closed with a request for more detail, not fixed on guesswork.

## Pull request template

The PR template asks the DoD question above plus one vfkb-specific check: whether your change
affects behavior the [vfkb-claude-plugin](https://github.com/vilosource/vfkb-claude-plugin) vendors
a copy of (hooks, MCP tools, bundled engine) — if so, that plugin needs a re-vendor bump on its own
release cadence, separate from this repo's merge.

## Security issues

Do not open a public issue for a security vulnerability — see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Participation implies
agreement to it.
