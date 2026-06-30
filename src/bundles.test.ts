// FR-2 (ADR-0030) inner gate — the single-file engine bundles must resolve and
// run PORTABLY: from a working directory that is NOT the repo and has NO
// node_modules (the consumer condition). This is the deterministic backstop for
// "portable engine resolution"; the agent-driven consumer-onboarding L4 scenario
// is the capability-level DoD (ADR-0029).

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const buildScript = join(repoRoot, 'scripts', 'build-bundles.mjs');

let bundles: { cli: string; mcp: string };

function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; input?: string; timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => child.kill(), opts.timeoutMs ?? 15000);
    child.on('close', (code) => {
      clearTimeout(t);
      resolveP({ code, stdout, stderr });
    });
    if (opts.input) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

// Drive the MCP server over stdio: initialize → initialized → tools/list.
function mcpToolNames(bundle: string, cwd: string, brain: string): Promise<string[]> {
  return new Promise((resolveP, reject) => {
    const child = spawn('node', [bundle], {
      cwd,
      env: { ...process.env, VFKB_DIR: brain, VFKB_PROJECT: 'bundle-test' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    const t = setTimeout(() => {
      child.kill();
      reject(new Error('mcp tools/list timed out'));
    }, 15000);
    child.stdout.on('data', (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 2) {
          clearTimeout(t);
          child.kill();
          resolveP((msg.result?.tools ?? []).map((x: any) => x.name).sort());
        }
      }
    });
    const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  });
}

// Drive the MCP server over stdio for a kb_add(why) → kb_get round-trip; returns the
// stored entry text. Proves the BUNDLE (the consumer surface) folds `why` (gotcha 91338268).
function mcpAddWhyGetText(bundle: string, cwd: string, brain: string): Promise<string> {
  return new Promise((resolveP, reject) => {
    const child = spawn('node', [bundle], {
      cwd,
      env: { ...process.env, VFKB_DIR: brain, VFKB_PROJECT: 'bundle-test' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    const t = setTimeout(() => {
      child.kill();
      reject(new Error('mcp why round-trip timed out'));
    }, 15000);
    const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + '\n');
    child.stdout.on('data', (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 2) {
          const added: string = msg.result?.content?.[0]?.text ?? '';
          const id = (added.match(/added\s+(\S+)/) ?? [])[1];
          send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'kb_get', arguments: { id } } });
        } else if (msg.id === 3) {
          clearTimeout(t);
          child.kill();
          try {
            resolveP(JSON.parse(msg.result?.content?.[0]?.text ?? '{}').text ?? '');
          } catch {
            resolveP('');
          }
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'kb_add', arguments: { type: 'decision', text: 'adopt the bundle', why: 'consumer surface' } },
    });
  });
}

describe('FR-2 portable single-file engine bundles (ADR-0030)', () => {
  beforeAll(async () => {
    const out = mkdtempSync(join(tmpdir(), 'vfkb-bundles-'));
    const r = await run('node', [buildScript, out], { cwd: repoRoot, timeoutMs: 60000 });
    expect(r.code, `build-bundles failed:\n${r.stderr}`).toBe(0);
    bundles = { cli: join(out, 'vfkb.mjs'), mcp: join(out, 'vfkb-mcp.mjs') };
    expect(existsSync(bundles.cli)).toBe(true);
    expect(existsSync(bundles.mcp)).toBe(true);
  }, 60000);

  it('vfkb-mcp.mjs advertises all 9 kb_* tools from a non-repo cwd with no node_modules', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vfkb-consumer-'));
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-brain-'));
    const tools = await mcpToolNames(bundles.mcp, cwd, brain);
    expect(tools).toEqual([
      'kb_add',
      'kb_context',
      'kb_get',
      'kb_list',
      'kb_map',
      'kb_resume',
      'kb_search',
      'kb_supersede',
      'kb_transition',
    ]);
  }, 30000);

  it('vfkb-mcp.mjs folds kb_add `why` into the entry text (gotcha 91338268)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vfkb-consumer-'));
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-brain-'));
    const text = await mcpAddWhyGetText(bundles.mcp, cwd, brain);
    expect(text).toContain('adopt the bundle');
    expect(text).toContain('Why: consumer surface');
  }, 30000);

  it('vfkb.mjs runs the engine (add → persisted) from a non-repo cwd with no node_modules', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'vfkb-consumer-'));
    const brain = mkdtempSync(join(tmpdir(), 'vfkb-brain-'));
    const r = await run('node', [bundles.cli, 'add', 'fact', 'bundle-portability-smoke', '--role', 'human'], {
      cwd,
      env: { VFKB_DIR: brain, VFKB_PROJECT: 'bundle-test' },
    });
    expect(r.code, `cli add failed:\n${r.stderr}`).toBe(0);
    const entries = readFileSync(join(brain, 'entries.jsonl'), 'utf8');
    expect(entries).toContain('bundle-portability-smoke');
  }, 30000);
});
