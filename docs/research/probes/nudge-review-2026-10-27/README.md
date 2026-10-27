# Handoff-nudge review and redesign (2026-10-27, read-only)

Scope: `src/stop-reminder.ts`, `src/cli.ts` (`hook stop`), `src/session.ts`, `src/session-end.ts`, RFC-043 and its evidence, the two Jev spikes, the brain, local transcripts, and the Claude Code hooks reference. Nothing was edited, committed, or recorded. "Observed" = read from code, git, transcripts or docs on this machine; "inferred" is labelled.

---

## 1. Current state

### 1.1 What fires, and when (observed from code at HEAD `78dc7b9`)

Every Stop runs `cli.ts hook stop` (`src/cli.ts:736-797`), which bumps the session turn, gathers git/brain context (`gatherStopContext`, `src/stop-reminder.ts:341-350`), and calls the pure `decideStop` (`:117-151`).

| Nudge | Trigger (all must hold) | Where | Governed by |
|---|---|---|---|
| `decision` | `uncommittedWork` (uncommitted `src/` or `docs/` paths, `:154-168`) AND no `decision` entry appended since HEAD | `:141` | ADR-0027 |
| `handoff` (B1) | `uncommittedWork` AND ≥3 new entries since HEAD AND none tagged `handoff`/`next` | `:144-145` | ADR-0034 |
| `staleHandoff` (B3) | `handoffIsStale()`: tree at HEAD differs, outside the brain dir, from `git rev-list -1 --before=<pin.created> HEAD` (`:283-338`). **Not** gated on work, turn, branch, or tree cleanliness | `:148` | **nothing** (RFC-043 is Proposed; code comment `:84` still says "built NOT yet verified") |

Each nudge is independently rate-limited: it stays quiet while `turn - lastNudged[key] < NUDGE_COOLDOWN_TURNS` (=10, `:57`, `:126-132`). The cooldown is only a rate limit; nothing turns a trigger off except the trigger's own condition changing. The loop guard (`stop_hook_active`) is honoured at `cli.ts:745` before any git work.

### 1.2 Direct answer: "does it still fire deterministically every 10 turns?"

**Yes, for B3, and the transcripts confirm it is exactly that.** The cooldown works as built, but a stale pin is a persistently-true trigger, so B3 fires on the first eligible turn and then every 10-11 turns for the rest of the session. Inter-fire gaps measured over this repo's transcripts (`~/.claude-cldp/projects/-Users-jasonviloria-GitHub-vfkb`, method in §1.4):

```
61f0e751  132 turns  fires at [1,12,22,33,43,53,63,73,83,93,103,117,127]  gaps 10-14
d5948d4c   52 turns  fires at [2,13,26,38,49]                              gaps 11-13
edf377bb   45 turns  fires at [9,19,30,40]                                 gaps 10-11
5f0c8ff1   36 turns  fires at [4,14,25,36]                                 gaps 10-11
bc6bd01e   20 turns  fires at [3,14]; aa23d1ab 17 turns fires at [1,12]
```

