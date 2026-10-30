#!/usr/bin/env node
// UserPromptSubmit marker hook (vfkb#408 probe).
//   node ups-hook.mjs <mode> <markDir> <smMarker> <acMarker>
// mode: sm      -> {"systemMessage": smMarker}
//       sm+ac   -> systemMessage AND hookSpecificOutput.additionalContext (acMarker)
//       ac      -> additionalContext only (the contrast: should NOT render to the user)
// CONTROL: before printing, it writes <markDir>/fired-<n>.json (the payload + what it
// emitted). A trial with no side file is VOID: the hook never ran, so absence of the
// marker on screen would prove nothing.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [mode, dir, sm, ac] = process.argv.slice(2);
let payload = '';
process.stdin.on('data', (d) => (payload += d));
process.stdin.on('end', () => {
  const out = {};
  if (mode === 'sm' || mode === 'sm+ac') out.systemMessage = sm;
  if (mode === 'ac' || mode === 'sm+ac') out.hookSpecificOutput = { hookEventName: 'UserPromptSubmit', additionalContext: ac };
  mkdirSync(dir, { recursive: true });
  const n = readdirSync(dir).filter((f) => f.startsWith('fired-')).length + 1;
  let p = {};
  try { p = JSON.parse(payload); } catch {}
  writeFileSync(join(dir, `fired-${n}.json`), JSON.stringify({ mode, at: new Date().toISOString(), hook_event_name: p.hook_event_name, prompt: p.prompt, emitted: out }, null, 2));
  process.stdout.write(JSON.stringify(out));
});
