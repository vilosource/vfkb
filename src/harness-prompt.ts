// ADR-0084 §2.6: harness-generated turns. Claude Code fires UserPromptSubmit for some
// prompts the user never typed (a background task's completion, a cross-session message,
// a usage-limit reset). A line meant for the user's own prompt must skip those. Shared,
// git-free and pure, so v3 R1 (ADR-0080 step 2) reuses the same predicate.
//
// The allowlist is DATA in one place. Source: RFC-047 brainstorm E's read-only tally of
// local transcripts (1,353 of 1,377 system-origin turns start with `<task-notification>`,
// the rest with the other two; 0 of 4,461 typed prompts match) — UNVERIFIED by a
// controlled run. The #385 Tier-0 probe
// (docs/research/probes/harness-turns-2026-10-27/README.md) records which kinds it could
// and could not produce; add a lead-in here only from an observed probe record.
//
// Column 0 only: leading whitespace is NOT skipped. Anything unmatched counts as typed —
// fail-open, because a stray line on a harness turn costs no turn.

export const HARNESS_PROMPT_LEADINS = [
  '<task-notification>',
  'Another Claude session sent a message:',
  'Your claude.ai usage limit has reset',
] as const;

export function isHarnessPrompt(prompt: unknown): boolean {
  if (typeof prompt !== 'string' || prompt.length === 0) return false;
  return HARNESS_PROMPT_LEADINS.some((l) => prompt.startsWith(l));
}
