#!/usr/bin/env node
// ============================================================================
// A REAL vfkb MCP server that dies after N tool calls — the instrument for the
// ADR-0065 §0 probe.
//
// WHY A WRAPPER RATHER THAN `kill -9` FROM OUTSIDE: killing the server on a
// timer races the agent's turn, so a red run could mean "the agent saw nothing"
// or "we killed it too late". This makes death DETERMINISTIC and causally tied
// to the agent's own activity: the Nth tools/call is the last one served.
//
// WHY IT PROXIES THE REAL SERVER rather than faking the protocol: §0 exists to
// record what an agent ACTUALLY observes on the current stack. A hand-rolled
// stub would record what I imagine the shape is — the precise mistake ADR-0051
// §1 documents (`--plugin-dir` prescribed as "the real surface" without
// checking). Everything before the kill is genuine vfkb-mcp behaviour.
//
//   VFKB_PROBE_DIE_AFTER=1 node mcp-disconnect-server.mjs
//
// Env:
//   VFKB_PROBE_DIE_AFTER  tool calls to serve before dying (default 1)
//   VFKB_PROBE_LOG        file to append probe events to (optional)
//   VFKB_PROBE_MODE       'kill' (default) exits hard, severing the pipe;
//                         'hang' stops responding but holds the pipe open —
//                         a different failure shape worth telling apart.
// ============================================================================
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO, 'dist', 'mcp-server.js');
const DIE_AFTER = Number(process.env.VFKB_PROBE_DIE_AFTER ?? '1');
const MODE = process.env.VFKB_PROBE_MODE ?? 'kill';
const LOG = process.env.VFKB_PROBE_LOG;

const log = (event, extra = {}) => {
  if (!LOG) return;
  try {
    appendFileSync(LOG, JSON.stringify({ event, at: new Date().toISOString(), ...extra }) + '\n');
  } catch {
    /* the probe must never wedge the session on a logging failure */
  }
};

// B4 (review of #227): without a startup event, a fresh spawn and a second
// pre-existing instance are indistinguishable in the log — both would log their
// first call as n:1. This line is what turns "a second instance served it" into
// "the harness spawned a new one".
log('starting', { pid: process.pid, dieAfter: DIE_AFTER, mode: MODE });

const child = spawn(process.execPath, [SERVER], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
});

let served = 0;
let dead = false;

// Count tool calls on the way IN. Requests are newline-delimited JSON-RPC; we
// only inspect, never rewrite, so the proxy is transparent until it stops.
let inBuf = '';
process.stdin.on('data', (chunk) => {
  if (dead) return; // 'hang' mode: swallow, hold the pipe, answer nothing
  inBuf += chunk.toString();
  const lines = inBuf.split('\n');
  inBuf = lines.pop() ?? '';
  for (const line of lines) {
    if (line.trim()) {
      try {
        const msg = JSON.parse(line);
        if (msg.method === 'tools/call') {
          served++;
          log('tool_call_seen', { n: served, tool: msg.params?.name });
        }
      } catch {
        /* not JSON we understand — pass it through untouched */
      }
    }
    child.stdin.write(line + '\n');
  }
});

// Die AFTER the response to the Nth call has been forwarded, so the agent gets
// one genuine success and only then loses the server. Dying before the response
// would conflate "server died" with "call failed".
let outBuf = '';
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (dead || served < DIE_AFTER) return;
  outBuf += chunk.toString();
  // Only act once a complete response line has gone out.
  if (!outBuf.includes('\n')) return;
  dead = true;
  log('dying', { mode: MODE, afterToolCalls: served });
  if (MODE === 'hang') {
    child.kill('SIGKILL'); // the backend is gone; the pipe stays open
    return;
  }
  child.kill('SIGKILL');
  // Sever the transport the way a crashed server does.
  setTimeout(() => process.exit(0), 50);
});

child.on('exit', (code, signal) => {
  log('backend_exit', { code, signal });
  if (MODE !== 'hang' && !dead) process.exit(code ?? 0);
});

process.on('SIGTERM', () => {
  child.kill('SIGKILL');
  process.exit(0);
});
