#!/usr/bin/env node
// ============================================================================
// PreToolUse Brake: verification is gated on ARTIFACT DURABILITY, not severity
// ----------------------------------------------------------------------------
// Brain gotcha a1aea707436c records the observed failure (2026-07-18). An
// adversarial review returned a MINOR finding containing one uncited sentence
// ("writeManifest() re-stamps on the next engine write") that was FALSE. It was
// relayed into vfkb issue #212 and amplified there into a fix proposal for a
// code path that does not exist. Ground truth was ~5 seconds away:
//
//   grep -rn "writeManifest" src/   ->   TWO callers, and the broadcast one is
//                                        guarded by if(!existsSync(manifestPath))
//
// The merge-evidence bar had been applied rigorously that same session (nine
// sweep diffs re-verified by hand); it lapsed only for a finding being captured
// in passing, because the MINOR label was mistaken for a lower evidence bar and
// because filing the issue FELT like diligence.
//
// A prose rule with no Brake gets skipped — this repo's founding lesson, and the
// same reasoning as scripts/review-gate.mjs. This is the Brake for that rule.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT
//   It proves nothing. It cannot read the claim, and it cannot know whether the
//   call sites were checked. It is a NUDGE, fired at the one moment that
//   matters: the instant a claim stops being conversational and becomes an
//   artifact someone else will act on. Mirroring review-gate.mjs's honesty —
//   the observed failure was OMISSION under momentum, not forgery, so the goal
//   is to make the omission non-silent rather than impossible.
//
//   Deliberately SILENT on everything else. A hook that speaks on every call is
//   a hook that gets read past; this one fires only on durable-artifact writes.
//
// Wired as a PreToolUse hook in .claude/settings.json. Fails OPEN by design
// (repo protocol: hooks fail open) — any error here must never block a tool call.
// ============================================================================

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    emit(JSON.parse(raw || '{}'));
  } catch {
    // Fail open, silently: a malformed payload must not block the tool call.
  }
  process.exit(0);
});

// Commands that publish a claim somewhere durable — an artifact another
// engineer (or a future session) will act on without seeing the reasoning.
//
// `create`/`comment` always carry authored prose. `edit`/`review` do NOT: an
// `--add-label` or a bare `--approve` publishes no claim, and firing on those
// is the desensitisation this hook exists to avoid (review finding MAJOR 3), so
// they qualify only when they carry a body.
const BODY_FLAG = /(^|\s)(--body|--body-file|-b|-F|--notes|--notes-file)(\s|=)/;
const DURABLE_ALWAYS = [
  /\bgh\s+issue\s+create\b/,
  /\bgh\s+issue\s+comment\b/,
  /\bgh\s+pr\s+create\b/,
  /\bgh\s+pr\s+comment\b/,
];
const DURABLE_IF_BODY = [
  /\bgh\s+issue\s+edit\b/,
  /\bgh\s+pr\s+(edit|review)\b/,
  /\bgh\s+release\s+(create|edit)\b/,
];

// Paths whose whole purpose is to be a durable record. Matched against the
// path RELATIVE to the project root and anchored, so `src/reviews/helper.ts`
// and `node_modules/x/docs/adr/y.md` do not qualify (review finding MAJOR 3).
const DURABLE_PATH = [/^docs\/(adr|rfc)\//i, /^reviews\//i, /^CLAUDE\.md$/i];

// Vendored trees are never this repo's durable record, even at a matching path.
const VENDORED = /(^|\/)(node_modules|vendor|dist|build|\.git)\//i;

// A command mentioning `gh issue create` inside a quoted string, a comment, or
// a grep pattern is talking ABOUT the command, not running it. Strip those
// spans before matching so discussion does not trip the Brake.
function stripNonExecutable(cmd) {
  return cmd
    .replace(/'[^']*'/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    .replace(/(^|\s)#.*$/gm, ' ');
}

// Resolve to a project-root-relative path when we can, so the anchored patterns
// above mean what they say. CLAUDE_PROJECT_DIR is set by the harness; without
// it, fall back to matching any trailing segment (looser, but never silent).
function relativize(p) {
  const root = process.env.CLAUDE_PROJECT_DIR;
  if (root && p.startsWith(root)) return p.slice(root.length).replace(/^\/+/, '');
  if (!p.startsWith('/')) return p.replace(/^\.\//, '');
  // Absolute path outside (or without) a known root: test the tail segments so
  // an artifact still registers, at the cost of some imprecision.
  const m = p.match(/(?:^|\/)((?:docs\/(?:adr|rfc)|reviews)\/.*|CLAUDE\.md)$/i);
  return m ? m[1] : p;
}

const REMINDER = [
  'DURABLE ARTIFACT — verification is gated on durability, not severity (brain a1aea707436c).',
  'You are about to publish a claim someone will act on without seeing your reasoning.',
  'Before it lands, for EVERY load-bearing claim in it:',
  '  1. CAUSAL claims ("X happened because Y", "Z runs when W") are claims about CALL SITES —',
  '     enumerate them (grep the symbol). A definition-site + a consumption-site citation',
  '     never establishes causation; that exact gap produced issue #212.',
  '  2. A claim RELAYED from a subagent/tool/README is EVIDENCE, not a conclusion. Read the',
  '     ground truth yourself. In an otherwise well-cited report, the UNCITED sentence is the',
  '     one to check — that asymmetry is the tell.',
  '  3. Anything you did NOT verify must be labelled UNVERIFIED in the artifact itself,',
  '     naming the source. An honest gap beats a confident error (CLAUDE.md: VERIFIED = observed).',
  'A MINOR/non-blocking label governs whether it blocks a merge — never whether it needs evidence.',
].join('\n');

function emit(payload) {
  const tool = payload.tool_name ?? payload.toolName ?? '';
  const input = payload.tool_input ?? payload.toolInput ?? {};
  let hit = false;

  if (tool === 'Bash') {
    const cmd = stripNonExecutable(String(input.command ?? ''));
    hit =
      DURABLE_ALWAYS.some((re) => re.test(cmd)) ||
      (DURABLE_IF_BODY.some((re) => re.test(cmd)) && BODY_FLAG.test(cmd));
  } else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const raw = String(input.file_path ?? input.filePath ?? '');
    if (!VENDORED.test(raw)) {
      const rel = relativize(raw);
      hit = DURABLE_PATH.some((re) => re.test(rel));
    }
  }

  // The contract, VERIFIED by direct execution against the live harness and by
  // two in-repo precedents (src/cli.ts:702-710 emits this shape for its own
  // PreToolUse gate; the graphify hook-guard emits it with `additionalContext`
  // and that text demonstrably reaches the agent). Bare stdout does NOT reach
  // the model — the first cut of this hook wrote prose and was INERT, caught by
  // the ADR-0052 review. That is the failure this whole file exists to prevent,
  // committed by the file itself; hence the shape is asserted in the selftest.
  if (hit) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: REMINDER,
        },
      }),
    );
  }
}
