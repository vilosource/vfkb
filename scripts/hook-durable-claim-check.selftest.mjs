#!/usr/bin/env node
// ============================================================================
// Selftest for the durable-claim Brake.
//
// "A Brake nobody has watched fail is a Brake nobody knows is connected"
// (scripts/review-gate.yml's own words). This drives the hook with real
// payloads and asserts BOTH directions:
//
//   - it SPEAKS on durable-artifact writes (the case that failed: gh issue create)
//   - it stays SILENT on ordinary work (a hook that always speaks gets read past)
//   - it fails OPEN on garbage input (repo protocol: hooks never block)
//
//   node scripts/hook-durable-claim-check.selftest.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'hook-durable-claim-check.mjs');

// The harness sets CLAUDE_PROJECT_DIR, and the hook anchors its path patterns
// to it — so the test must run the PRODUCTION configuration, not an ambient one.
// Without a root, `src/reviews/helper.ts` is indistinguishable from a root-level
// `reviews/` record by tail-matching alone (see relativize()'s fallback).
const FAKE_ROOT = '/home/x/repo';

function run(payload, env = {}) {
  return execFileSync('node', [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: FAKE_ROOT, ...env },
  });
}

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } });

// [label, payload, mustSpeak]
const CASES = [
  // The exact command that published the wrong claim in issue #212.
  ['gh issue create', bash('gh issue create --title "x" --body "y"'), true],
  ['gh issue comment', bash('cd ~/VFKB/vfkb && gh issue comment 212 --body "z"'), true],
  ['gh pr create', bash('gh pr create --title "t" --body "b"'), true],
  ['gh pr comment', bash('gh pr comment 4 --body "b"'), true],
  // NOTE: a bare `gh release create v1.0.0` carries no authored notes, so it
  // publishes no claim and must stay silent — it lives in the silent block below.
  ['write an ADR', write('/home/x/repo/docs/adr/ADR-0099-thing.md'), true],
  ['write an RFC', write('docs/rfc/RFC-099-thing.md'), true],
  ['write a review record', write('reviews/abc1234.json'), true],
  ['write CLAUDE.md', write('/home/x/repo/CLAUDE.md'), true],

  // Body-bearing edits DO publish prose, so they must speak.
  ['gh pr review with a body', bash('gh pr review 4 --body "looks wrong because X"'), true],
  ['gh pr edit with a body', bash('gh pr edit 4 --body "new description"'), true],
  ['gh release create with notes', bash('gh release create v1.0.0 --notes "shipped X"'), true],

  // Ordinary work must stay silent, or the Brake becomes noise and gets ignored.
  // These are review finding MAJOR 3: label/approve calls publish no claim.
  ['gh release create with no notes', bash('gh release create v1.0.0'), false],
  ['gh pr review --approve (no body)', bash('gh pr review 4 --approve'), false],
  ['gh pr edit --add-label', bash('gh pr edit 12 --add-label bug'), false],
  ['gh issue edit --add-label', bash('gh issue edit 3 --add-label wontfix'), false],
  ['command discussed in a quoted string', bash('echo "run gh issue create later"'), false],
  ['command in a comment', bash('ls  # gh issue create'), false],
  ['grep for the command', bash('grep -rn "gh pr create" docs/'), false],
  ['nested reviews dir in src', write('/home/x/repo/src/reviews/helper.ts'), false],
  ['vendored adr', write('/home/x/repo/node_modules/foo/docs/adr/y.md'), false],
  ['vendored CLAUDE.md', write('/home/x/repo/vendor/CLAUDE.md'), false],
  ['plain git status', bash('git status --porcelain'), false],
  ['gh pr view (read-only)', bash('gh pr view 12 --json state'), false],
  ['gh pr checks (read-only)', bash('gh pr checks 12'), false],
  ['gh issue list (read-only)', bash('gh issue list'), false],
  ['a source edit', write('/home/x/repo/src/engine.ts'), false],
  ['a test edit', write('test/engine.test.ts'), false],
  ['a scratchpad note', write('/tmp/scratch/notes.md'), false],
  ['git commit', bash('git commit -m "chore: x"'), false],
];

// "Did it write bytes?" is NOT the property that matters — bare stdout does not
// reach the agent, so a hook printing prose is inert while looking healthy. The
// first cut of this hook did exactly that and passed three mutations before the
// ADR-0052 review caught it. Speaking therefore means: emits parseable JSON in
// the harness's PreToolUse shape, carrying non-empty additionalContext.
function spoke(out) {
  const t = out.trim();
  if (!t) return false;
  let o;
  try {
    o = JSON.parse(t);
  } catch {
    throw new Error(`hook wrote non-JSON output (inert — bare stdout never reaches the agent): ${t.slice(0, 80)}`);
  }
  const h = o.hookSpecificOutput;
  if (!h) throw new Error('output JSON has no hookSpecificOutput — the harness will ignore it');
  if (h.hookEventName !== 'PreToolUse') throw new Error(`hookEventName is ${JSON.stringify(h.hookEventName)}, expected "PreToolUse"`);
  if (typeof h.additionalContext !== 'string' || !h.additionalContext.trim()) {
    throw new Error('additionalContext missing or empty — nothing would reach the agent');
  }
  return true;
}

let failed = 0;
for (const [label, payload, mustSpeak] of CASES) {
  const out = run(payload);
  let spokeNow;
  try {
    spokeNow = spoke(out);
  } catch (err) {
    console.error(`FAIL  ${label}: ${err.message}`);
    failed++;
    continue;
  }
  if (spokeNow !== mustSpeak) {
    console.error(`FAIL  ${label}: expected ${mustSpeak ? 'a reminder' : 'silence'}, got ${spokeNow ? 'a reminder' : 'silence'}`);
    failed++;
  } else {
    console.log(`ok    ${label} -> ${spokeNow ? 'reminder' : 'silent'}`);
  }
}

// Fails open: malformed input must not throw and must not block.
for (const [label, bad] of [
  ['malformed json', '{not json'],
  ['empty stdin', ''],
  ['null tool_input', JSON.stringify({ tool_name: 'Bash', tool_input: null })],
]) {
  try {
    run(bad);
    console.log(`ok    ${label} -> failed open`);
  } catch (err) {
    console.error(`FAIL  ${label}: hook threw (${err.message}) — a hook must never block a tool call`);
    failed++;
  }
}

// The reminder must actually carry the lesson, not just any text: a Brake whose
// message says nothing teaches nothing.
const msg = run(bash('gh issue create --body x'));
for (const needle of ['CALL SITES', 'EVIDENCE, not a conclusion', 'UNVERIFIED', 'a1aea707436c']) {
  if (!msg.includes(needle)) {
    console.error(`FAIL  reminder text is missing "${needle}"`);
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll durable-claim Brake checks passed.');
