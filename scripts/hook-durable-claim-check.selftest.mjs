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

function run(payload) {
  return execFileSync('node', [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
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
  ['gh release create', bash('gh release create v1.0.0'), true],
  ['write an ADR', write('/home/x/repo/docs/adr/ADR-0099-thing.md'), true],
  ['write an RFC', write('docs/rfc/RFC-099-thing.md'), true],
  ['write a review record', write('reviews/abc1234.json'), true],
  ['write CLAUDE.md', write('/home/x/repo/CLAUDE.md'), true],

  // Ordinary work must stay silent, or the Brake becomes noise and gets ignored.
  ['plain git status', bash('git status --porcelain'), false],
  ['gh pr view (read-only)', bash('gh pr view 12 --json state'), false],
  ['gh pr checks (read-only)', bash('gh pr checks 12'), false],
  ['gh issue list (read-only)', bash('gh issue list'), false],
  ['a source edit', write('/home/x/repo/src/engine.ts'), false],
  ['a test edit', write('test/engine.test.ts'), false],
  ['a scratchpad note', write('/tmp/scratch/notes.md'), false],
  ['git commit', bash('git commit -m "chore: x"'), false],
];

let failed = 0;
for (const [label, payload, mustSpeak] of CASES) {
  const out = run(payload);
  const spoke = out.trim().length > 0;
  if (spoke !== mustSpeak) {
    console.error(`FAIL  ${label}: expected ${mustSpeak ? 'a reminder' : 'silence'}, got ${spoke ? 'a reminder' : 'silence'}`);
    failed++;
  } else {
    console.log(`ok    ${label} -> ${spoke ? 'reminder' : 'silent'}`);
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
