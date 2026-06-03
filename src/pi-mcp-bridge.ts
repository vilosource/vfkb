// vtfkb pi MCP bridge — gives pi genuine MCP capability (on par with Claude Code).
//
// pi ships NO MCP by design (its README: "build an extension that adds MCP support").
// This is that extension: it reads a Claude-compatible mcpServers config, connects to
// each (stdio) MCP server with the official @modelcontextprotocol/sdk client, lists
// their tools, and registers each as a native pi tool named `mcp__<server>__<tool>`
// (matching Claude Code's naming) that proxies to the server.
//
// Config (env VTFKB_MCP_CONFIG = path to JSON), Claude-compatible:
//   { "mcpServers": { "vtfkb": { "command": "node", "args": ["…/dist/mcp-server.js"],
//                                 "env": { "VTFKB_DIR": "…" } } } }
//
// Load it like any pi extension:  pi -e dist/pi-mcp-bridge.js
//
// Connection model: CONNECT-PER-CALL. We connect once at load only to list tools (then
// close that connection), and each tool `execute` opens → calls → closes its own
// connection. This guarantees no MCP child process / stdio pipe lingers to keep pi's
// event loop alive — so `pi -p` exits cleanly (a persistent connection made it hang).
// Top-level await is safe: pi loads extensions via `await jiti.import(...)`, so module
// evaluation (incl. discovery) completes before the default export is invoked.

import { readFileSync, existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ExtensionAPI, ToolDefinition, ToolResult } from './pi-types.js';

interface ServerSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

async function connect(spec: ServerSpec): Promise<Client> {
  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args ?? [],
    env: { ...(process.env as Record<string, string>), ...(spec.env ?? {}) },
  });
  const client = new Client({ name: 'vtfkb-pi-bridge', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

function toContent(r: { content?: Array<{ type?: string; text?: string }> }): ToolResult {
  const content = (r.content ?? []).map((c) => ({
    type: 'text',
    text: typeof c.text === 'string' ? c.text : JSON.stringify(c),
  }));
  return { content: content.length ? content : [{ type: 'text', text: '(no content)' }], details: {} };
}

function readConfig(): Record<string, ServerSpec> {
  const p = process.env.VTFKB_MCP_CONFIG;
  if (!p || !existsSync(p)) return {};
  try {
    return (JSON.parse(readFileSync(p, 'utf8')).mcpServers ?? {}) as Record<string, ServerSpec>;
  } catch {
    return {};
  }
}

async function discover(): Promise<ToolDefinition[]> {
  const defs: ToolDefinition[] = [];
  for (const [name, spec] of Object.entries(readConfig())) {
    let client: Client | undefined;
    try {
      client = await connect(spec);
      const { tools } = await client.listTools();
      for (const t of tools) {
        const toolName = t.name;
        defs.push({
          name: `mcp__${name}__${toolName}`,
          label: toolName,
          description: t.description ?? `MCP tool ${toolName} on ${name}`,
          parameters: t.inputSchema ?? { type: 'object', properties: {} },
          // connect-per-call: open, call, close — nothing lingers.
          execute: async (_id: string, params: Record<string, unknown>): Promise<ToolResult> => {
            const c = await connect(spec);
            try {
              return toContent(
                (await c.callTool({ name: toolName, arguments: params ?? {} })) as {
                  content?: Array<{ type?: string; text?: string }>;
                },
              );
            } finally {
              await c.close().catch(() => {});
            }
          },
        });
      }
      process.stderr.write(`vtfkb-pi-bridge: bridged '${name}' (${tools.length} tools)\n`);
    } catch (e) {
      process.stderr.write(`vtfkb-pi-bridge: failed to bridge '${name}': ${(e as Error).message}\n`);
    } finally {
      await client?.close().catch(() => {}); // close the discovery connection
    }
  }
  return defs;
}

// Top-level await: completes before pi invokes the default export (loader awaits import).
const DEFS = await discover();

export default function (pi: ExtensionAPI): void {
  for (const d of DEFS) pi.registerTool(d);
}
