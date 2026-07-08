---
type: Decision
title: "ADR-0032: Rename the env vars for clarity — `VFKB_DATA_DIR` (brain) + `VFKB_BUNDLE_DIR` (engine); old names kept as deprecated aliases"
description: "Rename env vars for clarity — `VFKB_DATA_DIR` (brain) + `VFKB_BUNDLE_DIR` (engine); old names kept as deprecated aliases"
status: "Accepted"
timestamp: 2026-06-30
---

# ADR-0032: Rename the env vars for clarity — `VFKB_DATA_DIR` (brain) + `VFKB_BUNDLE_DIR` (engine); old names kept as deprecated aliases

- **Status:** Accepted
- **Date:** 2026-06-30
- **Deciders:** operator + Claude
- **Amends:** [ADR-0030](ADR-0030-consumer-integration-and-distribution.md) /
  [ADR-0031](ADR-0031-bootstrap-engine-resolution-guard.md) — which used `VFKB_DIR` and `VFKB_HOME`.
  Brain: decision (this ADR).

## Context

vfkb has two distinct location variables that are **easily confused** because the names don't convey
their jobs and look similar:

- **`VFKB_DIR`** — *where the brain (data) lives* (`.vfkb`, relative, per-project).
- **`VFKB_HOME`** — *where the engine (code) lives* (the bundles dir, shared per machine; introduced
  by ADR-0030/0031).

A consumer reasonably asked whether pointing `VFKB_HOME` at the shared engine would cause knowledge to
be written into **vfkb's** brain instead of *their* project's `.vfkb`. (It does not — `VFKB_DIR=.vfkb`
is resolved against the project's working directory, independently of `VFKB_HOME` — verified.) But the
fact that the question arises at all is a naming smell: `…_DIR` vs `…_HOME` gives no hint that one is
*data* and the other is *code*.

## Decision

Adopt **purpose-revealing, parallel** canonical names:

- **`VFKB_DATA_DIR`** — the brain/data directory (was `VFKB_DIR`).
- **`VFKB_BUNDLE_DIR`** — the engine bundles directory (was `VFKB_HOME`).

The **old names are kept as deprecated aliases** — resolution reads the new name first, then the old,
then the default:

- brain: `process.env.VFKB_DATA_DIR ?? process.env.VFKB_DIR ?? ~/.vfkb` (`src/storage.ts`);
- engine: `process.env.VFKB_BUNDLE_DIR ?? process.env.VFKB_HOME` (the emitted bootstrap + `src/doctor.ts`).

So **nothing breaks** — this repo's live wiring, every existing clone, and committed-brain wiring keep
working on the old names. `vfkb init` now **emits the new names**; `vfkb doctor` **warns** when a
deprecated alias is in use. The aliases are removed at a future **major version**.

The two runtime resolution points are the entire back-compat surface; everywhere else the name is only
*written* (wiring, docs, tests).

## Consequences

- **+** The names convey their job (`DATA` vs `BUNDLE`), killing the "which brain does this write to?"
  confusion; the two are visibly parallel (`…_DIR`).
- **+** Zero breakage (aliases); `doctor` nudges migration rather than forcing it.
- **−** Two names per concept during the deprecation window; historical ADRs/RFC keep the old names in
  their (immutable) text — this ADR is the pointer that supersedes them.

## Alternatives Considered

- **Hard rename, no aliases.** Rejected — would break this repo's live wiring, the committed dogfood
  brain wiring, and every clone in lockstep.
- **Keep `VFKB_DIR` / `VFKB_HOME`.** Rejected — the confusion this fixes (the consumer's question).
- **`VFKB_LOCAL_BUNDLE_PATH` / `VFKB_ENGINE_DIR` for the engine var.** Considered; `VFKB_BUNDLE_DIR`
  chosen for brevity + symmetry with `VFKB_DATA_DIR` (both name a directory).

## Related

[ADR-0030](ADR-0030-consumer-integration-and-distribution.md),
[ADR-0031](ADR-0031-bootstrap-engine-resolution-guard.md). Gates: `src/env-compat.test.ts` (brain
alias precedence), `src/bootstrap.test.ts` (engine alias), `src/doctor.test.ts` (deprecation warning).
