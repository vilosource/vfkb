// Pure verdict library for scenarios/ups-warning-tui.mjs (vfkb#395, ADR-0085 §8).
// Every predicate is a CONTENT assertion over captured output (ADR-0051 clause 3):
// the rendered TUI buffer with scrollback, the same buffer with line breaks removed,
// and the ANSI-stripped raw pty log up to /exit (rawBeforeExit). Exit codes are never read. Unit-tested in
// test/ups-warning-verdict.test.ts, where each predicate is observed failing.

/** The warning's stable lead-in (src/session-end.ts NO_AUTOCOMMIT_LEADIN). */
export const WARNING_LEADIN = 'vfkb will not auto-commit';
/** The ADR-0084 line lead-in: the per-session control that the plugin's UPS hook ran. */
export const LINE_LEADIN = 'vfkb handoff status:';

/**
 * expect: 'present' → the warning must be on screen; 'absent' → it must not.
 * The RED baseline runs treatment-main against the pre-#395 plugin, expecting 'absent'.
 */
export const ARMS = Object.freeze({
  'treatment-main': { expect: 'present', branch: 'main', dirty: true },
  'contrast-topic': { expect: 'absent', branch: 'feat/work', dirty: true },
  'contrast-clean': { expect: 'absent', branch: 'main', dirty: false },
});

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78DEHMc]/g;
export const stripAnsi = (s) => String(s ?? '').replace(ANSI, '');
const joined = (s) => String(s ?? '').replace(/\s*\n/g, '');

/**
 * The raw pty log as it stood BEFORE /exit: its first `preExitBytes` bytes. SessionEnd runs
 * after /exit and its systemMessage carries the same lead-in (decide D5), so a log read past
 * this mark could pass treatment-main on the exit message with no UserPromptSubmit
 * systemMessage on screen. No mark (the TUI never reached the prompt) → nothing.
 */
export function rawBeforeExit(raw, preExitBytes) {
  if (!Number.isInteger(preExitBytes) || preExitBytes <= 0) return '';
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw ?? ''), 'utf8');
  return buf.subarray(0, preExitBytes).toString('utf8');
}

/** Where the lead-in was seen: any of screen, screenJoined, raw (the pre-/exit log only). */
export function warningChannels({ screen = '', raw = '' } = {}) {
  const hits = [];
  if (screen.includes(WARNING_LEADIN)) hits.push('screen');
  if (joined(screen).includes(WARNING_LEADIN)) hits.push('screenJoined');
  if (stripAnsi(raw).includes(WARNING_LEADIN)) hits.push('raw');
  return hits;
}

/** How many times the lead-in appears in the rendered buffer (diagnostic, never a predicate). */
export function screenCount(screen = '') {
  return String(screen).split(WARNING_LEADIN).length - 1;
}

/**
 * The observed plugin-hook label: the text on the lead-in's line before it, trimmed
 * (the #408 probe saw `UserPromptSubmit says:` for a settings hook). Diagnostic.
 */
export function observedLabel(screen = '') {
  for (const line of String(screen).split('\n')) {
    const i = line.indexOf(WARNING_LEADIN);
    if (i >= 0) return line.slice(0, i).replace(/^[\s─-╿⎿│|>*\-]+/, '').trim() || null;
  }
  return null;
}

/** VOID reasons, in order; null when the trial is valid. */
export function voidReason(o) {
  if (!o.pluginInstalled) return 'plugin not in the sandbox installed_plugins.json';
  if (!o.reachedPrompt) return 'TUI never reached the input prompt';
  if (!(o.replies >= o.prompts)) return `turns incomplete (${o.replies ?? 0}/${o.prompts} replies)`;
  if (!o.hookControl) return 'control: no UserPromptSubmit additionalContext with the line lead-in in the transcript';
  return null;
}

/** One trial's pass/fail against the arm's expectation (null when VOID). */
export function trialPass(expect, o) {
  if (voidReason(o)) return null;
  const seen = warningChannels(o).length > 0;
  if (expect === 'present') return seen && !o.relayedByModel;
  return !seen;
}

/** ADR-0022: an arm is DEMONSTRATED at >= 2/3 of its valid trials, with `trials` valid. */
export function armVerdict(results, trials = 3) {
  const valid = results.filter((r) => r !== null);
  const hits = valid.filter(Boolean).length;
  if (valid.length < trials) return { valid: valid.length, hits, verdict: 'INCOMPLETE' };
  return { valid: valid.length, hits, verdict: hits * 3 >= valid.length * 2 ? 'DEMONSTRATED' : 'NOT-DEMONSTRATED' };
}

/** The run: DEMONSTRATED iff every arm run is DEMONSTRATED. */
export function runVerdict(arms) {
  const vs = Object.values(arms).map((a) => a.verdict);
  if (vs.length === 0) return 'INCOMPLETE';
  if (vs.includes('INCOMPLETE')) return 'INCOMPLETE';
  return vs.every((v) => v === 'DEMONSTRATED') ? 'DEMONSTRATED' : 'NOT-DEMONSTRATED';
}
