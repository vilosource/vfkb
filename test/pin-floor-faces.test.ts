// RFC-043 Part A (ADR-0084 §5; vfkb#386) — face parity (#205): every face that renders
// `## Last handoff` renders the same "Commits since this handoff" block, from the real built
// entry points over a real git sandbox. And the cross-hook invariant: the Stop text, the
// UserPromptSubmit line and the render name the same commits.
//
// Faces: `vfkb resume` and MCP `kb_resume` (both resumePayload), the SessionStart hook,
// `vfkb context-block`, and pi's before_agent_start (driven in-process).

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import piExtension from '../src/pi-extension.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'dist', 'cli.js');
const MCP = join(ROOT, 'dist', 'mcp-server.js');
const SENTINEL = 'quillfeather-orbit-31';
const LEAD = 'Commits since this handoff was recorded (';

function envFor(repo: string): NodeJS.ProcessEnv {
  const env = { ...process.env, VFKB_DATA_DIR: join(repo, '.vfkb'), VFKB_PROJECT: 'floorproj' };
  delete env.KB_SESSION_ID;
  delete env.VFKB_DIR;
  delete env.VFKB_NO_JOURNAL;
  return env;
}
const iso = (offsetS: number) => new Date(Date.now() + offsetS * 1000).toISOString();

function repoWith(shape: 'stale' | 'squash'): string {
  const repo = mkdtempSync(join(tmpdir(), `vfkb-floor-${shape}-`));
  const env = envFor(repo);
  const git = (args: string[], when?: string) =>
    execFileSync('git', args, {
      cwd: repo,
      stdio: 'ignore',
      env: { ...process.env, ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}) },
    });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@example.invalid']);
  git(['config', 'user.name', 't']);
  writeFileSync(join(repo, '.gitignore'), '.vfkb/.journal/\n.vfkb/.sessions/\n.vfkb/.signals/\n.vfkb/index-meta.json\n.vfkb/.lock\n');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'baseline'], '2020-01-01T00:00:00Z');
  if (shape === 'squash') git(['switch', '-q', '-c', 'topic']);
  execFileSync('node', [CLI, 'add', 'fact', 'HANDOFF pin-own-sentinel next is X', '--role', 'human', '--tag', 'handoff,next'], {
    cwd: repo,
    env,
    stdio: 'ignore',
  });
  git(['add', '-A']);
  git(['commit', '-qm', 'pin'], iso(60));
  if (shape === 'squash') {
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git(['add', '-A']);
    git(['commit', '-qm', 'topic code'], iso(90));
    git(['switch', '-q', 'main']);
    git(['merge', '-q', '--squash', 'topic']);
    git(['commit', '-qm', 'squash topic (#1)'], iso(120));
  } else {
    writeFileSync(join(repo, 'c.txt'), 'c\n');
    git(['add', '-A']);
    git(['commit', '-qm', `feat: ${SENTINEL} landed`], iso(120));
  }
  return repo;
}

const cli = (repo: string, args: string[], input?: string) =>
  execFileSync('node', [CLI, ...args], { cwd: repo, env: envFor(repo), encoding: 'utf8', input });

function kbResume(repo: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const p = spawn('node', [MCP], { cwd: repo, env: envFor(repo), stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error(`kb_resume did not answer; saw: ${buf.slice(0, 400)}`));
    }, 30_000);
    p.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        let msg: { id?: number; result?: { content?: { text?: string }[] } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kb_resume', arguments: {} } }) + '\n');
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          p.kill();
          resolve(msg.result?.content?.map((c) => c.text ?? '').join('') ?? '');
        }
      }
    });
    p.on('error', reject);
    p.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'floor-faces', version: '0' } },
      }) + '\n',
    );
  });
}

