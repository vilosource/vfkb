// Tool-gating (mykb L10 mitigation / D7c). Block harness file-write tools from
// editing the brain JSONL directly — all writes MUST go through the engine (sole
// writer, D4a; keeps the index/freshness invariants and the no-secrets lint).
// Harness-agnostic: handles Claude Code ('Write'/'Edit'/'MultiEdit') and Pi
// ('write'/'edit') tool names + their path aliases.
//
// SCOPE (issue #151): this gates direct FILE-WRITE tools only. An exec/shell
// tool (`bash`) is root-equivalent — `echo > brain` cannot be reliably stopped
// by inspecting tool inputs, and a heuristic command-string filter would be
// trivially evadable (against the deterministic-Brake doctrine). So exec tools
// are OUT OF SCOPE by design; the guarantee is "the write/edit tools can't clobber
// the brain," not "no tool can." Harnesses that must contain an untrusted agent
// restrict the toolset (e.g. the L4 tool-gating scenario allows only write/edit).

import { resolve } from 'node:path';
import { brainDir } from './storage.js';

const WRITE_TOOLS = new Set([
  'write',
  'edit',
  'multiedit',
  'notebookedit',
  'create',
  'str_replace_editor',
]);

function extractPath(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const p = input.file_path ?? input.path ?? input.filePath ?? input.notebook_path;
  return typeof p === 'string' ? p : undefined;
}

// Is this tool call a direct write into the brain directory?
export function isBrainWrite(
  toolName: string | undefined,
  input: Record<string, unknown> | undefined,
  brain = brainDir(),
): boolean {
  if (!toolName || !WRITE_TOOLS.has(toolName.toLowerCase())) return false;
  const p = extractPath(input);
  if (!p) return false;
  const abs = resolve(p);
  const root = resolve(brain);
  return abs === root || abs.startsWith(root + '/');
}

export const GATING_REASON =
  'vfkb: edit the brain via the engine/CLI/MCP, not by writing files directly ' +
  '(keeps the index, freshness, and no-secrets invariants).';
