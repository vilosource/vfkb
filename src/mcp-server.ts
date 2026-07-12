#!/usr/bin/env node
// vfkb MCP server — the cross-harness PULL baseline (D5a / ADR-0015). A tight set
// of scoped tools over the same engine the auto-layer faces use. Uses the OFFICIAL
// @modelcontextprotocol/sdk (verified contract — not a hand-rolled JSON-RPC). The
// engine stays zero-dep; this face opts into the SDK.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  addEntry,
  deriveTrust,
  readAll,
  renderContext,
  renderContextMap,
  renderResume,
  supersede,
  transitionDecision,
} from './engine.js';
import { query, queryExplained } from './read.js';
import type { SearchDiagnosis } from './read.js';
import { brainDir, defaultProject } from './storage.js';
import type { KnowledgeEntry } from './types.js';
import { ENGINE_VERSION } from './version.js';

// Default page size for the read tools. An MCP tool result has a hard token
// budget; an unbounded `query()` returns the whole candidate pool (up to ~200
// full entries → ~130k chars), which overflows and errors the call. Cap the
// pull-face here so a broad query degrades to "freshest relevant top-N", never
// a hard error. Callers can still ask for a larger explicit `limit`.
const SEARCH_DEFAULT_LIMIT = 25;

const ENTRY_TYPE = z.enum(['fact', 'decision', 'gotcha', 'pattern', 'link']);
const ZONE = z.enum(['incoming', 'established', 'archive']);
const STATUS = z.enum(['proposed', 'accepted', 'deprecated', 'superseded']);
const ROLE = z.enum(['architect', 'pm', 'executor', 'judge', 'human', 'init', 'import']);

function line(e: KnowledgeEntry): string {
  const adr = typeof e.adr_no === 'number' ? ` ADR-${String(e.adr_no).padStart(4, '0')}` : '';
  const st = e.status ? `/${e.status}` : '';
  // ADR-0042 §3: a structural contradiction reference is surfaced on every read line.
  const contra = e.refs?.contradicts?.length ? ` ⚔ contradicts ${e.refs.contradicts.join(',')}` : '';
  return `${e.id} [${e.type} ${deriveTrust(e.author.role)}/${e.provenance.status}${st}${adr}]${contra} ${e.text}`;
}
function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}
// RFC-002: render an empty search as a cause-distinguished, honest no-match. The
// engine returns structured truth (the diagnosis); this face turns it into words +
// the agent contract — an empty result is NOT a licence to answer from model priors.
function renderNoMatch(d: SearchDiagnosis, q?: string): string {
  const subject = q ? `“${q}”` : 'that filter';
  const contract =
    'No recorded entry was found — do NOT present model-prior knowledge as if it were recorded. Say none was found, or rephrase/broaden.';
  switch (d.reason) {
    case 'empty_topic':
      return `(no matches) — nothing recorded matches ${subject}. ${contract}`;
    case 'no_match': {
      const b = d.belowFloor;
      const hint = b
        ? ` Closest below the relevance floor (LOW CONFIDENCE — matched ${b.matched}/${b.queryTerms} terms, NOT a confirmed answer): ${line(b.entry)}`
        : '';
      return `(no matches) — recorded entries share wording with ${subject} but none cleared the relevance floor.${hint} ${contract}`;
    }
    case 'all_filtered': {
      const parts = Object.entries(d.filteredOut ?? {})
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      const stale = (d.filteredOut?.stale ?? 0) + (d.filteredOut?.superseded ?? 0);
      const staleNote = stale
        ? ` ${stale} match(es) exist but are STALE/SUPERSEDED — the recorded knowledge here is out of date; pass include_stale/include_superseded to inspect it.`
        : '';
      return `(no matches) — ${d.candidates} candidate(s) matched ${subject} but were filtered out (${parts}).${staleNote} ${contract}`;
    }
  }
}
// Issue #127: some harnesses serialize array-valued params to strings, so the
// JSON text of an array can arrive here (`'["a","b"]'`). A naive CSV split
// stores a mangled fragment per element, and a silent fallback is only ever
// discovered by a later reviewer — so JSON-array-shaped input is parsed
// honestly, and garbage errors loudly back to the agent instead of degrading.
function tags(csv?: string, label = 'tags'): string[] | undefined {
  if (csv === undefined) return undefined;
  const s = csv.trim();
  if (!s) return undefined;
  if (s.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      throw new Error(`${label} received JSON-array-shaped input that does not parse: ${s} — pass a comma-separated string like "a,b"`);
    }
    if (!Array.isArray(parsed)) throw new Error(`${label} received JSON that is not an array: ${s}`);
    // String()-coercing a non-string element would store mangled values like
    // '[object Object]' silently — the exact class this parser exists to stop.
    if (!parsed.every((t): t is string => typeof t === 'string')) {
      throw new Error(`${label} JSON array must contain only strings: ${s}`);
    }
    return parsed.map((t) => t.trim()).filter(Boolean);
  }
  return s.split(',').map((t) => t.trim()).filter(Boolean);
}
// In the fleet, who wrote an entry must be stamped by the HARNESS, not self-reported
// by the model (VERIFIED = observed, not asserted — applied to provenance). When the
// pod sets VFKB_ROLE, it is authoritative and overrides any model-supplied `role`.
// Outside the fleet (no env), the tool param / per-tool default applies as before.
function envRole(): z.infer<typeof ROLE> | undefined {
  const p = ROLE.safeParse(process.env.VFKB_ROLE);
  return p.success ? p.data : undefined;
}