async function piRender(repo: string): Promise<string> {
  const prevCwd = process.cwd();
  const prev = { d: process.env.VFKB_DATA_DIR, p: process.env.VFKB_PROJECT, v: process.env.VFKB_DIR };
  process.env.VFKB_DATA_DIR = join(repo, '.vfkb');
  process.env.VFKB_PROJECT = 'floorproj';
  delete process.env.VFKB_DIR;
  process.chdir(repo);
  try {
    const handlers: Record<string, (...a: unknown[]) => unknown> = {};
    piExtension({ on: (ev: string, h: (...a: unknown[]) => unknown) => (handlers[ev] = h) } as never);
    const out = (await handlers['before_agent_start']({ systemPrompt: 'BASE' })) as { systemPrompt: string };
    return out.systemPrompt;
  } finally {
    process.chdir(prevCwd);
    for (const [k, v] of [
      ['VFKB_DATA_DIR', prev.d],
      ['VFKB_PROJECT', prev.p],
      ['VFKB_DIR', prev.v],
    ] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}

/** The `## Last handoff` section of a render. */
const section = (s: string) => {
  const i = s.indexOf('## Last handoff');
  if (i < 0) return '';
  const j = s.indexOf('\n\n', s.indexOf('\n', i) + 1);
  return s.slice(i, j < 0 ? undefined : j);
};

let stale = '';
let squash = '';
beforeAll(() => {
  if (!existsSync(CLI) || !existsSync(MCP)) throw new Error('run npm run build first');
  stale = repoWith('stale');
  squash = repoWith('squash');
});

describe('every face renders the Part A block (#205 parity)', () => {
  it('stale sandbox: all five entry points carry the same block, naming the sentinel commit', async () => {
    const sha7 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: stale, encoding: 'utf8' }).trim().slice(0, 7);
    const want = `${LEAD}1):\n  ${sha7} feat: ${SENTINEL} landed`; // section() drops the final newline
    const faces: Record<string, string> = {
      resume: cli(stale, ['resume']),
      contextBlock: cli(stale, ['context-block']),
      sessionStart: JSON.parse(cli(stale, ['hook', 'session-start'], JSON.stringify({ session_id: 'ff-1', hook_event_name: 'SessionStart' })))
        .hookSpecificOutput.additionalContext,
      kbResume: await kbResume(stale),
      pi: await piRender(stale),
    };
    const sections = Object.fromEntries(Object.entries(faces).map(([k, v]) => [k, section(v)]));
    for (const [face, s] of Object.entries(sections)) {
      expect(s, face).toContain('pin-own-sentinel');
      expect(s, face).toContain(want);
    }
    expect(new Set(Object.values(sections)).size).toBe(1); // byte-identical sections
  });

  it('squash sandbox: the pin renders on every face, and no face carries the block', async () => {
    const faces: Record<string, string> = {
      resume: cli(squash, ['resume']),
      contextBlock: cli(squash, ['context-block']),
      sessionStart: JSON.parse(cli(squash, ['hook', 'session-start'], JSON.stringify({ session_id: 'ff-2', hook_event_name: 'SessionStart' })))
        .hookSpecificOutput.additionalContext,
      kbResume: await kbResume(squash),
      pi: await piRender(squash),
    };
    for (const [face, out] of Object.entries(faces)) {
      expect(out, face).toContain('## Last handoff');
      expect(out, face).toContain('pin-own-sentinel');
      expect(out, face).not.toContain('Commits since this handoff');
    }
  });

  it('MCP from a non-repo cwd still finds the in-tree brain repo (decide D10 fallback)', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'vfkb-floor-cwd-'));
    const text = await new Promise<string>((resolve, reject) => {
      const p = spawn('node', [MCP], { cwd: elsewhere, env: envFor(stale), stdio: ['pipe', 'pipe', 'ignore'] });
      let buf = '';
      const t = setTimeout(() => (p.kill(), reject(new Error('timeout'))), 30_000);
      p.stdout.on('data', (d) => {
        buf += d;
        for (const line of buf.split('\n')) {
          let m: { id?: number; result?: { content?: { text?: string }[] } };
          try {
            m = JSON.parse(line);
          } catch {
            continue;
          }
          if (m.id === 1) {
            p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
            p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kb_resume', arguments: {} } }) + '\n');
          }
          if (m.id === 2) {
            clearTimeout(t);
            p.kill();
            resolve(m.result?.content?.map((c) => c.text ?? '').join('') ?? '');
          }
        }
      });
      p.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'd10', version: '0' } },
        }) + '\n',
      );
    });
    expect(text).toContain(SENTINEL);
  });
});

describe('the Stop text, the UserPromptSubmit line and the render name the same commits', () => {
  it('cross-hook: one set S on all three surfaces', () => {
    const repo = repoWith('stale');
    const extra = (n: number) => {
      writeFileSync(join(repo, `x${n}.txt`), `${n}\n`);
      execFileSync('git', ['add', '-A'], { cwd: repo });
      execFileSync('git', ['commit', '-qm', `chore: extra ${n}`], {
        cwd: repo,
        env: { ...process.env, GIT_AUTHOR_DATE: iso(200 + n), GIT_COMMITTER_DATE: iso(200 + n) },
      });
    };
    extra(1);
    extra(2);
    const shas = execFileSync('git', ['log', '-3', '--format=%H'], { cwd: repo, encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((h) => h.slice(0, 7));
    // Off the default branch: ADR-0084 §1.4 (1c, vfkb#387) keeps B3 quiet on a clean `main`
    // with no new entries, which is this repo's shape. (On macOS the /var tmpdir symlink
    // made every brain line read as new, so 1c never held locally; CI's /tmp exposed it.)
    execFileSync('git', ['switch', '-q', '-c', 'feat/x'], { cwd: repo });
    // Stop at turn 3 (1a), from a seeded session record.
    const sid = 'xhook-1';
    for (let i = 0; i < 2; i++) cli(repo, ['hook', 'stop'], JSON.stringify({ session_id: sid, stop_hook_active: false }));
    const stop = JSON.parse(cli(repo, ['hook', 'stop'], JSON.stringify({ session_id: sid, stop_hook_active: false })));
    const stopText: string = stop.hookSpecificOutput.additionalContext;
    const ups: string = JSON.parse(cli(repo, ['hook', 'user-prompt-submit'], JSON.stringify({ session_id: 'xhook-2', prompt: 'go' })) || '{}')
      ?.hookSpecificOutput?.additionalContext ?? '';
    const render = cli(repo, ['context-block']);
    const ids = (s: string) => shas.filter((h) => s.includes(h));
    expect(ids(stopText)).toEqual(shas);
    expect(ids(section(render))).toEqual(shas);
    // The prompt line skips a persisted session's first prompt (Q2); xhook-2 has no record,
    // so it reads turn 0 → skipped. Use the Stop session, which is past its first prompt.
    const ups2: string =
      JSON.parse(cli(repo, ['hook', 'user-prompt-submit'], JSON.stringify({ session_id: sid, prompt: 'go' })) || '{}')?.hookSpecificOutput
        ?.additionalContext ?? '';
    expect(ups).toBe('');
    expect(ids(ups2)).toEqual(shas);
    expect(stopText).toContain(`${LEAD}3):`);
    expect(section(render)).toContain(`${LEAD}3):`);
    expect(ups2).toContain('predates 3 commits');
  });
});
