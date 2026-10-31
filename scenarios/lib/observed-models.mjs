// Observed-not-asserted model pin for TUI scenarios (vfkb#395, decide Q2; ADR-0050).
// The interactive TUI has no stream-json `result` event, so `modelUsage` does not exist on
// that surface; the sandbox transcript's `assistant.message.model` is the observable, and it
// carries the same full id string. Pure: input is raw transcript lines. Unit-tested in
// test/observed-models.test.ts.

/** Harness-synthesised placeholders (API errors) carry this model; they are not a real reply. */
export const SYNTHETIC_MODEL = '<synthetic>';

/**
 * @param {string[]} lines raw transcript JSONL lines
 * @param {string} pinned the full pinned model id (never an alias)
 * @returns {{ models: string[], synthetic: number, invalidReasons: string[] }}
 *   models: distinct real `message.model` values in first-seen order; synthetic: the count of
 *   `<synthetic>` lines; invalidReasons: empty iff the set is exactly { pinned }.
 */
export function observedModels(lines, pinned) {
  const models = [];
  let synthetic = 0;
  for (const l of lines || []) {
    let j;
    try { j = JSON.parse(l); } catch { continue; }
    if (j?.type !== 'assistant') continue;
    const m = j.message?.model;
    if (typeof m !== 'string' || !m) continue;
    if (m === SYNTHETIC_MODEL) { synthetic++; continue; }
    if (!models.includes(m)) models.push(m);
  }
  const invalidReasons = [];
  if (models.length === 0) invalidReasons.push('no real assistant message (observed model unknown)');
  else if (models.length !== 1 || models[0] !== pinned) {
    invalidReasons.push(`observed ${JSON.stringify(models)} ≠ pinned ${pinned}`);
  }
  return { models, synthetic, invalidReasons };
}
