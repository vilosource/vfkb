import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ADR-0082 §4/§6 on the real faces: `vfkb add --retires`, `vfkb curate retire --by`,
// `vfkb curate restore`, the two read-only reports, and `kb_add retires` over MCP.
const CLI = resolve(__dirname, '../dist/cli.js');
const SERVER = resolve(__dirname, '../dist/mcp-server.js');

const line = (id: string, created: string, tags = ['handoff'], text = `HANDOFF: ${id}`) =>
  JSON.stringify({
    id,
    type: 'fact',
    text,
    tags,
    zone: 'established',
    author: { role: 'human' },
    provenance: { status: 'verified', date: created },
    validity: { valid_from: created },
    created,
    updated: created,
  }) + '\n';

function brain(...lines: string[]): string {
  const d = mkdtempSync(join(tmpdir(), 'vfkb-r7cli-'));
  for (const l of lines) appendFileSync(join(d, 'entries.jsonl'), l);
  return d;
}
const env = (b: string) => {
  const e: NodeJS.ProcessEnv = { ...process.env, VFKB_DATA_DIR: b };
  delete e.VFKB_DIR;
  delete e.KB_SESSION_ID;
  return e;
};
const vfkb = (b: string, ...args: string[]) => spawnSync('node', [CLI, ...args], { env: env(b), encoding: 'utf8' });
const live = (b: string) => {
  const newest = new Map<string, { zone: string; tags: string[]; text: string }>();
  for (const l of readFileSync(join(b, 'entries.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(l);
    newest.set(r.id, r);
  }
  return newest;
};

describe('CLI — retirement', () => {
  it('vfkb add --retires writes the new handoff and retires the named one', () => {
    const b = brain(line('old', '2026-01-01T00:00:00.000Z'));
    const r = vfkb(b, 'add', 'fact', 'HANDOFF: new', '--role', 'human', '--tag', 'handoff', '--retires', 'old');
    expect(r.status).toBe(0);
    const newId = r.stdout.split('\t')[0];
    const old = live(b).get('old')!;
    expect(old.zone).toBe('archive');
    expect(old.tags).toContain(`retired-by:${newId}`);
  });

  it('vfkb curate retire <old> --by <new>, then curate restore <old>', () => {
    const b = brain(line('old', '2026-01-01T00:00:00.000Z'), line('new', '2026-02-01T00:00:00.000Z'));
    const r1 = vfkb(b, 'curate', 'retire', 'old', '--by', 'new');
    expect(r1.status).toBe(0);
    expect(r1.stdout).toMatch(/retired old .*new/);
    expect(live(b).get('old')!.zone).toBe('archive');
    const r2 = vfkb(b, 'curate', 'restore', 'old');
    expect(r2.status).toBe(0);
    expect(live(b).get('old')!.zone).toBe('established');
    expect(live(b).get('old')!.tags).not.toContain('retired-by:new');
  });

  it('curate retire without --by is a usage error and writes nothing', () => {
    const b = brain(line('old', '2026-01-01T00:00:00.000Z'), line('new', '2026-02-01T00:00:00.000Z'));
    const before = readFileSync(join(b, 'entries.jsonl'), 'utf8');
    const r = vfkb(b, 'curate', 'retire', 'old');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--by/);
    expect(readFileSync(join(b, 'entries.jsonl'), 'utf8')).toBe(before);
  });

  it('a refused retire exits non-zero with the reason and writes nothing', () => {
    const b = brain(line('old', '2026-01-01T00:00:00.000Z'), line('new', '2026-02-01T00:00:00.000Z'));
    const before = readFileSync(join(b, 'entries.jsonl'), 'utf8');
    const r = vfkb(b, 'curate', 'retire', 'new', '--by', 'old');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/older/);
    expect(readFileSync(join(b, 'entries.jsonl'), 'utf8')).toBe(before);
  });
});

describe('CLI — reports', () => {
  it('curate handoffs prints a curate archive line per candidate and names the pin', () => {
    const b = brain(line('h1', '2026-01-01T00:00:00.000Z'), line('h2', '2026-02-01T00:00:00.000Z'));
    const before = readFileSync(join(b, 'entries.jsonl'), 'utf8');
    const r = vfkb(b, 'curate', 'handoffs');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/pin.*h2/);
    expect(r.stdout).toContain('curate archive h1');
    expect(r.stdout).not.toContain('curate archive h2');
    expect(readFileSync(join(b, 'entries.jsonl'), 'utf8')).toBe(before);
  });

  it('curate stale --days N lists old status facts and honours N', () => {
    const b = brain(line('s1', '2020-01-01T00:00:00.000Z', ['status'], 'old status'));
    const before = readFileSync(join(b, 'entries.jsonl'), 'utf8');
    const r = vfkb(b, 'curate', 'stale', '--days', '30');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('s1');
    const r2 = vfkb(b, 'curate', 'stale', '--days', '100000');
    expect(r2.stdout).not.toContain('s1');
    expect(readFileSync(join(b, 'entries.jsonl'), 'utf8')).toBe(before);
  });

  it('curate stale rejects a non-numeric --days', () => {
    const b = brain(line('s1', '2020-01-01T00:00:00.000Z', ['status']));
    const r = vfkb(b, 'curate', 'stale', '--days', 'soon');
    expect(r.status).not.toBe(0);
  });
});

describe('MCP — kb_add retires (the surface stays at 9 tools)', () => {
  let client: Client;
  let b: string;
  beforeAll(async () => {
    b = brain(line('old', '2026-01-01T00:00:00.000Z'));
    const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: env(b) as Record<string, string> });
    client = new Client({ name: 'r7-test', version: '0.0.0' });
    await client.connect(transport);
  }, 30_000);
  afterAll(async () => {
    await client?.close();
  });

  it('kb_add with retires archives the named handoff', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
    const res = await client.callTool({
      name: 'kb_add',
      arguments: { type: 'fact', text: 'HANDOFF: via mcp', tags: 'handoff', role: 'human', retires: 'old' },
    });
    expect((res as { isError?: boolean }).isError).not.toBe(true);
    expect(live(b).get('old')!.zone).toBe('archive');
    expect(live(b).get('old')!.tags.some((t) => t.startsWith('retired-by:'))).toBe(true);
  });
});
