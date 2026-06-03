# ADR-0005: Auto-injection filters known-stale entries; injects unverified (labeled)

- **Status:** Accepted
- **Date:** 2026-06-01
- **Deciders:** operator + Claude

## Context

The D7 auto-context-injection layer is **push** — the agent does not choose what
arrives. The ASDLC *Context Anchoring* concept ("Pink Elephant Problem") shows an
LLM is biased by the mere **presence** of a token, even one labelled
deprecated/superseded. ADR-0004 makes the decision family immutable-supersede, so
the store will **deliberately accumulate** superseded entries — the injector must
be disciplined about what it pushes.

## Decision

The auto-injection (push) path:

- **EXCLUDES from the live window:** entries with status `superseded` or
  `deprecated`, and `zone=archive`. The "we used to do X, now Y because Z"
  narrative lives in the **current** entry's text — the stale entry itself is
  never injected.
- **INCLUDES `unverified` entries, clearly trust-labelled** (author + status), so
  the agent **weighs** them (D3d). `unverified` ≠ wrong; this preserves the
  "inherit the freshly-discovered gotcha" value.
- **Pull queries** (`kb_search`) MAY still return stale entries when explicitly
  asked (e.g. history/audit). **Only the push path filters.**

## Consequences

- **+** Protects D7 from anchoring agents on guidance we know is stale.
- **+** Fresh, unconfirmed lessons still surface (labelled) — D7 stays valuable.
- **+** Composes with ADR-0004 (supersession) and ADR-0008 (constitution is
  current/established → always injected).
- **−** The injector must join `status`/`zone` at render time and pass trust
  labels through to the rendered block.

## Alternatives Considered

- **Inject everything, just label the stale ones** — rejected: the Context
  Anchoring finding says presence-not-absence drives bias; labels don't prevent it.
- **Inject verified/established only (drop unverified from push)** — rejected:
  buries freshly-discovered gotchas until something verifies them, undercutting the
  core "memory volunteers" value.
