// vtfkb Pi face — the in-process TS extension (ADR-0015 cross-harness auto-layer).
// One engine, two faces: this is the Pi side; src/cli.ts + hooks are the Claude
// Code side. Same engine.ts underneath (LSP — every tier calls the same code).
//
// Contracts copied verbatim from the verified mykb spike (src/extension/*):
//   before_agent_start -> { systemPrompt } : APPEND the bundle (Tier A inject)
//   context            -> { messages:[{role:'custom',...}] } : per-turn (Tier C, Pi-only)
//   tool_call          -> { toolName, input } : gate brain writes + capture (Tier B)
//   session_shutdown   -> git save

import { mkdirSync } from 'node:fs';
import {
  brainDir,
  captureToolCall,
  currentInjectableIds,
  renderContextDelta,
  renderResume,
} from './engine.js';
import { SessionState } from './session.js';
import { isBrainWrite, GATING_REASON } from './gating.js';
import { save } from './git.js';
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
  mkdirSync(brainDir(), { recursive: true });
  const session = SessionState.load(); // isolated by KB_SESSION_ID (L4)

  pi.on('session_start', async () => {
    mkdirSync(brainDir(), { recursive: true });
  });

  // Tier A — session-start injection. The payload is the RESUME render (ADR-0020 pt 5):
  // the prior-session continuity digest + the live knowledge bundle, both derived at
  // render time. Parity with the claude SessionStart hook (`hook session-start`), which
  // already injects renderResume — the pi half previously injected only the bundle, so
  // cross-session continuity was undelivered here. Mark the bundle's entries injected so
  // the per-turn delta won't repeat them.
  pi.on('before_agent_start', async (...args: unknown[]): Promise<BeforeAgentStartResult> => {
    const e = (args[0] as BeforeAgentStartEvent) || {};
    const current = e.systemPrompt || '';
    const resume = renderResume(project(), session);
    session.markInjected(currentInjectableIds());
    session.save();
    return { systemPrompt: current + '\n\n' + resume };
  });

  // Tier C — per-turn delta (Pi-only). Inject ONLY entries new since the last turn
  // (session-deduped); skip when nothing changed.
  pi.on('context', async (...args: unknown[]): Promise<ContextEventResult | undefined> => {
    const event = args[0] as ContextEvent;
    const messages = event?.messages ?? [];
    const delta = renderContextDelta(session, project());
    session.save();
    if (!delta) return undefined; // no-op turn
    return { messages: [{ role: 'custom', content: delta }, ...messages] };
  });

  // Tool-gating + Tier-B capture. Gate brain-file writes first (force writes
  // through the engine); otherwise capture the tool call.
  pi.on('tool_call', async (...args: unknown[]): Promise<unknown> => {
    const e = (args[0] as ToolCallEvent) || {};
    if (isBrainWrite(e.toolName, e.input)) {
      return { block: true, reason: GATING_REASON }; // refuse direct brain edits
    }
    if (e.toolName) {
      captureToolCall({ tool_name: e.toolName, tool_input: e.input, call_id: e.toolCallId });
    }
    return undefined;
  });

  // Persist + commit the brain at session end.
  pi.on('session_shutdown', async () => {
    session.save();
    try {
      save('vtfkb: session changes', 'agent');
    } catch {
      /* non-git brain or git unavailable → skip */
    }
  });
}
