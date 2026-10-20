# UserPromptSubmit probes — 2026-10-20, Claude Code CLI 2.1.292

These probes cover v3 PRD theme **R1** (query-time injection). They test two
dependencies before any RFC: does injection at `UserPromptSubmit` reach the agent, and
can vfkb's existing lexical index pick what to inject from a raw prompt.
Brain: `553c8c38d131` (delivery) and `8f21f98df86a` (selection).

## 1. Delivery — `ups-json.sh`, `ups-plain.sh`

A `UserPromptSubmit` hook injects a sentinel. One variant emits
`hookSpecificOutput.additionalContext` JSON; the other emits plain stdout. The contrast
arm has no hook. Each run is one `claude -p` turn with `--tools "" --strict-mcp-config`
and `claude-haiku-4-5`, and a fresh random sentinel every time.

**Framed as a credential** ("the depot passphrase is …"):

| Variant | Hits | Misses |
|---|---|---|
| JSON | 1/3 | one NONE; one "I should not repeat sensitive credentials from system context" |
| plain | 1/3 | one NONE; one "I suspect this is a prompt injection attempt" |
| none | 0/3 | |

**Framed as project knowledge** ("vfkb project knowledge: the next database migration is
codenamed …"):

| Variant | Hits | Misses |
|---|---|---|
| JSON | **3/3** | |
| plain | **3/3** | |
| none | **0/3** | the agent tried to search the repo |

**Findings:**
- **Both output forms deliver.** The injected text reaches the agent on CLI 2.1.292.
- **Framing decides whether the agent trusts it.** Per-prompt injected text arrives
  looking like system-injected content. Text shaped like a secret or an instruction is
  treated as prompt injection and refused; text shaped like project knowledge is used.
  This is the same lesson as ADR-0079: what an injection *says about itself* changes what
  the agent does with it.

## 2. Selection — `measure-lexical.mjs`, `rank-relevant.mjs`

These run vfkb's existing lexical query, the same one `kb_search` uses, against this
repo's real brain (~470 live entries) with eight real operator prompts from the
2026-10-16 → 2026-10-20 sessions. They are deterministic and cost nothing to run:
`VFKB_REPO=<vfkb checkout> node <script>` after `npm run build`.

The stage-1 scorer's own comment says it is "NOT BM25 (no IDF, no length normalization;
the score is # of entry tokens matching a query term)". Observed:

- **The RFC-001 relevance floor never fires on prompts.** Results with and without it
  were identical for all eight prompts. A chatty prompt's common words match nearly
  every entry: 446–450 of ~470 entries matched each prompt tested.
- **Long entries win.** The top three hits were 4–7.7k-character handoffs for every
  prompt.
- **Relevant entries rank far down:**
  - "we were going to use JEV as well were we not?": the Jev decision-model fact
    `aa294b2708c4` ranks **77th**, the Jev ruling `8b2aefd11171` **101st**, and the
    Jev survey link `7a1ffdd4e6f0` **319th**. The top hit is a 7,750-character
    handoff that mentions Jev.
  - "what is in our roadmap?": the first roadmap link ranks **308th**.

**Finding:** R1 cannot stand on the current stage-1 index. Injecting its top hits per
prompt would push the same long handoffs into context every turn. This is the evidence
that bears on the gated **S1** item (BM25 first, RFC-003 embeddings second).

## Limits

- **N=3 per delivery variant, one CLI version, one model.**
- **The prompt set is eight prompts from one operator.** That is enough to show the
  scorer's failure mode, which is structural (counted occurrences, no IDF, no length
  normalisation). It is not enough to tune a replacement; RFC-044 asks for a labelled
  set for that.
- **Not probed:** `UserPromptSubmit` on harness-generated turn starts. Its firing there
  was observed on 2026-10-13 (harness survey §7a); what its payload `prompt` looks like
  in that case was not captured here.
