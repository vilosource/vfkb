# UserPromptSubmit probes — 2026-10-20, Claude Code CLI 2.1.292

These probes cover v3 PRD theme **R1** (query-time injection). They test two
dependencies before any RFC: does injection at `UserPromptSubmit` reach the agent, and
can vfkb's existing lexical index pick what to inject from a raw prompt.
Brain: `553c8c38d131` (delivery) and `8f21f98df86a` (selection).

## 1. Delivery — `run-delivery.sh` + `ups-hook.sh`

A `UserPromptSubmit` hook injects a sentinel. One variant emits
`hookSpecificOutput.additionalContext` JSON; the other emits plain stdout. The contrast
arm has no hook. To reproduce, run `bash run-delivery.sh knowledge 3` or
`bash run-delivery.sh credential 3` (metered, cents). Each run is one `claude -p` turn with `--tools "" --strict-mcp-config`
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

## 2. Selection — `measure.mjs`

`measure.mjs` rebuilds the brain exactly as it was at `9095dc4` (524 live entries) from git,
then runs eight real operator prompts from the 2026-10-16 → 2026-10-20 sessions. It is
deterministic and free to run: `npm run build`, then `node <kit>/measure.mjs 9095dc4`.

The stage-1 scorer's own comment says it is "NOT BM25 (no IDF, no length normalization;
the score is # of entry tokens matching a query term)". It also has **no stopword list**,
so words like "we", "is" and "our" match almost every entry.

**(a) The RFC-001 floor.** The floor **does fire**: for 7 of 8 prompts it drops 93–238
matches, and it shrinks the 194-candidate result set by 0–44. But it only *removes*
candidates and never reorders them, so it **cannot fix what reaches the top**.
- The headline prompts matched 446 and 450 entries; five others matched 457–473.
- "continue autonomously" matched only 13.
- The top three hits were 4–7.7k-character handoffs for 7 of the 8 prompts.

**(b) Rankers compared.** These are 1-based ranks of the entries each prompt is about.
The **current** row is the real index. It sorts by score, then by newest `updated`, and
its scores tie heavily, so each rank is shown with its tie band. The other rows are
prototypes over the same tokenizer and stemmer, with a generic English stopword list
(NLTK-style, not tuned to these prompts), and they break ties by file order:

| Scorer | "…use JEV as well…" (`aa294b2708c4`, `8b2aefd11171`, `7a1ffdd4e6f0`) | "what is in our roadmap?" (roadmap links) |
|---|---|---|
| current (the real index) | 78, 102, 320 (bands 77–87, 100–114, 312–357) | 309, 310 (band 263–310) |
| count + stopwords | 6, 7, 23 | 3, 8 |
| BM25 (k1 1.2, b 0.75) | 6, 15, 17 | 21, 27 |
| **BM25 + stopwords** | **4, 7, 11** | **1, 2** |

**Findings:**
- **The current scorer cannot select from a raw prompt.**
- **Stopword pruning is the larger single factor.** Plain BM25 still misses the roadmap
  case (21, 27); BM25 with stopwords gets both.
- **Ranks past 200 never reach `kb_search` at all.** `read.ts` asks `searchScored` for
  200 candidates.

These are two labelled cases. That is directional evidence for *which* fix, not a tuned
result; RFC-044's labelled eval decides.

**A trap for that eval:** entries that *quote* the test prompts, such as this probe's own
brain gotchas, rank first under BM25 for those prompts. The eval must use a pinned brain
snapshot from before the quoting entries existed, or exclude them.

## Limits

- **N=3 per delivery variant, one CLI version, one model.**
- **The prompt set is eight prompts from one operator.** That is enough to show the
  scorer's failure mode, which is structural (counted occurrences, no IDF, no length
  normalisation). It is not enough to tune a replacement; RFC-044 asks for a labelled
  set for that.
- **Harness-generated turns:** `UserPromptSubmit` also fires on these. Harness survey §7a
  (2026-10-13) recorded the second `prompt` as a `<task-notification>` envelope. Whether
  that envelope is a reliable discriminator across turn kinds was not probed here.
