# Brain compatibility for a v3 rewrite — October 2026

> **Research survey.** What the operator's one hard requirement for v3 — *"the
> current records should not be lost when moving to v3 — so either compatibility
> or migration"* — actually costs, and what it forbids. Commissioned 2026-10-08
> after the operator ruled that **v3 may be a full rewrite**. Input to
> [`../PRD.md`](../PRD.md), whose non-goal N1 ("not a rewrite") this supersedes.
>
> **Verification discipline.** Claims are tiered:
>
> | Marker | Means |
> |---|---|
> | **[verified]** | observed in this session by running it — command and output read |
> | **[repo]** | read from the tree at `6b3de16` with a `file:line` |
> | **[agent]** | measured by the adversarial analysis agent and **not** re-run here |
>
> Where **[verified]** and **[agent]** disagree, the **[verified]** number is used
> and the difference is stated.

---

## 1. Verdict

> **Read-compatibility is not one of two options. It is the floor that both options
> stand on.** A perfect `vfkb migrate` does not remove the need for v3 to read a v2
> log, because three live mechanisms keep writing v2-format lines into a brain
> *after* it has been migrated.

1. **Mixed engines are live today.** This checkout is **0.9.1**; the installed
   plugin vendors engine **0.8.0** [verified]. Consumers upgrade on their own
   cadence, so a migrated brain keeps being appended to by older engines.
2. **The manifest cannot gate writes.** `readManifest` has **zero** call sites in
   `src/storage.ts`, `src/engine.ts`, `src/mcp-server.ts` and `src/cli.ts`
   [verified]. Raising `schema_version` would make `doctor` fail and `broadcast`
   refuse, while `kb_add` and the hooks keep appending in the old shape. And
   **15 of 27 brains on this machine have no manifest at all** [verified] —
   vfkb#193 — so anything keyed on it must treat absence as the common case.
3. **`merge=union` and the journal re-introduce old lines.** `.gitattributes` sets
   `.vfkb/entries.jsonl merge=union` [repo], so an unmigrated branch merging into a
   migrated one concatenates both formats into one file; `src/journal.ts` re-appends
   WAL lines **verbatim** when their `(id, updated)` pair is absent [agent].

**Therefore: commit to read-compatibility as a hard invariant of v3. Treat migration
as optional, and only ever as a layer on top.**

---

## 2. The good news — the loss mechanism is already named and already guarded

The specific way records would vanish is **already identified, already pinned, and
already carries a can-fail arm.** From `test/schema-honesty.test.ts:115`'s own
comment [repo]:

> **CAN FAIL (ADR-0070 §2):** change `z.looseObject` → `z.object` in the `validity`
> block of `src/validate.ts` and this goes RED. Observed: the key is silently
> stripped on read and every read-modify-write path then persists the stripped entry
> — **permanent loss on an append-only store** — while the rest of the suite stays
> green. That blindness is exactly what this test exists to remove.

Two guards exist: `:88` pins that an unknown **top-level** field survives the read
boundary, and `:115` pins the **nested** case for `validity` [repo]. ADR-0076's
deletion of `recorded_invalid_at` is the live proof the mechanism works — the
declaration was removed and legacy values still pass through.

**That is the single most important finding in this document**, because it means
option (a) is not a research project. The property v3 needs already exists and is
tested.

### 2.1 But the guard stops at the read boundary — one real gap

`:88`'s own name is *"unknown future fields survive the **read boundary**"*, and a
grep for a test asserting an unknown field survives a read-**modify-write**
round-trip finds **nothing** [verified].

The agent probed that a round-trip *does* preserve unknown fields — an entry
carrying `x_future`, `author.x_auth`, `refs.x_ref`, `provenance.x_prov` and
`validity.x_val` came back intact from `readAll()` **and** the appended raw line
still carried every one of them after `updateEntry()` [agent].

**Probed is not pinned.** If v3 relies on write-path passthrough — and under option
(a) with mixed engines it necessarily does — that behaviour needs its own guard,
with the mutation observed red. Tracked separately; it is small and real.

---

## 3. The on-disk contract — what a rewrite may and may not change

Envelope from `src/types.ts`, normalizer `src/validate.ts`, fold
`src/storage.ts:137-161` [repo]. "Persisted" below means the read-time default
becomes the stored value on the next mutation, because the write paths spread the
normalized entry [agent].

