# vtfkb — The Shared Memory That Makes an AI Software Factory Compound

> **A product brief.** What vtfkb is, the problem it solves, and the features that
> make it worth building. Companion to the engineering design
> [`vtfkb-DESIGN.md`](vtfkb-DESIGN.md) (decisions D1–D6 locked, 2026-05-31).
>
> **Status (honest):** the design is locked; the product is **not yet built**.
> This brief sells the *idea* — every feature below traces to a locked design
> decision, none is aspirational hand-waving.

---

## 1. The problem

**ViloForge already has a software factory that works.** Give the execution
engine (vtaskforge + vafi) a high-quality spec and it returns verified code with
near-zero rework — proven across dozens of autonomous task runs. The factory's
own hard-won lesson, in its words:

> *"Invest in spec quality, not executor sophistication."*
> *"Precise specs → first-attempt passes."*

So **spec quality is the single biggest lever on factory output.** And here is the
trap: a good spec is only good because whoever wrote it *had the context* — the
domain, the prior decisions, the gotcha that bit the last person who touched this
module. Today that context lives in exactly one place: **a human's head.**

That creates three compounding failures as you try to run the fleet at scale:

- **Every agent starts generic.** The architect that plans your payment system
  knows nothing about your payment system. It has the repo and the ticket — no
  memory of *why* the last three decisions went the way they did.
- **Hard-won lessons evaporate.** An executor discovers "money needs Postgres
  `NUMERIC`, not float," fixes it, and ships. The next task makes the same
  mistake, because that lesson was never written anywhere an agent will read.
- **The human is the only shared memory** between the architect, PM, executor,
  and judge — so the human is the bottleneck, and an unattended fleet starves.

You can buy a better model. You cannot buy *your project's accumulated judgment.*
**vtfkb is where that judgment lives** — a shared, durable, multi-agent memory so
every agent in the factory is smarter than a generic one, and gets smarter every
time the factory runs.

> **One line:** *vtfkb turns one-shot agents into a team with a memory.*

---

## 2. The features at a glance

| Feature | What it gives you |
|---|---|
| **Memory that shows up on its own** | Relevant knowledge is **injected into the agent automatically** — at session start and as the conversation shifts — and lessons are **captured passively** from what the agent does. The agent doesn't have to remember to look; the memory comes to it. (Carried over from mykb's deepest capability.) |
| **Knowledge lives in the repo** | The brain is a git directory inside the project. Knowledge is versioned *with the code*, branches with it, and travels with a clone — no external service to be down or out of sync. |
| **Causally consistent with code** | A gotcha about module M lands on `main` exactly when M's change does. Branch a task → inherit all prior knowledge. No "the wiki says X but the code does Y." |
| **Multi-agent attribution** | Every entry records *who* wrote it — architect, PM, executor, judge, human, or the onboarding `init`. You can trust, filter, and audit by author. |
| **Knowledge ↔ work ↔ code links** | Entries reference the vtf task, the commit/branch, and the files they came from. Knowledge is never orphaned from the change that produced it. |
| **Conflict-free at fleet scale** | Many agents on many branches write at once and *never* collide (`merge=union` on append-only logs). Concurrency is a non-event. |
| **Trust as a gradient, not a gate** | Writes land instantly, labeled "unverified." Nothing queues. Readers weigh the label; an *independent* signal (a judge, a passing test, a human) promotes to "verified." Wrong entries self-heal — superseded and archived, never silently deleted. |
| **A first-class project context doc** | One always-current brief — the agent's first read — that says what the project *is*: domain, architecture, conventions, key decisions. The `CLAUDE.md` you wish every project maintained, maintained by the factory itself. |
| **Agents ask; the brain also volunteers** | On top of the automatic layer, agents query knowledge through natural tool calls (`kb_search`, `kb_context`, `kb_add`…) over MCP — the one interface every harness in the fleet speaks. Humans read *through* an agent, like asking a knowledgeable teammate. |
| **One search, two scopes** | A single query spans this project's brain *and* the org-wide knowledge tier, returns one ranked list, each result labeled with its scope and trust. |
| **Two tiers, deliberate promotion** | Per-project knowledge stays local; genuinely reusable knowledge is *promoted* to a shared "Viloforge KB" by an explicit, reviewed step — never leaks automatically. |
| **Secrets stay out** | The brain is git-committed, so a write-time lint blocks secrets at the door. Knowledge and secret *references* only. |
| **Backend-agnostic** | Brain-in-repo + a `kb` binary in the agent works on any execution backend — k8s pod today, bare VM tomorrow. No new infrastructure coupling. |

---

## 3. The features, section by section

### 3.0 Memory that shows up on its own (the signature capability)
The difference between "a knowledge base you can query" and "an agent that
remembers" is **who initiates**. vtfkb does both, but this is the one that makes
it feel like memory:
- **Automatic context-injection.** At session start the agent is handed the
  project context doc; as the conversation moves, relevant facts/decisions/gotchas
  are **scored and injected into the agent's context without it asking.** The
  agent doesn't have to *remember to look it up* — the right knowledge is already
  in front of it.
