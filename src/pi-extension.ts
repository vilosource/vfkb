// vfkb Pi face — the in-process TS extension (ADR-0015 cross-harness auto-layer).
// One engine, two faces: this is the Pi side; src/cli.ts + hooks are the Claude
// Code side. Same engine.ts underneath (LSP — every tier calls the same code).
//
// Contracts copied verbatim from the verified mykb spike (src/extension/*):
//   before_agent_start -> { systemPrompt } : APPEND the bundle (Tier A inject)
//   context            -> { messages:[{role:'custom',...}] } : per-turn (Tier C, Pi-only)
//   tool_call          -> { toolName, input } : gate brain writes (pre-execution block)
//   tool_execution_end -> { toolName, result, isError } : capture WITH result (Tier B, D-iv)
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
import { defaultProject } from './storage.js';
import { isBrainWrite, GATING_REASON } from './gating.js';
import { save } from './git.js';
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartResult,
  ContextEvent,
  ContextEventResult,
  ExtensionAPI,
  ToolCallEvent,
  ToolExecutionStartEvent,
  ToolExecutionEndEvent,
} from './pi-types.js';

function project(): string {
  return defaultProject();
}

// Reduce a pi tool result (AgentToolResult-ish: { content:[{text}], details } | string |
// object) to a bounded text summary for capture. classifyToolOutcome caps length; here we
// just extract the most useful string.
function resultText(r: unknown): string {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r === 'object') {
    const o = r as Record<string, unknown>;
    if (Array.isArray(o.content)) {
      return o.content
        .map((c) => (c && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
        .join(' ')
        .trim();
    }
    return JSON.stringify(o);
  }
  return String(r);
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

  // Tool-gating (pre-execution). Gate brain-file writes here — the block MUST happen
  // before the tool runs, so a blocked write never reaches tool_execution_end and is
  // never captured. Capture itself moved to tool_execution_end (D-iv): tool_call has no
  // result, so capturing here recorded every failure as capture:ok and the distiller
  // could never act on a LIVE pi failure (the 2026-06-27 finding).
  pi.on('tool_call', async (...args: unknown[]): Promise<unknown> => {
    const e = (args[0] as ToolCallEvent) || {};
    if (isBrainWrite(e.toolName, e.input)) {
      return { block: true, reason: GATING_REASON }; // refuse direct brain edits
    }
    return undefined;
  });

  // Correlate start→end by toolCallId so the capture keeps the call's INPUT (the end event
  // carries result+isError but not args). Bounded: entries removed on end.
  const pendingArgs = new Map<string, unknown>();
  pi.on('tool_execution_start', async (...args: unknown[]): Promise<unknown> => {
    const e = (args[0] as ToolExecutionStartEvent) || {};
    if (e.toolCallId) pendingArgs.set(e.toolCallId, e.args);
    return undefined;
  });

  // Tier-B capture (D-iv) — fires AFTER the tool runs, with the result + pi's authoritative
  // isError flag. Feed classifyToolOutcome the isError signal so a real failed call records
  // as capture:error → the distiller turns it into a candidate gotcha (live auto-distill).
  pi.on('tool_execution_end', async (...args: unknown[]): Promise<unknown> => {
    const e = (args[0] as ToolExecutionEndEvent) || {};
    if (!e.toolName) return undefined;
    const input = e.toolCallId ? pendingArgs.get(e.toolCallId) : undefined;
    if (e.toolCallId) pendingArgs.delete(e.toolCallId);
    const summary = resultText(e.result);
    const tool_result = e.isError ? { isError: true, error: summary } : { isError: false, result: summary };
    captureToolCall({ tool_name: e.toolName, tool_input: input, tool_result, call_id: e.toolCallId });
    return undefined;
  });

  // Persist + commit the brain at session end.
  pi.on('session_shutdown', async () => {
    session.save();
    try {
      save('vfkb: session changes', 'agent');
    } catch {
      /* non-git brain or git unavailable → skip */
    }
  });
}
