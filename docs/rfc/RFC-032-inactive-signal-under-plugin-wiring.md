---
type: RFC
title: "RFC-032: Restore the 'vfkb INACTIVE' signal under plugin wiring"
description: "The retired bootstrap emitted an actionable INACTIVE banner when the engine was unresolvable; the plugin cannot warn when it is not running, so a session in a plugin-wired repo silently loses continuity, gating, and capture. Proposal: a deterministic, engine-free repo-side guard hook that compares the project's declared plugin against installed_plugins.json fulfillment, plus a prose tripwire and an upstream ask."
status: Proposed
timestamp: 2026-07-13
---

# RFC-032: Restore the "vfkb INACTIVE" signal under plugin wiring

- **Status:** Proposed
- **Date:** 2026-07-13
- **Deciders:** operator + Claude
- **Relates:** vfkb-claude-plugin#4 (the tracked gap), gotcha `fde3f0e52e61` (PR #75 review
  finding that named it), [ADR-0045](../adr/ADR-0045-claude-code-plugin.md) (the migration that
  removed the bootstrap banner), [ADR-0048](../adr/ADR-0048-retire-wiring-smoke-gate.md)
  (retired the wiring smoke gate; its successor — plugin#15's hooks-smoke — proves the wiring
  *works when loaded*, which is exactly not this problem: this RFC is about noticing when it
  is *not loaded at all*), [RFC-024](RFC-024-staleness-detection-and-delivery-honesty.md)
  (declared-vs-actual drift detection is the same shape as its §1 doctor check),
  [ADR-0022](../adr/ADR-0022-l4-purpose-evaluation.md) / [ADR-0029](../adr/ADR-0029-dod-e2e-purpose-proof.md)
  (the proof discipline the scenario below follows)

## Context

Before ADR-0045, every consumer repo committed its own wiring, and `bootstrap.mjs` emitted an
actionable **`vfkb INACTIVE — set VFKB_BUNDLE_DIR`** SessionStart banner whenever the engine was
unresolvable. The failure mode was loud.

With the plugin, the wiring lives inside the plugin — which by definition is not running when it
is absent. An uninstalled, never-fulfilled, or unapproved plugin means the session runs with **no
continuity injection, no brain-write gate, no decision-capture reminder, no session-end
auto-commit — and no banner**. Nothing tells the operator. This is a silent-degradation failure
of exactly the class ADR-0051 names: the session *looks* normal.

**Observed fulfillment reality (2026-07-13, this machine):** 8 repos are plugin-wired
(`extraKnownMarketplaces` + `enabledPlugins` in project `.claude/settings.json`), but
`~/.claude/plugins/installed_plugins.json` carries a `vfkb@vfkb` entry for **only one**
`projectPath` (`~/VFKB/vfkb`). Declaration and fulfillment are recorded in different places, and
only their combination means "the next session actually runs vfkb." That gap **is** the
deterministic detection surface.

## Proposal (composite, deterministic-first)

### 1. Repo-side guard hook (the Brake — deterministic, engine-free)

A ~20-line script, committed to the consumer repo (e.g. `.claude/vfkb-guard.mjs`) and wired as a
`SessionStart` hook in the same project `.claude/settings.json` that declares the plugin. Node
stdlib only — it must not depend on the engine whose absence it detects. Logic:

- Read the project's own `.claude/settings.json`; exit silently unless it declares
  `enabledPlugins["vfkb@vfkb"]`.
- Read `~/.claude/plugins/installed_plugins.json`; look for a `vfkb@vfkb` entry with
  `scope: "user"`, or `scope: "project"` whose `projectPath` matches this repo.
- On a miss, print a `vfkb INACTIVE` banner (hook stdout → session context): the plugin is
  declared for this project but not installed/loaded — with the fix
  (`claude plugin install vfkb@vfkb`, or approve the plugin's MCP server + hooks in an
  interactive session) — then exit 0. **Fail open on any read/parse error** (a broken guard must
  never block a session; it is a smoke alarm, not a lock).

Distribution: template in the plugin repo's `SETUP_GUIDE.md`/`MIGRATION_GUIDE.md`, emitted by
`vfkb init` for plugin-wired setups, and swept across this machine's 10 repos on acceptance.

*Accepted trade-off:* this reintroduces a small repo-side wiring footprint that ADR-0045 had
removed. It is static, engine-free, and exists precisely because the plugin cannot self-report
absence — the one job that cannot be delegated to the thing that might be missing. The guard
reads Claude Code's internal `installed_plugins.json`, an undocumented surface that may drift;
the guard fails open and its L4 re-pins on plugin releases, which bounds the blast radius of a
format change to "the banner goes quiet again," never "sessions break."

### 2. Prose tripwire (belt-and-braces)

One line added to the `vfkb:how-we-track-work` section already shipped in every consumer
AGENTS.md/CLAUDE.md: *"If the `kb_*` MCP tools are absent from this session, say so and stop —
the vfkb plugin is not loaded."* Zero infrastructure; catches cases the guard cannot see (e.g. a
future fulfillment-state format change). Per the founding lesson a prose rule alone would not be
enough — it rides along, it is not the mechanism.

### 3. Upstream ask (the real fix, external)

File a Claude Code feature request: surface enabled-but-unloaded project plugins at session
start. If upstream ships it, the guard retires the way bootstrap did.

## Known limitation (stated, not hidden)

The **installed-but-unapproved** state may be invisible to the guard: probing shows fulfillment
is recorded in `installed_plugins.json`, but interactive approval state lives elsewhere and its
observability is unverified (headless `-p` runs executed the plugin's hooks without any approval
step, so approval semantics differ by session type). The guard decisively covers *uninstalled /
never-fulfilled / wrong-project* — the modes actually observed on this machine. Approval-state
detection is a build-time investigation item; if it proves undetectable, the banner text and this
RFC's Consequences section say so explicitly.

## Definition of Done (ADR-0023 — the scenario is the contract)

`scenarios/inactive-signal.mjs` (plugin repo, reusing the hooks-smoke sandbox harness: sandboxed
HOME, real `claude -p`):

- **Positive arm** — sandbox repo with the guard + declaration, plugin **not** installed in the
  sandbox HOME: a turn's observed context/output names the INACTIVE banner (content assertion on
  the banner's unguessable phrasing).
- **Contrast arm** — identical sandbox, plugin installed: banner absent AND vfkb behaves normally
  (sentinel resume-injection observed, proving the guard is silent exactly when vfkb is live).
- DEMONSTRATED ≥2/3 per ADR-0022; record committed and registered in the plugin release gate's
  `REQUIRED` alongside `brief-skill` and `hooks-smoke`.

## Alternatives considered

- **Prose-only tripwire:** rejected as the mechanism (an LLM may skip it — the founding lesson;
  it survives only as layer 2).
- **`vfkb doctor`-only:** a session silently missing vfkb is precisely a session where nobody
  thinks to run doctor; detection must be ambient. (A doctor check is still worth adding
  opportunistically — it is the RFC-024 §1 shape — but it is not the answer to plugin#4.)
- **Upstream-only:** correct long-term, externally blocked, unbounded timeline (layer 3, not the
  fix).
- **Plugin-side self-report:** impossible by construction; the plugin is not running.