// Render defaults resolve the real project name via the shared derivation
// (VFKB_PROJECT, else the brain dir's owning repo, else $CLAUDE_PROJECT_DIR/cwd)
// — the engine-wide successor of this server's Track 9 Q0 local fix.
const projectName = defaultProject;

const server = new McpServer({ name: 'vfkb', version: ENGINE_VERSION });

server.registerTool(
  'kb_search',
  {
    description:
      'Search and filter project knowledge. Returns the freshest relevant entries (stale/superseded excluded by default). ' +
      'Pass verified=true to get ONLY human-verified knowledge (excludes unverified agent-authored entries) — the trust filter. ' +
      'An empty result is reported as an honest, cause-distinguished no-match (nothing recorded / below relevance floor / all matches filtered as stale) — it means no recorded entry was found, NOT a licence to answer from model priors as if recorded.',
    inputSchema: {
      text: z.string().optional().describe('free-text query'),
      type: ENTRY_TYPE.optional(),
      zone: ZONE.optional(),
      status: STATUS.optional().describe('effective decision status'),
      tags: z.string().optional().describe('comma-separated; entry must have ALL'),
      author_role: ROLE.optional(),
      verified: z
        .boolean()
        .optional()
        .describe('true → return ONLY verified knowledge (provenance verified); excludes unverified/agent-authored entries'),
      limit: z.number().int().positive().optional(),
      include_stale: z.boolean().optional(),
      include_superseded: z.boolean().optional(),
    },
  },
  async (a) => {
    const { results, diagnosis } = queryExplained({
      text: a.text,
      type: a.type,
      zone: a.zone,
      status: a.status,
      tags: tags(a.tags),
      authorRole: a.author_role,
      verifiedOnly: a.verified,
      limit: a.limit ?? SEARCH_DEFAULT_LIMIT,
      includeStale: a.include_stale,
      includeSuperseded: a.include_superseded,
    });
    return text(results.length ? results.map(line).join('\n') : renderNoMatch(diagnosis!, a.text));
  },
);

server.registerTool(
  'kb_list',
  {
    description: 'List entries by structural filter (no text search).',
    inputSchema: {
      type: ENTRY_TYPE.optional(),
      zone: ZONE.optional(),
      limit: z.number().int().positive().optional(),
    },
  },
  async (a) => {
    const r = query({ type: a.type, zone: a.zone, limit: a.limit ?? SEARCH_DEFAULT_LIMIT });
    return text(r.length ? r.map(line).join('\n') : '(empty)');
  },
);

server.registerTool(
  'kb_get',
  {
    description: 'Fetch a single entry by id (full JSON).',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const e = readAll().find((x) => x.id === id);
    return text(e ? JSON.stringify(e, null, 2) : `no such entry: ${id}`);
  },
);

server.registerTool(
  'kb_map',
  {
    description: 'The derived Context Map — what knowledge exists and how to navigate it.',
    inputSchema: {},
  },
  async () => text(renderContextMap()),
);

