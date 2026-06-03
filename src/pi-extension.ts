// vtfkb Pi face — the in-process TS extension (ADR-0015 cross-harness auto-layer).
// One engine, two faces: this is the Pi side; src/cli.ts + hooks are the Claude
// Code side. Same engine.ts underneath (LSP — every tier calls the same code).
//
// Contracts copied verbatim from the verified mykb spike (src/extension/*):
//   before_agent_start -> { systemPrompt } : APPEND the bundle (Tier A inject)
//   context            -> { messages:[{role:'custom',...}] } : per-turn (Tier C, Pi-only)
//   tool_call          -> { toolName, input } : capture (Tier B)

import { mkdirSync } from 'node:fs';
import { brainDir, captureToolCall, renderContextBundle } from './engine.js';
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartResult,
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ToolCallEvent,
} from './pi-types.js';

function project(): string {
  return process.env.VTFKB_PROJECT || 'spike';
}

export default function (pi: ExtensionAPI): void {
  // Ensure the brain dir exists (engine writes lazily; capture needs it).
  mkdirSync(brainDir(), { recursive: true });

  // session_start — init only, no injection.
  pi.on('session_start', async () => {
    mkdirSync(brainDir(), { recursive: true });
  });

  // Tier A — session-start injection. APPEND the bundle to the system prompt.
  pi.on('before_agent_start', async (...args: unknown[]): Promise<BeforeAgentStartResult> => {
    const e = (args[0] as BeforeAgentStartEvent) || {};
    const current = e.systemPrompt || '';
    return { systemPrompt: current + '\n\n' + renderContextBundle(project()) };
  });

  // Tier C — per-turn injection (Pi-only). Inject as a `custom`-role message
  // (the only role Pi converts to LLM-visible text). Kept simple for the spike:
  // re-inject the budgeted bundle each turn.
  pi.on('context', async (...args: unknown[]): Promise<ContextEventResult | undefined> => {
    const event = args[0] as ContextEvent;
    const messages = event?.messages ?? [];
    const block = renderContextBundle(project());
    return { messages: [{ role: 'custom', content: block }, ...messages] };
  });

  // Tier B — passive capture of tool calls.
  pi.on('tool_call', async (...args: unknown[]): Promise<unknown> => {
    const e = (args[0] as ToolCallEvent) || {};
    if (e.toolName) {
      captureToolCall({ tool_name: e.toolName, tool_input: e.input, call_id: e.toolCallId });
    }
    return undefined; // never block the tool
  });
}
