// Minimal Pi extension types. The real types come from
// @mariozechner/pi-coding-agent at runtime; these stubs are copied from the
// VERIFIED mykb spike contract (src/extension/pi-types.ts + hooks/*), NOT
// re-derived — mykb L7: hand-written Pi stubs were wrong and silently dropped
// injection for weeks. Only the surface vtfkb's Phase-0 face uses is included.

export interface ExtensionAPI {
  on(event: string, handler: (...args: unknown[]) => Promise<unknown>): void;
}

// `before_agent_start` event + result (the session-start injection channel).
// Handler receives { systemPrompt } and MUST APPEND, not replace.
export interface BeforeAgentStartEvent {
  systemPrompt?: string;
  prompt?: string;
}
export interface BeforeAgentStartResult {
  systemPrompt?: string;
}

// `context` per-turn event (Tier C, Pi-only per ADR-0015). To inject, return
// { messages: [{role:'custom', content}, ...messages] }. `custom` is the only
// role Pi converts to LLM-visible user text; `system` is filtered out.
export interface PiMessage {
  role: string;
  content: string;
}
export interface ContextEvent {
  type: 'context';
  messages: PiMessage[];
}
export interface ContextEventResult {
  messages?: PiMessage[];
}

// Capture events (Tier B).
export interface ToolCallEvent {
  toolName?: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
}
