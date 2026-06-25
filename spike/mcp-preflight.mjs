// spike/mcp-preflight.mjs — deterministic, LLM-free proof that the vtfkb MCP server
// starts and advertises its full tool surface over the wire (initialize + tools/list).
//
// Used by dogfood-smoke check 6a to SEPARATE two claims the old single check conflated:
//   (a) the MCP server / image is sound  -> THIS, never flaky (no model in the loop);
//   (b) a real LLM can drive the tools   -> check 6b, which races claude -p's MCP
//       cold-start and is therefore retried, not trusted on the first shot.
// Honours pattern P2 (deterministic backstop > probabilistic gate).
//
//   node spike/mcp-preflight.mjs                 # tests ./dist/mcp-server.js (host)
//   VTFKB_MCP_SERVER=/opt/vtfkb/dist/mcp-server.js node ...   # tests the baked server
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const server =
  process.env.VTFKB_MCP_SERVER ||
  resolve(fileURLToPath(import.meta.url), '../../dist/mcp-server.js');
const REQUIRED = ['kb_add', 'kb_get', 'kb_list', 'kb_map', 'kb_search', 'kb_supersede', 'kb_transition'];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...process.env, VTFKB_DIR: mkdtempSync(join(tmpdir(), 'vtfkb-preflight-')) },
});
const client = new Client({ name: 'vtfkb-preflight', version: '0.0.0' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  const missing = REQUIRED.filter((n) => !names.includes(n));
  await client.close();
  if (missing.length) {
    console.error('FAIL: MCP server missing tools:', missing.join(', '));
    process.exit(1);
  }
  console.log('OK: MCP server advertises', names.sort().join(', '));
  process.exit(0);
} catch (e) {
  console.error('FAIL: preflight error:', e?.message || e);
  try { await client.close(); } catch { /* ignore */ }
  process.exit(1);
}
