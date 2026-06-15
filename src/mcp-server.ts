#!/usr/bin/env node
// vtfkb MCP server — the cross-harness PULL baseline (D5a / ADR-0015). A tight set
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
  renderContextMap,
  supersede,
  transitionDecision,
} from './engine.js';
import { query, queryExplained } from './read.js';
import type { SearchDiagnosis } from './read.js';
import type { KnowledgeEntry } from './types.js';

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
  return `${e.id} [${e.type} ${deriveTrust(e.author.role)}/${e.provenance.status}${st}${adr}] ${e.text}`;
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
function tags(csv?: string): string[] | undefined {
  return csv ? csv.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
}
// In the fleet, who wrote an entry must be stamped by the HARNESS, not self-reported
// by the model (VERIFIED = observed, not asserted — applied to provenance). When the
// pod sets VTFKB_ROLE, it is authoritative and overrides any model-supplied `role`.
// Outside the fleet (no env), the tool param / per-tool default applies as before.
function envRole(): z.infer<typeof ROLE> | undefined {
  const p = ROLE.safeParse(process.env.VTFKB_ROLE);
  return p.success ? p.data : undefined;
}

const server = new McpServer({ name: 'vtfkb', version: '0.0.0-spike0' });

server.registerTool(
  'kb_search',
  {
    description:
      'Search and filter project knowledge. Returns the freshest relevant entries (stale/superseded excluded by default). ' +
      'An empty result is reported as an honest, cause-distinguished no-match (nothing recorded / below relevance floor / all matches filtered as stale) — it means no recorded entry was found, NOT a licence to answer from model priors as if recorded.',
    inputSchema: {
      text: z.string().optional().describe('free-text query'),
      type: ENTRY_TYPE.optional(),
      zone: ZONE.optional(),
      status: STATUS.optional().describe('effective decision status'),
      tags: z.string().optional().describe('comma-separated; entry must have ALL'),
      author_role: ROLE.optional(),
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
  'kb_add',
  {
    description:
      'Add an entry. Fluid types (fact/gotcha/pattern/link) are editable; decisions are immutable (supersede to change). New decisions default to status=proposed (an RFC).',
    inputSchema: {
      type: ENTRY_TYPE,
      text: z.string(),
      tags: z.string().optional().describe('comma-separated'),
      role: ROLE.optional().describe('author role; defaults to executor (agent)'),
      status: STATUS.optional().describe('decision family only'),
      constitutional: z.boolean().optional().describe('decision family only (ADR-0008)'),
    },
  },
  async (a) => {
    const e = addEntry(a.type, a.text, {
      role: envRole() ?? a.role ?? 'executor',
      tags: tags(a.tags),
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
    inputSchema: { old_id: z.string(), text: z.string(), role: ROLE.optional() },
  },
  async (a) => {
    const e = supersede(a.old_id, a.text, { role: envRole() ?? a.role ?? 'architect' });
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the protocol channel — never write to it. Log to stderr.
  process.stderr.write(`vtfkb MCP server up (brain: ${process.env.VTFKB_DIR ?? '~/.vtfkb'})\n`);
}

main().catch((err) => {
  process.stderr.write(`vtfkb MCP fatal: ${err}\n`);
  process.exit(1);
});