Nothing has improved the *cadence* since the 2026-07-31 ruling (`ba74ec9a44e5`, PR #272). The only later changes to the file are a realpath fix (#281) and ADR-0082's single pin selector keyed on `created` (#371). **RFC-043 Parts 0, 1 and A are unbuilt**: the anchor is still the committer-date tree diff (`:323-330`), and the B3 text still carries the clause that makes agents write premature handoffs (`:104-106`: "…has no SessionEnd fallback … must be recorded before the session ends").

The cooldown mechanics do hold live (observed): `cli.ts:766-772` loads `SessionState` by the harness `session_id` (persisted under `.vfkb/.sessions/<id>.json`, `session.ts:140-143`), bumps and saves *before* trusting the state (`:769-770`), and `markNudged` records the turn (`session.ts:197-199`). The 15 local session records all show `nudgedAtTurn.staleHandoff` set; e.g. `61f0e751 turns 126 nudged {staleHandoff:122}`. Fail-open paths (all toward *firing*): missing/invalid turn (`stop-reminder.ts:126-131`), save failure (`cli.ts:773-775`), malformed record (`session.ts:57-64`), no `session_id` in stdin → ephemeral state → fires every turn (`session.ts:141`; never observed in Claude Code, which always sends `session_id`).

One more live fact: all three profiles on this machine (`~/.claude-cldp`, `~/.claude`, `~/.claude-cldw`) have plugin **0.18.0** installed while **v0.21.0** is the latest tag. So live sessions here run the *pre-ADR-0082* B3 (raw-line selector keyed on `updated`), not the code reviewed above. Update before re-measuring anything.

### 1.3 Intrusiveness failure modes (observed unless marked)

1. **Repeat fires on a fact that cannot change mid-session.** A stale pin stays stale until a *new* handoff is written, so B3 re-fires every 10 turns regardless of what the session is doing. The reminder text itself invites compliance, so the loop in RFC-043 ("mid-session handoff → next merge makes it stale → re-arm") is live: `61f0e751` 13 fires / 9 handoff writes, `edf377bb` 4 fires / 7 writes.
2. **Fires before any work.** 8 of 37 fires were on turn 1 or 2 (4 interactive sessions at turn 1, 4 single-turn sessions). A turn-1 fire can only produce a handoff that says nothing new.
3. **Fires where the agent cannot act safely.** Sessions whose record says `branch: main`: `edf377bb`(4 fires), `bc6bd01e`(2), `aa23d1ab`(2), `75332ea1`(1), `5ac6751b`(1) = 10 of 37. On `main` the SessionEnd hook never commits (`session-end.ts:193-201`), so a handoff written there is an uncommitted line in the `main` checkout; RFC-043 documents the resulting cross-session collision.
4. **Fires in one-shot headless sessions** (review gates): 4 single-turn sessions in the window each got one fire and each wrote a handoff, which then becomes the pin (`latestHandoff` picks newest-created, `engine.ts:539-554`) and displaces the operator's.
5. **False fires from the anchor rule (cause 1 in RFC-043).** A squash merge is dated after the handoff it carries and contains the PR's code, so the merge that lands a correct handoff makes it stale (gotcha `68ea8f1db58d`; 12 of 60 `main` commits had this shape). Not re-measured here; the live check now (§1.5) happened to be a true positive.
6. **Cost of a blocked stop.** It forces at least one extra model turn. Measured over the 37 fires (§1.4): median **2,283 output tokens, 3 assistant messages, 1 tool call, 19 s wall**; mean 5,490 tokens / 42 s; worst 48,588 tokens / 43 messages / 301 s. Input-side, each fire re-reads the whole context (median 727k cached-input tokens per fire). Totals in the window: 203k output tokens, 1,555 s.
7. **Premature handoffs are the majority outcome.** 20 of 37 fires were "acted" (handoff written before the next user prompt); 32 of 37 were mid-session; only 5 on a final turn. Across all 68 sessions in the `cldp` profile: 91 B3 fires, 75 mid-session, 56 acted. B1 fired 2 times, `decision` 15, all declined.
8. **Decision and B1 nudges are not the problem.** 0 fires in this repo's window. Any redesign budget belongs to B3.

### 1.4 Measurement method (local only, nothing left the machine)

- Fires/acted/final-turn: the committed probe `docs/research/probes/stop-nudge-2026-10-19/nudge-fires.py` run over the three profiles' vfkb project dirs (17 transcript files, 18 sessions with prompts) and over `~/.claude-cldp/projects/-Users-jasonviloria-*` (68 sessions). It counts `hook_additional_context` attachments containing each reminder's lead-in string.
- Gaps: a 20-line script counting typed prompts (`promptSource` set) between fires per session.
- Cost: for each fire, sum `usage` of assistant records between the attachment and the next typed prompt; 37 fires confirmed by deduping on attachment type (each fire has a `hook_success` and a `hook_additional_context` record, both with the same text).
- Stop hook latency: one live invocation of the installed bundle, `0.31 s` wall.

### 1.5 Live check of the trigger right now

Pin `c708f71279b6` (created 2026-10-27T07:36Z); anchor `d672946`; non-brain diff to HEAD empty → **not stale on this branch**. At this session's start on `main` the previous pin (`587217146235`, 2026-10-23) had two later non-brain commits (`57dbb9b` ADR-0083, `d672946` #379), so the turn-1 fire this session received was a *true* stale signal, delivered at the one moment it could not be useful.

---

## 2. Research: surfaces and how others do it

Claude Code hooks reference (`https://code.claude.com/docs/en/hooks.md`, fetched 2026-10-27, quotes verbatim):

- **Stop `additionalContext` is not a non-blocking channel.** "It keeps the conversation going through the same loop protections as `decision: "block"` … but the transcript labels it `Stop hook feedback` and no hook error notification is shown." So there is no cheaper Stop output than today's; vfkb already uses this form. New: an **8-consecutive-continuation cap** (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`), and Stop input now carries **`background_tasks` and `session_crons`** "to distinguish 'session is done' from 'session is paused waiting for background work'". vfkb ignores both today.
- **UserPromptSubmit `additionalContext`**: "added as context … Neither channel produces a visible transcript entry … injected as a system reminder". It costs **no extra turn**, and the hook sees the user's `prompt` (gotcha `fc07da198bfa`). Default timeout 30 s. This is the least intrusive injectable surface that exists, and it is the one moment the "is the user wrapping up?" question has its answer in hand.
- **SessionEnd**: side effects only, cannot block or inject (matches gotcha `f0e913b97824`). **New and load-bearing:** "SessionEnd hooks have a default timeout of 1.5 seconds … Timeouts set on plugin-provided hooks don't raise the budget." The plugin's `hooks.json` sets no timeout. vfkb's SessionEnd runs git status/show/add/commit plus ADR-0083 Tier-1 curation and the B2 fallback. Auto-commits did land on 2026-09-28 (`77d1fcf`, `1af2e50`), so it has worked, but whether it still fits a 1.5 s budget on this CLI is **unverified** and needs a Tier-0 probe before any design leans harder on B2.
- **PreCompact**: can block, cannot inject. **PostCompact**: no decision control. The existing path for post-compaction context is SessionStart `source=compact` (ADR-0077).
- **Notification `idle_prompt`**: fires ~60 s after a response if the user has not typed; side effects only, cannot prompt the agent. Usable as a signal store for the next prompt, not as a nudge.
- **`type: "prompt"`/`"agent"` hooks**: cannot see the user's prompt on Stop and loop without a guard (`fc07da198bfa`, 10 consecutive blocks on "Say hi"). RFC-043 already rejects them.
- **Statusline**: a display surface for the user, not the agent; it could show "pin stale by N commits" without any agent cost, but it does not produce a handoff.

Other memory systems (web search 2026-10-27): claude-mem hooks SessionStart/tool calls/SessionEnd and compresses tool observations with a model into local SQLite ([claude-mem](https://www.mintlify.com/thedotmack/claude-mem/introduction)); Recall summarises at SessionEnd via a local Ollama model ([Recall](https://glama.ai/mcp/servers/@blueman82/recall/blob/133ed3135513d1d68fb160b90613b7268c19b7e0/docs/hooks-setup.md)); mcp-memory-service consolidates at SessionEnd ([session-end.js](https://glama.ai/mcp/servers/@doobidoo/mcp-memory-service/blob/6bc79aa7e7093c2361a12df5b4844dcc76b8a494/claude-hooks/core/session-end.js)); Cursor's Memories use "a sidecar approach where another model observes conversations and automatically extracts relevant memories in the background", plus an agent tool for explicit saves ([Cursor docs](https://docs.cursor.com/context/memories)); Claude Code's own auto-memory is agent-decided during the turn. Comparison: [mer.vin](https://mer.vin/2025/12/ai-coding-assistant-memory-systems-compared-claude-vs-gemini-vs-codex-vs-windsurf-vs-cursor/). **Pattern: none of them blocks the agent's stop to ask for a summary.** They either derive one mechanically at SessionEnd (vfkb's B2 shape) or let a sidecar extract in the background. vfkb's blocking Stop nudge is the outlier, and its justification (ADR-0034's 3/3 vs 0/3 quality contrast) was for B1, which no longer fires.

---

## 3. Jev-shadows-every-turn: critical assessment

**Evidence as it stands.** Spike 1: FAIL, underpowered. Re-spike: PASS on the pre-registered bar (all-turns AUROC 0.878, hard-case 0.812 [0.742-0.873]) but: test-split labeller κ 0.571 < 0.6 floor; every looser labeller rule → NOT DECIDED; the filter correlates with the score (AUROC 0.762 predicting the labellers' verdict); unfiltered hard-case AUROC 0.675; the hard set is 490/504 "assistant said done, work continued" (B2-rule false fires); ECE 0.52 so no threshold is readable. The README's own reading: "narrow and labeller-dependent". **Gate 1 (B3 still fires mid-session after Parts 0/1/A) is unmeasured because Parts 0/1/A are unbuilt.** RFC-043 says Part B is built only if both gates pass; today one is fragile and one is unmeasured.

**Shadowing every turn, specifically:**

| Concern | Assessment |
|---|---|
| Latency | Jev p50 0.20 s / p95 0.26 s measured; a 1.5 s timeout on every Stop is tolerable. Not the problem. |
| Cost | ~$0.0001 per call; negligible. Not the problem. |
| Privacy | The window (last 3 user prompts + final-message tail) goes to a third party on every turn. RFC-043 makes this per-project opt-in, off by default. "Shadow every turn" for one operator is fine under ruling `00cff7e60454`; as a product default it is a new processor for every consumer's transcript fragments and needs README/ADR disclosure. Secret filtering exists (`detectSecrets`) but is heuristic. |
| Availability / fail-open | RFC-043's design fails toward *today's* behaviour (fire). So an outage makes it exactly as intrusive as now, never worse. Fine. |
| Non-determinism | 15 answer sets in 50 identical calls (survey §2.3). Acceptable only because it *times* a nudge (relevance cost), never gates one; survey §3/§4 and brain `aa294b2708c4` forbid anything stronger. The doctrine "deterministic backstop > probabilistic gate" is satisfied only if the deterministic floor for a *stale* pin exists (Part A), which it does not yet. |
| ADR-0050 verification | Replay fixtures can prove plumbing and policy, not judgment; the RFC says so. The shadow-to-act gate needs ≥100 consulted Stops *and labels*, and the operator ruled no hand labels — so the gate would be AI-labelled again, with the same κ problem. A can-fail L4 for "the model chose the right moment" does not exist and cannot be made deterministic. |
| Does it answer the right question? | This is the decisive point. At Stop, Jev must *predict* whether the next prompt will be a wrap-up. At the **next UserPromptSubmit the prompt is in hand**, and the agent — a far stronger judge than Jev, with full context — can read it for free, with no extra turn. A nudge delivered there needs no timing model at all. |
| Do cheaper signals come first? | Yes: cause-1 false fires (Part 0), turn-1 fires, `main`+clean-tree fires, single-turn sessions, `background_tasks` deferral. These are deterministic, unit-testable, and account for a large share of the 37 fires (8 turn-1, ~10 on `main`, 4 single-turn; cause-1 share unmeasured). |

**Hybrids.** "Deterministic eligibility, Jev timing" is RFC-043's own shape and is sound in principle, but after moving the reminder to UserPromptSubmit there is no timing problem left to solve on Stop. "Shadow/log-only first" is the right *order* if Jev is ever built, but running it on every turn to collect labels re-creates the labelling problem the re-spike could not close.

**Recommendation: do not build Jev-shadows-every-turn now.** Keep Part B exactly where RFC-043 leaves it (gated), build the deterministic parts, move the reminder to the next prompt, re-measure, and revisit only if the residual mid-session rate still clears gate 1. If the operator wants Jev data regardless, the honest minimum is a per-project opt-in log-only shadow on this repo only, with the log reviewed by hand, and no act mode.

---

## 4. Proposed design, phased

All phases keep the B2 floor and the Stop hook's loop guard. "Proof" distinguishes the deterministic inner gate (unit) from the capability gate (L4, ADR-0050/0051, can-fail arm, content assertions).

### Phase 1 — deterministic suppressions in `decideStop` (highest benefit/effort; ~1 day; unit tests only)

| Change | Trigger logic | Removes | Missed-handoff risk | Proof |
|---|---|---|---|---|
| 1a. **No B3 before turn 3** | `turn` valid AND `turn < 3` → B3 quiet (fail-open: invalid turn → today) | 8/37 fires, incl. all single-turn headless sessions and the reviewer-pin displacement | None: a turn-1 handoff carries no new information | unit |
| 1b. **Defer every nudge while `background_tasks` or `session_crons` is non-empty** | read from Stop stdin; absent → today | fires on "paused" stops (RFC-043 act-mode item, now free) | None | unit (CLI e2e with the payload) |
| 1c. **No B3 on the default branch with a clean tree** | branch = default AND `!uncommittedWork` AND no new entries | ~10/37 fires where SessionEnd cannot commit and a write collides with other sessions | The stale fact is still shown at the next SessionStart once Part A exists; until then, a `main` session leaves the pin stale (today it leaves an uncommitted line, which is worse) | unit |
| 1d. **Part 1 text** | drop the "must be recorded before the session ends" clause; state what moved and that the next session will see it | the clause behind 18/24 premature writes | None once Part A exists; before Part A, slight | unit (text pinned) |
| 1e. **Cooldown → once per session for B3** | B3 `lastNudged` set → quiet for the rest of the session | every repeat fire (all gaps above) | The agent that declined once is not reminded again on Stop; covered by Phase 3's next-prompt line | unit |

Relation to RFC-043: 1b and 1d implement its items; 1a/1c/1e are new deterministic WHEN-rules. **Operator ruling needed**: `e68ad28f11b6` says "a decision model only decides WHEN … the deterministic stale-pin precondition stays"; 1a/1c/1e add deterministic WHEN-rules, which the ruling did not foresee. Also decide the Phase-1 default: ship 1a/1b/1d now (no floor needed), hold 1c/1e for Phase 2.

### Phase 2 — Part A stale-pin floor + Part 0 anchor (RFC-043 as written; ~3-5 days)

- **Part A**: in `renderContextBundle`, under `## Last handoff`, list the commits since the pin (set `S`), read-only, neutral wording, bounded, injected provider so the engine stays git-free. This is what makes any suppression safe: a wrong "stay quiet" costs relevance, not continuity.
- **Part 0**: first-parent anchor, carrier exclusion, author-date rule, with the 18+15 prototype cases as fixtures and ADR-0082's `created`-key conditions (`853d9444599c`).
- Proof: unit fixtures for every prototype row; L4 `scenarios/stale-handoff-anchor.mjs` (squash arm quiet, can-fail arm with a later commit fires, content assertion on hook output) and `scenarios/stale-pin-floor.mjs` (agent without git tools names the sentinel commit from the render; contrast arm cannot).
- Removes cause-1 false fires (unmeasured share; reviewer counted 12/60 main commits with the shape). Risk: the disclosed Part 0 misses (code inside the carrier, amend/fixup) fail toward silence, now covered by Part A.
- RFC-043 open questions Q1 and Q5 need the operator's answer first (Q1: read-only render vs SessionEnd write; recommended read-only, for the clean-tree/`main` reasons in RFC-043).

### Phase 3 — move the standing reminder off blocking Stop onto UserPromptSubmit (the intrusiveness fix; ~2-3 days + L4)

- Trigger: at each `UserPromptSubmit`, if (pin stale per Part 0) OR (B1 condition holds), emit one `additionalContext` line: "vfkb: the pinned handoff predates N commits (…). If this is the last turn of the session, record a handoff before finishing." Cached per `(pin id, created, HEAD)` so the per-prompt cost is one `git rev-parse` (the Stop gather measured 0.31 s; the UserPromptSubmit budget is 30 s).
- Removes: **every extra turn** the Stop nudge forces (median 19 s and 2.3k output tokens per fire), because the reminder rides the user's own prompt. The agent reads the prompt and the reminder together, which is exactly the judgment Jev was meant to supply.
- Stop keeps: the loop guard, `decision` nudge (0 fires, harmless), and at most one B3/B1 fire per session (1e) as a belt-and-braces for sessions that end without a further prompt.
- Risk: a session that ends with no further prompt gets no reminder on its last turn; B2 covers a missing handoff on a topic branch, Part A covers a stale pin everywhere. The net risk is one session ending on a stale pin that the next session's render discloses.
- Proof: L4 `scenarios/handoff-next-prompt.mjs` — seeded stale pin + work, then a second resumed turn whose prompt is a wrap-up ("that's all, commit and we're done"); treatment arm asserts an agent-authored handoff (tags handoff/next, not auto) exists after that turn with a sentinel from the session; contrast arm (hook entry disabled) asserts none; a negative arm with a mid-session prompt asserts **no** handoff was written (the can-fail direction that catches nagging). Content assertions on the brain file, never exit codes.
- Governance: departs from ADR-0027/ADR-0034's Stop surface, so it needs an ADR (amends ADR-0034; RFC-043's accepting ADR can carry it). Shares the v3 R1 `UserPromptSubmit` hook entry (RFC-043 §Consequences) so the plugin gains one hook, not two. Cross-repo: plugin `hooks.json` + `claude plugin validate --strict`.

### Phase 4 — re-measure, then decide B3's fate and Part B

- After Phases 1-3 ship in a plugin release and all three profiles are updated, re-run `nudge-fires.py` over ≥10 interactive sessions (RFC-043's gate-1 bar). Expected: Stop-hook fires near zero; the question becomes whether the next-prompt line is *read* (handoffs written on final turns, measured by the same probe).
- If B3-on-Stop still fires mid-session at ≥1 per 3 sessions, revisit Part B in log-only shadow, per project, opt-in. Otherwise record Part B as **not built** in RFC-043's accepting ADR, with this evidence, and consider deleting B3 from Stop entirely (RFC-043 Alternatives already names this).

### Ranking (benefit ÷ effort)

1. Phase 1a/1b/1d (hours; removes a quarter of fires and the premature-write clause; zero risk).
2. Plugin update to v0.21.0 on all profiles + Tier-0 probe of the SessionEnd 1.5 s budget (hours; the floor every phase leans on may be silently truncated today).
3. Phase 3 (days; removes the blocking turn itself).
4. Phase 2 (days; removes the false-positive class and adds the floor that makes 1c/1e safe).
5. Phase 1c/1e (after Phase 2).
6. Part B (only on Phase 4 evidence).

### Needs an operator ruling

1. Deterministic WHEN-rules (1a, 1c, 1e) alongside or instead of a model-timed B3 — this amends `e68ad28f11b6`.
2. RFC-043 Q1 (floor mechanism) and Q5 (rule 5 without a carrier) — both block Phase 2.
3. Moving B1/B3 to UserPromptSubmit (new ADR amending ADR-0034) and whether the Stop fire is kept at once-per-session or dropped.
4. Jev: confirm Part B stays gated on Phase 4's re-measurement, and that any shadow run is per-project opt-in and log-only.
5. Whether to set `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` guidance in the plugin README if the probe shows the budget bites (the plugin cannot raise it itself).

---

## 5. Observed vs inferred, in one place

Observed: all code citations; the 10-11-turn gaps; 37 fires / 18 sessions / 32 mid-session / 20 acted; 91 fires across 68 `cldp` sessions; per-fire cost figures; session records with `nudgedAtTurn`; plugin 0.18.0 installed vs v0.21.0 tagged; 0.31 s Stop-hook wall time; the hooks-doc quotations; the live pin/anchor state; the spike numbers as written in their READMEs.

Inferred: that ~10 fires "on `main`" are not actionable (the session record stores the branch at *start*; a session may have switched); the share of cause-1 false fires (unmeasured, as RFC-043 says); that Part A plus the next-prompt line removes most of the mid-session fire pressure (this is the hypothesis Phase 4 measures); that SessionEnd is at risk under the 1.5 s budget (docs say so; the last observed auto-commit is 2026-09-28, before I can tell whether the budget applied).
