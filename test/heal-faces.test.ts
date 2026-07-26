// Issue #205, round-2 review finding #1 — THE CALL SITES, guarded at the
// process level.
//
// `test/heal.test.ts` proves `healBrain()`/`resumePayload()` are correct, and
// drives the pi handler directly. What neither of those can prove is that the
// SHIPPED ENTRY POINTS call them: reverting `mcp-server.ts`'s kb_resume or
// `cli.ts`'s resume verb back to a bare `renderResume(...)` is type-clean and
// leaves the whole suite green. That is verbatim the #205 defect class — the
// function exists and nobody calls it — so the guard has to run the real
// binaries.
//
// Precedent: the repo already spawns `node dist/cli.js` for hook fail-open.
// These need `npm run build` to have run; `pretest` does that.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'dist', 'cli.js');
const MCP = join(ROOT, 'dist', 'mcp-server.js');

let repo: string;
let brain: string;
const SENTINEL = 'harrowgate-lumen-52';
const git = (...a: string[]) =>
  execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A destroyed brain, built through the REAL CLI so nothing is faked. */
function destroyedBrain(): { env: NodeJS.ProcessEnv } {
  repo = mkdtempSync(join(tmpdir(), 'vfkb-faces-'));
  brain = join(repo, '.vfkb');
  const env = { ...process.env, VFKB_DATA_DIR: brain, VFKB_PROJECT: 'facesproj' };
  delete env.KB_SESSION_ID;
  delete env.VFKB_NO_JOURNAL;
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  execFileSync('node', [CLI, 'add', 'fact', 'baseline that predates the loss', '--role', 'human'], { env, stdio: 'ignore' });
  writeFileSync(join(repo, '.gitignore'), '.vfkb/.journal/\n.vfkb/.sessions/\n.vfkb/index-meta.json\n.vfkb/.lock\n');
  git('add', '.vfkb', '.gitignore');
  git('commit', '-qm', 'baseline');
  execFileSync('node', [CLI, 'add', 'decision', `queue migration codename ${SENTINEL}`, '--role', 'human', '--tag', 'handoff,next'], { env, stdio: 'ignore' });
  git('checkout', '--', '.vfkb/entries.jsonl');
  expect(readFileSync(join(brain, 'entries.jsonl'), 'utf8')).not.toContain(SENTINEL);
  return { env };
}

beforeEach(() => {
  repo = '';
});
afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('the shipped entry points heal (issue #205)', () => {
  it('a NEW Claude session heals, even seconds after the last one — the payload id is the key', () => {
    // The regression this guards is one this PR itself introduced: healBrain
    // read only $KB_SESSION_ID, while the hook's real session id arrives on
    // STDIN, so every face fell back to a wall clock and a brand-new session
    // did NOT recover a brain destroyed by `git checkout --` — RFC-034 incident
    // 1, going unrecovered where the pre-#205 engine recovered it.
    // KB_SESSION_ID is deliberately NOT set here: that override is not the path
    // production takes, and testing it certified a claim the hook did not meet.
    if (!existsSync(CLI)) throw new Error(`no ${CLI} — run npm run build`);
    const { env } = destroyedBrain();
    const hook = (sessionId: string) =>
      execFileSync('node', [CLI, 'hook', 'session-start'], {
        env,
        encoding: 'utf8',
        input: JSON.stringify({ session_id: sessionId, cwd: repo, hook_event_name: 'SessionStart' }),
      });

    const first = hook('session-AAA');
    expect(first).toMatch(/restored 1 journaled entry/);
    expect(readFileSync(join(brain, 'entries.jsonl'), 'utf8')).toContain(SENTINEL);

    // Destroy again, then start a DIFFERENT session immediately.
    git('checkout', '--', '.vfkb/entries.jsonl');
    expect(readFileSync(join(brain, 'entries.jsonl'), 'utf8')).not.toContain(SENTINEL);
    const second = hook('session-BBB');
    expect(second).toMatch(/restored 1 journaled entry/);
    expect(readFileSync(join(brain, 'entries.jsonl'), 'utf8')).toContain(SENTINEL);

    // ...while the SAME session id re-running does not re-restore (once per session).
    git('checkout', '--', '.vfkb/entries.jsonl');
    const again = hook('session-BBB');
    expect(again).not.toMatch(/restored/);
    expect(readFileSync(join(brain, 'entries.jsonl'), 'utf8')).not.toContain(SENTINEL);
  });


  it('`vfkb resume` restores the destroyed entry and reports it', () => {
    if (!existsSync(CLI)) throw new Error(`no ${CLI} — run npm run build`);
    const { env } = destroyedBrain();
    const out = execFileSync('node', [CLI, 'resume'], { env, encoding: 'utf8' });
    expect(out).toMatch(/restored 1 journaled entry/);
    expect(out).toContain(SENTINEL);
    expect(readFileSync(join(brain, 'entries.jsonl'), 'utf8')).toContain(SENTINEL);
  });

  it('the MCP `kb_resume` tool restores it too, over a real stdio session', async () => {
    if (!existsSync(MCP)) throw new Error(`no ${MCP} — run npm run build`);
    const { env } = destroyedBrain();
    const text = await new Promise<string>((resolve, reject) => {
      const p = spawn('node', [MCP], { env, stdio: ['pipe', 'pipe', 'ignore'] });
      let buf = '';
      const timer = setTimeout(() => {
        p.kill();
        reject(new Error(`kb_resume did not answer in time; saw: ${buf.slice(0, 400)}`));
      }, 20000);
      p.stdout.on('data', (d) => {
        buf += d;
        for (const line of buf.split('\n')) {
          if (!line.trim()) continue;
          let msg: { id?: number; result?: { content?: { text?: string }[] } };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.id === 1) {
            p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
            p.stdin.write(
              JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'kb_resume', arguments: {} } }) + '\n',
            );
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
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'heal-faces', version: '0' } },
        }) + '\n',
      );
    });
    expect(text).toMatch(/restored 1 journaled entry/);
    expect(text).toContain(SENTINEL);
    expect(readFileSync(join(brain, 'entries.jsonl'), 'utf8')).toContain(SENTINEL);
  }, 30000);
});