| Field | Read-boundary rule | May v3 change it? |
|---|---|---|
| `id` | required, `min(1)`; no usable id ⇒ excluded and counted as malformed | **NO.** Cited in prose by ~145 of 493 records and by structural `supersedes`/`contradicts` edges [agent]. Re-keying breaks both |
| `updated` | string else `''`; **the fold compares the RAW value lexically** (`r.updated >= cur.updated`) | **NO.** See risk 2 |
| `deleted: true` | tombstone, checked **before** normalization | **NO** — semantic fixed point |
| JSONL-one-line-per-record + LWW fold | — | **NO.** `merge=union` and journal recovery both assume it |
| `type`, `zone`, `author.role`, `provenance.status` | enums; an unknown value is **coerced** to `fact` / `incoming` / `executor` / `unverified` and the coercion **persists** | **Only with no old engine live.** Adding a value is breaking-by-stealth |
| `tags` | `string[]` else `[]` (persisted) | shape must stay an array |
| `text`, `why`, `created` | strings | free — content, not contract |
| `constitutional`, `adr_no`, `session_id` | optional, typed | additive-safe |
| `refs.*` beyond `supersedes`/`contradicts` | pass through unvalidated, never engine-written | free |
| `provenance.origin` | any shape | free |
| **unknown top-level and nested keys** | **pass through** (§2) | **free — and this is what makes (a) viable** |
| per-entry schema/version marker | **none exists**; only `manifest.json.schema_version`, which the write path never reads | — |

---

## 4. Record-loss risks, ranked

1. **Mixed-engine enum coercion persists.** A v3 value outside a v2 enum, read by
   the 0.8.0 engine, is coerced and the coercion is appended as the newest revision
   on the next mutation. The original line survives in the log but only a
   history-aware reader recovers it. **Not mitigated** [agent, mechanism verified
   in `validate.ts`].
2. **Lexical `updated` comparison.** A migrator or v3 writer that re-stamps
   `updated` in a different spelling silently resurrects older revisions, because
   the fold is a string compare, not a date compare [verified at
   `storage.ts:147`]. **Zero current instances** — all 1,388 live entries across
   all 27 brains use `YYYY-MM-DDTHH:MM:SS.mmmZ` [verified] — and **no test pins the
   ordering contract** [agent].
3. **Live-set-only migration.** Migrating the 476 live entries rather than the 493
   raw lines drops the 17 delta records, the tombstone semantics and first-seen
   ordinal order [agent]. A migration must rewrite the **raw log**.
4. **Missing `updated` is sticky.** `'2026…' >= undefined` is false, so neither a
   later revision nor a tombstone can displace a record with no `updated` [agent].
   Zero instances today; a migration emitting such records creates them.
5. **Journal verbatim re-append** post-migration by an old engine. Partially
   mitigated (commit the brain first; `VFKB_NO_JOURNAL=1`) [agent].
6. **`merge=union` across unmigrated branches** ⇒ one file, two formats. Mitigated
   only by option (a).
7. **Append-only is a convention, not a property.** Of the commits touching the
   log, **exactly two removed lines** — `2d7ab4a` and `d6242d0`, both 2026-07-06,
   one line each [verified]. **Git history, not the working-tree file, is the
   complete record.** Low risk, but it falsifies the assumption that the file alone
   can never lose anything.

---

## 5. Export → import is NOT a backup

Worth stating flatly because it is the obvious-looking migration path and it is a
trap.

`export okf` emitted **370 entry docs from 476 live** entries — a ratchet keeping
only verified + accepted + injectable — and its frontmatter carries just
`type, title, description, tags, timestamp, generated_by, resource`. Zone, author,
provenance, validity, status, `constitutional`, `adr_no`, `session_id`, `created`
and the `refs` edges are all dropped. `src/import.ts` reads mykb / ADR-dir /
markdown only, and **every import mints a new id** [agent]. ADR-0030 says so in its
own text: *"explicitly lossy … not guaranteed round-trip"* [agent].

The agent demonstrated the quiet-success trap on it directly:
`vfkb import --from-markdown <okf doc>` **exited 0** and produced a single `link`
entry with a brand-new id [agent]. Exit 0, nothing preserved — ADR-0051 §3's shape
exactly.

**It is a publishing projection. It must never be proposed as the migration.**

---

## 6. Blast radius — what option (c) would destroy

[verified] by folding every brain found on this machine with the same LWW rule the
engine uses:

