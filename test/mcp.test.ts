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
  brain = mkdtempSync(join(tmpdir(), 'vtfkb-mcp-'));
  transport = new StdioClientTransport({
    command: process.execPath, // node
    args: [serverPath],
    env: { ...process.env, VTFKB_DIR: brain },
  });
  client = new Client({ name: 'vtfkb-test-client', version: '0.0.0' });
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
      ['kb_add', 'kb_get', 'kb_list', 'kb_map', 'kb_resume', 'kb_search', 'kb_supersede', 'kb_transition'].sort(),
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
      arguments: { type: 'decision', text: 'adopt vtfkb MCP', status: 'accepted', constitutional: true },
    });
    const addText = callText(add);
    expect(addText).toMatch(/added .* adopt vtfkb MCP/);
    const id = addText.split(' ')[1];

    const search = await client.callTool({ name: 'kb_search', arguments: { text: 'vtfkb' } });
    expect(callText(search)).toContain('adopt vtfkb MCP');

    const get = await client.callTool({ name: 'kb_get', arguments: { id } });
    const parsed = JSON.parse(callText(get));
    expect(parsed.id).toBe(id);
    expect(parsed.constitutional).toBe(true);
    expect(parsed.status).toBe('accepted');
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
// VTFKB_ROLE, set per-pod by the harness, is the authoritative author.role.
describe('VTFKB_ROLE harness-stamped attribution', () => {
  let c: Client;
  let t: StdioClientTransport;

  beforeAll(async () => {
    const b = mkdtempSync(join(tmpdir(), 'vtfkb-role-'));
    t = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { ...process.env, VTFKB_DIR: b, VTFKB_ROLE: 'judge' },
    });
    c = new Client({ name: 'vtfkb-role-client', version: '0.0.0' });
    await c.connect(t);
  }, 30_000);

  afterAll(async () => {
    await c?.close();
  });

  it('stamps author.role from VTFKB_ROLE when the model omits role', async () => {
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