- **Passive capture.** vtfkb observes the agent's inputs and tool activity to know
  what's relevant (and, over time, to harvest lessons) — no explicit "save this"
  ceremony on the hot path.

Because this hooks each agent harness's loop, it's delivered **per harness over
one shared engine**: a native **Pi extension** (where the architect runs) and
**Claude Code hooks** (where executors/judges run), both driving the same brain.
This is exactly the capability that makes mykb valuable today, carried forward —
not traded away for a pull-only API. *(Design: D7; the cross-harness query
baseline is D5a/§3.8.)*

### 3.1 Knowledge lives in the repo (git-native)
The brain is a directory (`.vtfkb/`) committed inside the project's main repo —
append-only JSONL logs plus a rebuildable search index. That single choice buys a
lot: knowledge is **versioned**, **diffable**, **reviewable in a PR**, and
**travels with the code**. There is no separate database to provision, back up,
or find out-of-sync at 2 a.m. Clone the repo and you have the memory. *(Design:
D2 — git is the system of record; JSONL + SQLite/FTS, deterministic rebuild.)*

### 3.2 Knowledge that stays true to the code (causal consistency)
Because the brain is *in* the repo, it follows the same branch-and-merge flow as
the code — and vtfkb leans into that:
- The **architect** writes design-level knowledge to `main` directly (it's
  human-gated in the planning chat, and cheap to revise).
- **Executors and judges** write what they *discover while building* onto the
  task branch, so the lesson merges to `main` **together with the code change
  that taught it.**
- Every new task branches from `main` and **inherits all prior knowledge.**

The payoff is a guarantee generic memory systems can't make: *a gotcha about a
module is present exactly when that module's code is present.* No drift, no stale
wiki. *(Design: §5 origin-split writes, D4.)*

### 3.3 Every memory knows who made it (multi-agent attribution)
mykb — the proven single-user predecessor — assumed one author. A factory has
several specialized agents plus humans, so vtfkb stamps every entry with an
**author role** (`architect | pm | executor | judge | human | init`). That turns
attribution into leverage: a judge's verified decision can outrank an executor's
unverified hunch; you can audit "what did the architect actually decide here";
you can filter a query to human-authored knowledge only. *(Design: D3a.)*

### 3.4 Knowledge wired to work and code (linkage)
Entries carry **references**: the vtf task they came from, the commit/branch, the
files involved, and links to related or superseding entries. A decision is never
a free-floating sentence — it's connected to the work that motivated it and the
code that implements it. Ask "why is this here?" and the trail is intact. The
reference direction is deliberately **one-way** (knowledge points at work, never
the reverse), which keeps the work-tracker clean and product-agnostic. *(Design:
D3b, D1.)*

### 3.5 Many agents writing at once — and never colliding (concurrency)
A fleet means N agents on N branches all appending knowledge simultaneously.
vtfkb makes that a non-problem: the logs are **append-only** and marked
`merge=union`, so concurrent appends from any number of branches **merge without
conflict**; the index dedups by ID on rebuild. The rare destructive edits are
mediated through the architect. The 95% case — agents appending what they learn —
is conflict-free *by construction*, not by locking. *(Design: §5.1, D4c.)*

### 3.6 Trust as a gradient, not a bottleneck (the trust model)
The hardest question for a shared agent memory is *"how do you keep it from
filling with confident nonsense?"* The wrong answer is a curation queue — it
stalls the fleet. vtfkb's answer:
- **Writes land immediately**, in the active set, **labeled** with their author
  and a status that defaults to **`unverified`** for agents. Nothing waits.
- **Readers get the trust signal** and weigh it; an agent can ask for
  `verified`-only when it matters.
- **`verified` is earned by an independent signal** — a judge, a passing test, a
  second agent, a human — *never* by the author asserting its own correctness.
- **Corrections self-heal:** a better entry *supersedes* the old one, which is
  *archived* (kept as a record), never silently deleted.

This mirrors how good engineering teams actually work, and it scales to
autonomous writers without a human gatekeeper on the hot path. *(Design: D3d.)*

### 3.7 The project context doc (the agent's first read)
Beyond discrete entries, every project has one **context document** — loaded by
`kb_context` — that orients any agent instantly: what the project is (the
job-to-be-done), its architecture, tech profile, conventions, the load-bearing
decisions, and links into `docs/`. It's the `CLAUDE.md` every project *should*
have, except the factory writes and maintains it (seeded at onboarding, kept
current by the architect). This single artifact is what turns "a generic model
with a repo" into "an agent that already understands your system." *(Design: D1,
project-onboarding-schema D-O8.)*