| | |
|---|---|
| Brain files found | **27** |
| Physical lines, all brains | **1,425** |
| **Live entries, all brains** | **1,388** |
| Live entries in *this* repo | **476** |
| **Live entries elsewhere on this machine** | **~912** |
| Brains with no `manifest.json` | **15 of 27** |
| Live entries with a non-ISO `updated` | **0** |

The agent reported 25 brains / 1,228 live [agent]; my enumeration found 27 / 1,388.
The difference is the `find` scope, not a contradiction — both agree on the 15
missing manifests, and both are far above "this repo only". An unknown further count
exists on other machines; ViloGate (vfkb#193) is not on this one.

**Option (c) — start fresh — would orphan ~1,388 live records, ~912 of them outside
this repo.** The operator's requirement rules it out, and these are the numbers that
make the ruling right rather than merely cautious.

---

## 7. Proving "no records lost"

A migration is user-facing, so ADR-0050/0051 bind: sandboxed agent-driven L4,
DEMONSTRATED ≥2/3, a can-fail arm, every claim observed not asserted.

**The predicate must be a content assertion, never exit status or a count on
stdout** — §5 shows a "successful" import that preserved nothing. Shape [agent,
adopted]:

1. **Snapshot first** with the v2 engine: for every id, canonical sorted-key JSON;
   plus raw line count and `lastMalformed()`.
2. **After** migration or v3 read, assert **set equality of ids** (no drops, no
   fabrications) **and** per-entry canonical-JSON equality under a declared field
   map; tombstoned ids absent on both sides; the unknown-key sentinel still present;
   raw-record count equal if history is migrated; `malformed == 0` both sides.
3. **Fixtures:** a copy of this repo's real 493-line log, plus a synthetic brain
   carrying every edge in §3 — deltas, a tombstone, unknown top-level and nested
   keys, no manifest, a `role=import` entry.
4. **Can-fail arm, and it is free:** run the identical predicate over
   `export okf` → `import --from-markdown`. It must score **RED**. If it does not,
   the predicate is vacuous (ADR-0070, and brain `1af189641750` — observed-red is a
   floor, not coverage).

---

## 8. Recommendation

- **Make read-compatibility a hard invariant of v3**, stated in the PRD as a
  constraint rather than a goal. Everything else in the rewrite stays open.
- **Pin write-path passthrough** before anything else is built (§2.1). It is the one
  unguarded link in a chain v3 will lean on, and it is small.
- **Do not re-key ids. Do not re-stamp `updated`.**
- **If a migration is built, it rewrites the raw log**, not the live set.
- **Never route a migration through export/import.**

---

## 9. Primary sources

- `src/types.ts`, `src/validate.ts`, `src/storage.ts` (the fold at `:137-161`),
  `src/journal.ts`, `src/import.ts`, `src/export.ts`, `src/manifest.ts`,
  `src/broadcast.ts`, `.gitattributes`
- `test/schema-honesty.test.ts:88` and `:115` — the passthrough guards and the
  can-fail comment quoted in §2
- ADR-0019 (the brain is the SoR), ADR-0030 (manifest stamp; lossy export),
  ADR-0041 (`merge=union`), ADR-0042 (schema honesty), ADR-0064 (journal),
  ADR-0074/ADR-0076 and RFC-038 (unconsumed schema; the `recorded_invalid_at`
  deletion), ADR-0050/0051 (the DoD), ADR-0070 (guards that can fail)
- Brain: `da3b58990c1d` (the fold is not a line count), `1af189641750`
  (observed-red is a floor)

---

## 10. Not verified

- **The field-by-field "persisted" column** and the round-trip passthrough probe are
  **[agent]** — re-run them before relying on the write-path claim, which §2.1
  already flags as unpinned.
- **"~145 of 493 records cite other ids in prose"** is [agent]; the id-stability
  conclusion does not depend on the exact number, only on it being non-trivial.
- **The export ratchet (370 of 476)** is [agent].
- **Fleet totals differ** between [verified] (27 / 1,388) and [agent] (25 / 1,228);
  neither enumeration is claimed complete, and brains on other machines are
  uncounted.
- **vfwb-written entries** were not observed — vfwb is not on this machine, so
  whether its projection (ADR-0038) emits shapes outside this envelope is unknown.
- **Other consumers' vendored engine versions** — only `~/.claude-cldp`'s 0.8.0 was
  executed. Whether any consumer runs something older is unverified, and older is
  the direction that matters.
- **No effort estimate** for (a) or (b) is offered.
- **Nothing here is decided.** This is input to the PRD; a proposal becomes binding
  only as an RFC accepted into an ADR (ADR-0007).