server.registerTool(
  'kb_context',
  {
    description:
      "The project context document — the agent's first read. Orients you to the project: " +
      'its job-to-be-done, architecture, tech profile, conventions, the load-bearing decisions, ' +
      'and links. Read this BEFORE acting on an unfamiliar project. Assembled from the authored ' +
      'context spine + the live Constitution/Map/decisions (always current).',
    inputSchema: {},
  },
  async () => text(renderContext(projectName())),
);

server.registerTool(
  'kb_add',
  {
    description:
      'Add an entry. Fluid types (fact/gotcha/pattern/link) are editable; decisions are immutable (supersede to change). New decisions default to status=proposed (an RFC).',
    inputSchema: {
      type: ENTRY_TYPE,
      text: z.string(),
      why: z.string().optional().describe('rationale; stored structurally AND folded into the text as a "Why: …" line (esp. for decisions)'),
      tags: z.string().optional().describe('comma-separated (a tag itself cannot start with "[")'),
      path: z
        .string()
        .optional()
        .describe(
          'link target (path or URL) for type=link — folded into the text as "<text> → <path>" ' +
            '(link entries have no structural target field); rejected for other types',
        ),
      contradicts: z.string().optional().describe('comma-separated ids of entries this one contradicts (structural reference, ADR-0042)'),
      role: ROLE.optional().describe('author role; defaults to executor (agent)'),
      status: STATUS.optional().describe('decision family only'),
      constitutional: z.boolean().optional().describe('decision family only (ADR-0008)'),
    },
  },
  async (a) => {
    if (a.path !== undefined && a.type !== 'link') {
      throw new Error(`kb_add: 'path' is only valid with type=link (got type=${a.type})`);
    }
    if (a.path !== undefined && !a.path.trim()) {
      // An empty target would silently record a link pointing nowhere — the
      // exact instance-5 failure this parameter exists to prevent.
      throw new Error("kb_add: 'path' must be a non-empty path or URL");
    }
    const body = a.path !== undefined ? `${a.text.trim()} → ${a.path.trim()}` : a.text;
    const e = addEntry(a.type, body, {
      role: envRole() ?? a.role ?? 'executor',
      why: a.why,
      tags: tags(a.tags),
      contradicts: tags(a.contradicts, 'contradicts'),
      status: a.status,
      constitutional: a.constitutional,
    });
    return text(`added ${line(e)}`);
  },
);

server.registerTool(
  'kb_supersede',
  {
    description:
      'Supersede a decision with a new one (additive edge; the old is never edited and stops being injected).',
    inputSchema: {
      old_id: z.string(),
      text: z.string(),
      why: z
        .string()
        .optional()
        .describe('rationale for the new decision; stored structurally AND folded into its text as a "Why: …" line'),
      // Issue #127: without this in the schema the SDK strips a model-supplied
      // `tags` silently and every successor lands untagged.
      tags: z.string().optional().describe('comma-separated; tags for the NEW decision (a tag itself cannot start with "[")'),
      role: ROLE.optional(),
    },
  },
  async (a) => {
    const e = supersede(a.old_id, a.text, { role: envRole() ?? a.role ?? 'architect', why: a.why, tags: tags(a.tags) });
    return text(`superseded ${a.old_id} -> ${line(e)}`);
  },
);

server.registerTool(
  'kb_transition',
  {
    description:
      'Transition a decision through its lifecycle (proposed -> accepted -> deprecated). Content is preserved; `superseded` is set by kb_supersede, not here.',
    inputSchema: { id: z.string(), status: z.enum(['proposed', 'accepted', 'deprecated']) },
  },
  async (a) => {
    const e = transitionDecision(a.id, a.status);
    return text(`transitioned ${line(e)}`);
  },
);

server.registerTool(
  'kb_resume',
  {
    description:
      'Session-continuity resume (ADR-0020): the prior session’s derived digest (what was added/superseded/injected/captured — recomputed from the brain, so never stale) + the live knowledge bundle. Pull this to see where the last session left off.',
    inputSchema: {},
  },
  async () => text(renderResume(projectName())),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the protocol channel — never write to it. Log to stderr.
  // brainDir() resolves VFKB_DATA_DIR (canonical) → VFKB_DIR (deprecated alias) → ~/.vfkb.
  process.stderr.write(`vfkb MCP server up (v${ENGINE_VERSION}, brain: ${brainDir()})\n`);
}

main().catch((err) => {
  process.stderr.write(`vfkb MCP fatal: ${err}\n`);
  process.exit(1);
});