### 3.8 Agents just ask; humans ask an agent (MCP query surface)
On top of the automatic layer (§3.0), vtfkb exposes an **MCP tool surface** —
`kb_search`, `kb_match`, `kb_context`, `kb_load`, `kb_add`, `kb_verify`,
`kb_supersede`, `kb_promote`. MCP is the **one interface every harness in the
fleet speaks** (the architect runs on Pi, executors/judges on Claude Code), so
knowledge access is a natural tool call in any agent's loop — not a bolted-on,
harness-specific integration. **Humans read through an agent** ("ask the
architect, it runs the search, it answers") — the same loop that works between a
person and mykb today. A thin CLI exists for scripts and debugging. *(Design:
D5a, D5d.)*

### 3.9 One search across project and org (unified query)
Knowledge worth keeping isn't all project-local — some is org-wide ("how we do
auth," "our Postgres conventions"). vtfkb resolves both in **one query**: a single
`kb_search` hits the local project brain *and* the global tier and returns **one
ranked list, each result labeled with its scope and trust** (project-first, then
global). The caller never has to know where knowledge lives. *(Design: D5b, D2d.)*

### 3.10 Two tiers, with deliberate promotion (project + global)
The same engine and format serve two scopes: a **per-project brain** (local,
versioned with the code) and a **global "Viloforge KB"** shared across projects.
Crucially, knowledge moves from local to global **only by an explicit, reviewed
promotion** — never automatically. So a project's half-formed notes never pollute
the org's canon, and the org's canon is something a human deliberately curated.
*(Design: D2a, D2f. v1 ships the per-project tier; the global served tier is
designed-now-built-later — D2g.)*

### 3.11 Secrets stay out, by design (safety)
Because the brain is git-committed and therefore low-trust, vtfkb treats secrets
as a hard boundary: a **write-time lint** on the `add` path blocks high-entropy /
known-token material. The brain holds knowledge and secret *references* only;
real secrets stay in the work-tracker's variable store / Vault. Safety is a
property of the front door, not a policy you hope everyone remembers. *(Design: D1
constraint #2, D6e.)*

### 3.12 Runs anywhere the factory runs (backend-agnostic)
vtfkb is a **TypeScript engine** — MCP server + thin CLI + per-harness auto-layer
— baked into the agent image, pointed at the repo-local brain. That's it. Any
execution backend that can clone a repo and run it gets full knowledge access — a
Kubernetes pod today, a bare VM under the cloud-native redesign tomorrow.
Knowledge access adds **zero** new infrastructure coupling, which is exactly the
"core passes references, the backend resolves" principle the platform is already
moving toward. (TypeScript is deliberate: it lets the Pi auto-injection extension
and the engine be one in-process codebase — the very thing that makes the
integration deep. §5.) *(Design: D6, and the cloud-native alignment in the ingest
brainstorm §10.)*

---

## 4. What it unlocks — a concrete before/after

**Task: "build a payment system."**

- The **architect** plans it *with* the project's context doc and prior
  decisions in hand — not as a stranger. It records the design and the *why*
  ("double-entry ledger because…") to `main`.
- An **executor** implements the ledger, **discovers** that money needs Postgres
  `NUMERIC` not float, and **writes that gotcha next to the code** on its branch.
- The **judge** approves; branch merges → **code and gotcha land on `main`
  together.**
- The **next task** ("charge endpoint") branches from the new `main` and
  **inherits both the ledger code and the gotcha.** The mistake is never repeated.

Without vtfkb, step 2's lesson dies with the task and step 4 re-learns it the
hard way. *That* difference — repeated across thousands of tasks — is the product:
**a factory whose output quality compounds instead of resetting to generic every
time.** *(Design: ingest brainstorm §6, verified mechanics.)*

---

## 5. Why now, and why not just reuse mykb

mykb proved the kernel — JSONL + SQLite + git, the five entry types
(facts/decisions/gotchas/patterns/links), search and relevance, **and the
automatic Pi context-injection/capture layer**. vtfkb **carries that proven core
faithfully** and adds the things a *factory* needs that a single-user tool
doesn't: **role attribution**, **branch-aware writes wired to vtf tasks**, a
**cross-harness MCP surface**, and a **second harness adapter (Claude Code hooks)**
beside the existing Pi extension. It sheds mykb's single-user workspace machinery
(a per-project instance makes it redundant), and **stays in TypeScript** — which
is what lets the auto-injection extension and the engine remain one in-process
codebase. Staying in TS also means the realistic path is to **evolve mykb**, not
rewrite it from scratch: the kernel, the Pi extension, and the scorer come for
free. This isn't a rewrite for its own sake — it's the proven idea, re-aimed at a
team of agents instead of one human. *(Design: ingest brainstorm §4.5,
vtfkb-DESIGN §2 + D6a.)*

---

## 6. Where this stands

- **Design: locked.** Scope boundary, topology, schema, write/concurrency, read
  interface, runtime (**TypeScript**, D6a), and the **automatic per-harness
  context/capture layer** (D7) are settled (D1–D7), plus the project-onboarding
  contract that seeds the brain. Open for the IMPLEMENTATION-PLAN: **evolve mykb
  vs greenfield TS** (leaning evolve).
- **Build: not started.** vtfkb is the **foundation** of the VFSF Ingest Cycle
  (`vtfkb → project-init → ingest-engine`); the next artifact is its
  IMPLEMENTATION-PLAN. Everything in this brief is buildable from the locked
  design — that's the point of presenting it now.
