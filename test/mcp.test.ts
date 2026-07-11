import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// PROTOCOL-LEVEL e2e: a real MCP SDK client speaks to our compiled server over
// stdio (spawned as a child process). This exercises the actual MCP wire protocol
// (initialize handshake, tools/list, tools/call) — not our internals.

const serverPath = resolve(__dirname, '../dist/mcp-server.js');
let client: Client;
let transport: StdioClientTransport;
let brain: string;

function callText(r: unknown): string {
  const content = (r as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((c) => c.text ?? '').join('\n');
}

beforeAll(async () => {
  brain = mkdtempSync(join(tmpdir(), 'vfkb-mcp-'));
  transport = new StdioClientTransport({
    command: process.execPath, // node
    args: [serverPath],
    env: { ...process.env, VFKB_DIR: brain },
  });
  client = new Client({ name: 'vfkb-test-client', version: '0.0.0' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client?.close();
});

describe('MCP protocol surface', () => {
  it('advertises the scoped tool set over the wire', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ['kb_add', 'kb_context', 'kb_get', 'kb_list', 'kb_map', 'kb_resume', 'kb_search', 'kb_supersede', 'kb_transition'].sort(),
    );
    expect(tools.length).toBeLessThanOrEqual(10); // tight surface (ASDLC MCP discipline)
    // every tool has a description + input schema delivered to the client
    for (const t of tools) {
      expect(typeof t.description).toBe('string');
      expect(t.inputSchema).toBeTruthy();
    }
  });
});

describe('tools/call round-trips through the real engine', () => {
  it('kb_add -> kb_search -> kb_get', async () => {
    const add = await client.callTool({
      name: 'kb_add',
      arguments: { type: 'decision', text: 'adopt vfkb MCP', status: 'accepted', constitutional: true },
    });
    const addText = callText(add);
    expect(addText).toMatch(/added .* adopt vfkb MCP/);
    const id = addText.split(' ')[1];

    const search = await client.callTool({ name: 'kb_search', arguments: { text: 'vfkb' } });
    expect(callText(search)).toContain('adopt vfkb MCP');

    const get = await client.callTool({ name: 'kb_get', arguments: { id } });
    const parsed = JSON.parse(callText(get));
    expect(parsed.id).toBe(id);
    expect(parsed.constitutional).toBe(true);
    expect(parsed.status).toBe('accepted');
  });

  it('kb_add folds `why` into the entry text (gotcha 91338268)', async () => {
    const add = await client.callTool({
      name: 'kb_add',
      arguments: { type: 'decision', text: 'use esbuild bundles', why: 'zero-dep portable engine' },
    });
    const id = callText(add).split(' ')[1];
    const get = await client.callTool({ name: 'kb_get', arguments: { id } });
    expect(JSON.parse(callText(get)).text).toContain('Why: zero-dep portable engine');
  });

  // Issue #95 instance 5: kb_add had NO way to attach a link target — a type=link
  // added via MCP recorded a link that points nowhere, silently (gotcha 80b214ec3a4f).
  it('kb_add type=link accepts `path` and folds it into the text', async () => {
    const add = await client.callTool({
      name: 'kb_add',
      arguments: { type: 'link', text: 'ADR-0051 delivery honesty', path: 'docs/adr/ADR-0051-delivery-is-unproven.md' },
    });
    const id = callText(add).split(' ')[1];
    const get = await client.callTool({ name: 'kb_get', arguments: { id } });
    expect(JSON.parse(callText(get)).text).toBe(
      'ADR-0051 delivery honesty → docs/adr/ADR-0051-delivery-is-unproven.md',
    );
  });

  it('kb_add rejects `path` on non-link types instead of silently dropping it', async () => {
    const r = await client.callTool({
      name: 'kb_add',
      arguments: { type: 'fact', text: 'not a link', path: 'docs/x.md' },
    });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(callText(r)).toMatch(/only valid with type=link/);
  });

  it('kb_add rejects an empty `path` — a blank target is the pointer-to-nowhere again', async () => {
    const r = await client.callTool({
      name: 'kb_add',
      arguments: { type: 'link', text: 'blank target', path: '  ' },
    });
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(callText(r)).toMatch(/non-empty path or URL/);
  });

  it('kb_map reports topology', async () => {
    const map = await client.callTool({ name: 'kb_map', arguments: {} });
    expect(callText(map)).toContain('entries');
    expect(callText(map)).toContain('decisions:');
  });

  it('kb_supersede removes the old decision from default search', async () => {
    const add = await client.callTool({
      name: 'kb_add',
      arguments: { type: 'decision', text: 'host is OLD.example.com', status: 'accepted' },
    });
    const oldId = callText(add).split(' ')[1];

    await client.callTool({
      name: 'kb_supersede',
      arguments: { old_id: oldId, text: 'host is NEW.example.com' },
    });

    const search = await client.callTool({ name: 'kb_search', arguments: { text: 'example.com' } });
    const out = callText(search);
    expect(out).toContain('NEW.example.com');
    expect(out).not.toContain('OLD.example.com');
  });

  it('kb_supersede folds `why` into the new decision text (Track 9 Q0)', async () => {
    const add = await client.callTool({
      name: 'kb_add',
      arguments: { type: 'decision', text: 'retry twice on failure', status: 'accepted' },
    });
    const oldId = callText(add).split(' ')[1];

    const sup = await client.callTool({
      name: 'kb_supersede',
      arguments: { old_id: oldId, text: 'retry three times on failure', why: 'observed flaky under load' },
    });
    const newId = callText(sup).split('-> ')[1].split(' ')[0];
    const get = await client.callTool({ name: 'kb_get', arguments: { id: newId } });
    expect(JSON.parse(callText(get)).text).toContain('Why: observed flaky under load');
  });

  it('kb_transition moves a decision through its lifecycle', async () => {
    const add = await client.callTool({
      name: 'kb_add',
      arguments: { type: 'decision', text: 'an RFC to consider' }, // defaults proposed
    });
    const id = callText(add).split(' ')[1];
    const t = await client.callTool({ name: 'kb_transition', arguments: { id, status: 'accepted' } });
    expect(callText(t)).toContain('/accepted');
  });
});

// H2a §3.1 — in the fleet the harness (not the model) must stamp who wrote an entry.
// VFKB_ROLE, set per-pod by the harness, is the authoritative author.role.
describe('VFKB_ROLE harness-stamped attribution', () => {
  let c: Client;
  let t: StdioClientTransport;

  beforeAll(async () => {
    const b = mkdtempSync(join(tmpdir(), 'vfkb-role-'));
    t = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { ...process.env, VFKB_DIR: b, VFKB_ROLE: 'judge' },
    });
    c = new Client({ name: 'vfkb-role-client', version: '0.0.0' });
    await c.connect(t);
  }, 30_000);

  afterAll(async () => {
    await c?.close();
  });

  it('stamps author.role from VFKB_ROLE when the model omits role', async () => {
    const add = await c.callTool({ name: 'kb_add', arguments: { type: 'fact', text: 'role-from-env fact' } });
    const id = callText(add).split(' ')[1];
    const get = await c.callTool({ name: 'kb_get', arguments: { id } });
    expect(JSON.parse(callText(get)).author.role).toBe('judge');
  });

  it('the harness role wins over a model-supplied role (no self-elevation)', async () => {
    const add = await c.callTool({
      name: 'kb_add',
      arguments: { type: 'fact', text: 'cannot self-elevate', role: 'architect' },
    });
    const id = callText(add).split(' ')[1];
    const get = await c.callTool({ name: 'kb_get', arguments: { id } });
    expect(JSON.parse(callText(get)).author.role).toBe('judge');
  });
});
