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
const DURABLE_CMD = [
  /\bgh\s+issue\s+(create|comment|edit)\b/,
  /\bgh\s+pr\s+(create|comment|edit|review)\b/,
  /\bgh\s+release\s+(create|edit)\b/,
];

// Paths whose whole purpose is to be a durable record.
const DURABLE_PATH = [
  /(^|\/)docs\/(adr|rfc)\//i,
  /(^|\/)reviews\//i,
  /(^|\/)CLAUDE\.md$/i,
];

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
    const cmd = String(input.command ?? '');
    hit = DURABLE_CMD.some((re) => re.test(cmd));
  } else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const p = String(input.file_path ?? input.filePath ?? '');
    hit = DURABLE_PATH.some((re) => re.test(p));
  }

  if (hit) process.stdout.write(REMINDER + '\n');
}
