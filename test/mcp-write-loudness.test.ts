// ADR-0065 §2a — the engine-ownable loudness floor.
//
// #176's core sentence: "a failed kb_add must never appear to succeed." This is
// the deterministic, probe-independent slice of it — the MCP face must map every
// engine throw to an EXPLICIT tool error, never an empty-success shape. It is
// ADR-0051 §3's content-assertion discipline (exit status and error flags are not
// admissible on their own; assert over what the caller actually receives) applied
// to the capture path.
//
// Driven against the REAL compiled server over the real wire, deliberately: a
// helper-level assertion would pass while the shipped tool silently succeeded —
// the altitude lesson from PR #216 (brain f7103b61f0aa).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = resolve(__dirname, '../dist/mcp-server.js');

/** chmod is a no-op for root, which would turn the unwritable-brain arm green
 *  for the wrong reason. Skip rather than assert something untrue. */
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

async function connect(brain: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, VFKB_DATA_DIR: brain },
  });
  const client = new Client({ name: 'vfkb-loudness-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

/**
 * What the CALLER actually observes. A tool failure may surface either as a
 * rejected call or as an isError result — both are explicit. What must never
 * happen is a resolved, non-error result, because that is indistinguishable
 * from a successful capture.
 */
async function observe(fn: () => Promise<any>): Promise<{ explicitError: boolean; text: string }> {
  try {
    const r = await fn();
    const text = (r?.content ?? []).map((c: any) => c?.text ?? '').join('\n');
    return { explicitError: r?.isError === true, text };
  } catch (err) {
    return { explicitError: true, text: (err as Error).message };
  }
}

describe('ADR-0065 §2a — a failed kb_add must never appear to succeed (#176)', () => {
  let brain: string;
  let client: Client;

  beforeAll(async () => {
    brain = mkdtempSync(join(tmpdir(), 'vfkb-loud-'));
    client = await connect(brain);
  }, 30_000);

  afterAll(async () => {
    try {
      chmodSync(brain, 0o755);
    } catch {
      /* best effort */
    }
    await client?.close();
  });

  it('a WRITE-IMPOSSIBLE kb_add surfaces an explicit error, not a success shape', async () => {
    if (isRoot) return; // chmod cannot make a path unwritable for root
    // The #176 shape: the server is up and the tool is present, but the write
    // cannot land. Nothing about the transport is broken — only the filesystem.
    chmodSync(brain, 0o555);
    const seen = await observe(() =>
      client.callTool({ name: 'kb_add', arguments: { type: 'fact', text: 'must not appear to succeed' } }),
    );
    chmodSync(brain, 0o755);

    expect(seen.explicitError).toBe(true);
    // Content assertion, not just the flag: the caller must be able to tell that
    // nothing was captured.
    expect(seen.text.length).toBeGreaterThan(0);
    expect(seen.text).not.toMatch(/^added\b/i);
  });

  it('and the entry genuinely did not land (the error was not cosmetic)', () => {
    if (isRoot) return;
    const entries = join(brain, 'entries.jsonl');
    const body = existsSync(entries) ? readFileSync(entries, 'utf8') : '';
    expect(body).not.toContain('must not appear to succeed');
  });

  it('a handler validation throw surfaces as an explicit error', async () => {
    // `path` is only valid with type=link — the handler throws. That throw must
    // reach the caller as an error, not as an empty success.
    const seen = await observe(() =>
      client.callTool({ name: 'kb_add', arguments: { type: 'fact', text: 'x', path: 'docs/y.md' } }),
    );
    expect(seen.explicitError).toBe(true);
    expect(seen.text).toMatch(/only valid with type=link/i);
  });

  it('an empty link target surfaces as an explicit error', async () => {
    const seen = await observe(() =>
      client.callTool({ name: 'kb_add', arguments: { type: 'link', text: 'x', path: '   ' } }),
    );
    expect(seen.explicitError).toBe(true);
    expect(seen.text).toMatch(/non-empty/i);
  });

  it('a schema violation surfaces as an explicit error', async () => {
    const seen = await observe(() => client.callTool({ name: 'kb_add', arguments: { type: 'bogus', text: 'x' } }));
    expect(seen.explicitError).toBe(true);
  });

  it('CONTRAST: a healthy kb_add still succeeds and is NOT reported as an error', async () => {
    // Without this the suite would pass if every call errored — the loudness
    // floor must not be satisfied by breaking capture outright.
    const seen = await observe(() =>
      client.callTool({ name: 'kb_add', arguments: { type: 'fact', text: 'healthy capture sentinel LOUD-1' } }),
    );
    expect(seen.explicitError).toBe(false);
    expect(seen.text).toMatch(/LOUD-1/);
    expect(readFileSync(join(brain, 'entries.jsonl'), 'utf8')).toContain('LOUD-1');
  });
});
