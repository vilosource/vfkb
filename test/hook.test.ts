import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercises the actual CLI hook command (the claude-side capture face) end-to-end,
// like mcp.test boots the built MCP server — `pretest` (tsc) guarantees dist exists.
const CLI = resolve(__dirname, '../dist/cli.js');

function runHook(brain: string, payload: object): void {
  execFileSync('node', [CLI, 'hook', 'post-tool-use'], {
    input: JSON.stringify(payload),
    env: { ...process.env, VTFKB_DIR: brain },
  });
}
function captured(brain: string): Record<string, unknown> | undefined {
  const f = join(brain, 'entries.jsonl');
  if (!existsSync(f)) return undefined;
  return readFileSync(f, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .find((e) => Array.isArray((e as { tags?: unknown }).tags) && (e.tags as string[]).includes('captured'));
}

describe('post-tool-use hook — live result capture (D-iv)', () => {
  it('captures a failed claude tool call from the `tool_response` field as capture:error', () => {
    // Claude Code's PostToolUse payload carries the result under `tool_response` (verified
    // 2026-06-27), NOT `tool_result`. Without the fallback this records as capture:ok and the
    // distiller never fires on a real claude failure.
    const b = mkdtempSync(join(tmpdir(), 'vtfkb-hook-'));
    runHook(b, {
      tool_name: 'Bash',
      tool_input: { command: 'cat /nope' },
      tool_response: { stdout: '', stderr: 'cat: /nope: No such file or directory' },
      tool_use_id: 'c1',
    });
    const cap = captured(b);
    expect(cap).toBeTruthy();
    expect((cap!.tags as string[])).toContain('capture:error');
  });

  it('still honors `tool_result` with precedence (host-side synthetic seam)', () => {
    const b = mkdtempSync(join(tmpdir(), 'vtfkb-hook-'));
    runHook(b, {
      tool_name: 'Bash',
      tool_input: { command: 'x' },
      tool_result: { stderr: 'connection refused' },
      call_id: 'c2',
    });
    expect((captured(b)!.tags as string[])).toContain('capture:error');
  });
});
