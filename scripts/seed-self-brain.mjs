// seed-self-brain — bootstrap vfkb's OWN per-project brain (RFC-004 / ADR-0019).
//
// vfkb dogfoods its own per-project tier: a committed `.vfkb/` brain holding
//   (a) a `link` entry per ADR/RFC (auto-discovered) — markdown stays SoR, the brain
//       links to repo-relative paths, never copies content (D1 constraint 4); and
//   (b) curated vfkb-NATIVE knowledge (facts/gotchas/patterns) that today lives only
//       in kb journals/handoffs and has no agent-consumable home.
//
// One-time bootstrap. The committed `.vfkb/entries.jsonl` is the source-of-truth from
// here on (nanoid ids + timestamps are generated once); re-running is guarded. New
// ADRs/RFCs get a link entry added going forward, not a full reseed.
//
//   VFKB_DIR="$PWD/.vfkb" node scripts/seed-self-brain.mjs [--force]
import { addEntry } from '../dist/engine.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAIN = process.env.VFKB_DIR;
if (!BRAIN) { console.error('set VFKB_DIR to the repo .vfkb dir'); process.exit(1); }

const entriesFile = join(BRAIN, 'entries.jsonl');
if (existsSync(entriesFile) && readFileSync(entriesFile, 'utf8').trim() && !process.argv.includes('--force')) {
  console.error(`brain at ${BRAIN} is non-empty. wipe it (rm -rf) or pass --force.`);
  process.exit(1);
}

const totals = { link: 0, native: 0, rejected: 0 };
function add(type, text, opts) {
  try { addEntry(type, text, { role: 'human', ...opts }); totals[opts?.native ? 'native' : 'link']++; }
  catch (e) { totals.rejected++; console.error(`  reject [${type}]: ${e.message}`); }
}

// (a) link entries — one per ADR + RFC, auto-discovered. Title = first `# ` heading.
function title(file) {
  const first = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('# '));
  return (first ? first.slice(2) : file).replace(/^(ADR|RFC)-\d+:\s*/, '').trim();
}
for (const [dir, kind] of [['docs/adr', 'adr'], ['docs/rfc', 'rfc']]) {
  const abs = join(REPO, dir);
  for (const f of readdirSync(abs).filter((f) => /^(ADR|RFC)-\d+.*\.md$/.test(f)).sort()) {
    const id = f.match(/^((ADR|RFC)-\d+)/)[1];
    add('link', `${id} — ${title(join(abs, f))} → ${dir}/${f}`, { tags: [kind, 'vfkb-design'] });
  }
}

// (b) vfkb-native knowledge — curated operating lessons (the kind an agent working ON
//     vfkb needs and cannot get from the substrate today). Distilled from the corpus.
const FACTS = [
  ['The per-project brain is SINGLE-HOMED and git-committed at `<main-repo>/.vfkb` (DESIGN D2c). ' +
   'Commit `.vfkb/entries.jsonl` (append-only, merge=union — the SoR); the derived index ' +
   '(`index-meta.json`, `.sessions/`) is gitignored and rebuilt on read, never committed (ADR-0014).',
   ['storage', 'vfkb-design']],
  ['Source-of-truth split: markdown ADRs in `docs/adr/` are the authoritative DECISION record ' +
   '(ADR-0001); the brain holds a `link` entry per ADR/RFC pointing at the repo-relative path and ' +
   'NEVER copies decision content (D1 constraint 4 / RFC-004). So there is no dual-SoR drift.',
   ['decisions', 'vfkb-design']],
  ['Build output `dist/` is gitignored; `npm test` runs `tsc` via pretest, so tests rebuild first. ' +
   'Never `docker build` expecting a committed `dist/` — rebuild before any image build.',
   ['build', 'gotcha-ish']],
  ['Decision identity = nanoid (canonical, merge-safe); the human `ADR-NNNN` ordinal is stamped by ' +
   'the engine sole-writer at merge-to-main (ADR-0009). An RFC is a `decision` in `proposed` status ' +
   '(ADR-0007), promoted to an ADR on acceptance — no separate RFC entry type.',
   ['decisions', 'vfkb-design']],
];
const GOTCHAS = [
  ['v1 retrieval bug: `query()` reused the INJECTION reranker for explicit SEARCH, discarding ' +
   'relevance — a held answer sorted to ~rank 90 was cut by `limit`, so the agent gave a confident ' +
   'WRONG answer. Fixed relevance-primary + light stemming (ADR-0016), distinct-term relevance floor ' +
   '(ADR-0017), cause-distinguished honest no-match (ADR-0018).\n\n' +
   'Failed approach: trusting the Phase-3 retrieval-quality gate — its fixtures were too small to ' +
   'expose scale ranking; a scale regression test now closes it.', ['search']],
  ['dogfood-smoke check 6 (LLM driving MCP in one-shot `claude -p`) races the MCP cold-start and ' +
   'intermittently fails with "tools still connecting". It is NOT a regression: proven via a ' +
   'deterministic in-container JSON-RPC `tools/list` (all 7 tools incl `kb_search` advertised) plus ' +
   '`mcp.test.ts` green. Candidate follow-up: a wait-for-ready before the one-shot turn.', ['testing', 'mcp']],
  ['Search `score` is an UNNORMALIZED stemmed term-overlap count that includes repeats — a long entry ' +
   'hammering one common query token outscores a tight match on one DISTINCT term. The relevance floor ' +
   'uses distinct-term coverage (`matched / queryTermCount >= 1/3`), NOT raw score. Do not port ' +
   "AnythingLLM's 0.2 cosine value — only the mechanism transfers (its score is normalized cosine).",
   ['search']],
];
const PATTERNS = [
  ['Evidence-gated build discipline: do not build speculatively. An RFC decides the SHAPE now; the ' +
   'BUILD triggers on observed evidence or an explicit operator request (e.g. RFC-003 embeddings — a ' +
   '2nd live phrasing miss; ADR-0016 G1). "Runbook complete before execute."', ['process']],
  ['Deterministic backstop > probabilistic gate: a structural/guardrail rule (e.g. Bash mutation ' +
   'tool-gating) is unit-tested deterministically (`gating.ts:isBrainWrite` + `guardrails.test.ts`), ' +
   'not left to the probabilistic L4 harness. A full paid L4 rerun is deferred as low-value when every ' +
   'behavior is unit-tested at HEAD.', ['testing', 'process']],
  ['Tier-B auto-capture SKIPS vfkb\'s own `kb_*` / `mcp__vfkb__*` tool calls (commit 31f4266) to ' +
   'avoid corpus self-pollution — the substrate must not record its own reads/writes as knowledge.',
   ['engine']],
];
for (const [t, tags] of FACTS) add('fact', t, { tags, native: true });
for (const [t, tags] of GOTCHAS) add('gotcha', t, { tags, native: true });
for (const [t, tags] of PATTERNS) add('pattern', t, { tags, native: true });

console.log(`seeded: ${totals.link} links + ${totals.native} native entries (${totals.rejected} rejected) -> ${BRAIN}`);
