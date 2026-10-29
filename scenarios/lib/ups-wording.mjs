// Pure core of the #411 Tier-0 wording probe
// (docs/research/probes/ups-wording-2026-10-29/README.md, pre-registered at 0af204f).
// Unit-tested in test/ups-wording.test.ts. Kept pure so every transform, VOID path and
// branch of the decision rule is observed firing in a deterministic test (ADR-0070 §2).

/** The e2ac6e9 line exactly as recorded at 467a4c1 (scenarios/records/handoff-next-prompt.json, treatment-stale trial 1). */
export const FIXTURE_E2AC6E9 =
  'vfkb handoff status: the pinned handoff (b14f4ed4150b, 2026-10-29) predates 1 commit on feat/work: e657c56 docs: release checklist. ' +
  'If this prompt ends the session, a fresh handoff/next entry (kb_add type=fact, tags=handoff,next, role=human) naming what changed ' +
  'and what is next is the one thing worth recording before finishing; otherwise nothing is needed now — the next session sees this same list at start.';

export const VARIANTS = ['V0', 'V1', 'V2'];
export const VALID_PER_VARIANT = 5;
export const MAX_ATTEMPTS_PER_VARIANT = 10;
const SEPARATES_AT = 4; // ceil(2·5/3)
const CONTROL_AT_MOST = 3;

/** V1's removal: the #401 tail. */
export const TAIL = ' — the next session sees this same list at start';
// V2's removal: ": <sha7> <subject>[; …][ (+k more)]" after "predates N commit(s) on <where>",
// up to the B1 clause or the end of the fact sentence.
const LIST_RE = /(predates \d+ commits? on [^:;.]+?)(: .+?)(?=; this session has recorded|\. If this prompt ends the session)/g;

const count = (s, sub) => s.split(sub).length - 1;

/** The variant's text, or null on a transform miss (never a silent V0). */
export function transformText(variant, text) {
  if (typeof text !== 'string') return null;
  if (variant === 'V0') return text;
  if (variant === 'V1') return count(text, TAIL) === 1 ? text.replace(TAIL, '') : null;
  if (variant === 'V2') {
    const m = [...text.matchAll(LIST_RE)];
    if (m.length !== 1) return null;
    return text.slice(0, m[0].index) + m[0][1] + text.slice(m[0].index + m[0][0].length);
  }
  return null;
}

/**
 * The hook rewrite contract (decide step: wrapper over the real hook). Input: the engine's
 * stdout. Output: what the hook prints, and whether the transform missed.
 *   empty stdout → nothing; JSON without additionalContext → unchanged;
 *   V0 → byte-identical; a miss → nothing, miss=true (the trial is VOID).
 */
export function applyVariant(variant, stdout) {
  const s = String(stdout ?? '');
  if (!s.trim()) return { out: '', miss: false };
  if (variant === 'V0') return { out: s, miss: false };
  let o;
  try { o = JSON.parse(s); } catch { return s.includes('vfkb handoff status:') ? { out: '', miss: true } : { out: s, miss: false }; }
  const ctx = o?.hookSpecificOutput?.additionalContext;
  if (typeof ctx !== 'string') return { out: s, miss: false };
  const t = transformText(variant, ctx);
  if (t === null) return { out: '', miss: true };
  o.hookSpecificOutput.additionalContext = t;
  return { out: JSON.stringify(o), miss: false };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const V0_RE = new RegExp(
  '^' + esc('vfkb handoff status: the pinned handoff (') + '[0-9a-f]{12}, \\d{4}-\\d{2}-\\d{2}' +
    esc(') predates 1 commit on feat/work: ') + '[0-9a-f]{7}' +
    esc(FIXTURE_E2AC6E9.slice(FIXTURE_E2AC6E9.indexOf(' docs: release checklist.'))) + '$',
);
/** The raw engine line has the e2ac6e9 shape on this fixture (INVALID rule 6). */
export const isV0Shape = (line) => typeof line === 'string' && V0_RE.test(line);

/** Run-level precondition (README): [] when the variants are well-defined on the fixture. */
export function preconditions(fixture = FIXTURE_E2AC6E9) {
  const out = [];
  if (count(fixture, TAIL) !== 1) out.push(`tail found ${count(fixture, TAIL)}× (want 1)`);
  const lists = [...fixture.matchAll(LIST_RE)].length;
  if (lists !== 1) out.push(`inline list found ${lists}× (want 1)`);
  const texts = VARIANTS.map((v) => transformText(v, fixture));
  if (texts.some((t) => t === null)) out.push('a transform missed on the fixture');
  else if (new Set(texts).size !== texts.length) out.push('variants are not pairwise distinct');
  return out;
}

/**
 * The pre-registered decision rule. counts: { V0|V1|V2: { valid, pass } } over the first 5
 * valid trials each. → { outcome, reasons }
 */
export function probeVerdict(counts) {
  const p = (v) => counts[v]?.pass ?? 0;
  const line = VARIANTS.map((v) => `${v} ${p(v)}/${counts[v]?.valid ?? 0}`).join(', ');
  const short = VARIANTS.filter((v) => (counts[v]?.valid ?? 0) < VALID_PER_VARIANT);
  if (short.length) return { outcome: 'VOID', reasons: [`${short.join(',')} short of ${VALID_PER_VARIANT} valid; rule not evaluated (${line})`] };
  const sep = (v) => p(v) >= SEPARATES_AT && p('V0') <= CONTROL_AT_MOST;
  if (sep('V1')) return { outcome: 'ADOPT-V1', reasons: [`V1 separates (${line})${sep('V2') ? '; V2 also separates, V1 wins (decide)' : ''}`] };
  if (sep('V2')) return { outcome: 'ADOPT-V2', reasons: [`only V2 separates (${line})`] };
  const ahead = ['V1', 'V2'].filter((v) => p(v) - p('V0') >= 2);
  if (ahead.length) {
    return {
      outcome: 'SIGNAL-WITHOUT-CLEARANCE',
      reasons: ahead.map((v) => `${v} ${p(v)}/5 < ${SEPARATES_AT} (not adoptable); V0 ${p('V0')}/5; delta ${p(v) - p('V0')} > 1 (wording effect observed)`),
    };
  }
  return { outcome: 'NEITHER', reasons: [`no variant separates and none beats V0 by 2+ (${line})`] };
}

/**
 * Fixed round-robin V0 → V1 → V2, skipping a variant at 5 valid; null = stop (all at 5, or
 * any variant at the attempt cap short of 5 valid). st: { V: { attempts, valid } }
 */
export function nextVariant(st, last) {
  if (VARIANTS.some((v) => st[v].attempts >= MAX_ATTEMPTS_PER_VARIANT && st[v].valid < VALID_PER_VARIANT)) return null;
  const start = last === null ? 0 : (VARIANTS.indexOf(last) + 1) % VARIANTS.length;
  for (let i = 0; i < VARIANTS.length; i++) {
    const v = VARIANTS[(start + i) % VARIANTS.length];
    if (st[v].valid < VALID_PER_VARIANT) return v;
  }
  return null;
}
