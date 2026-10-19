#!/usr/bin/env node
// usage: extract.mjs <run>.stream.jsonl [sentinel]
// Pulls the load-bearing evidence out of a real-plugin stream: which SessionStart
// hook responses carried the sentinel (emission), whether the compaction summary
// carried it (the luck channel), and what the agent answered (receipt).
import { readFileSync } from 'node:fs';
const [file, sentinel = 'KUMQUAT-8812'] = process.argv.slice(2);
for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
  let j;
  try { j = JSON.parse(line); } catch { continue; }
  const has = JSON.stringify(j).includes(sentinel) ? '[carries sentinel]' : '';
  if (j.type === 'system' && /hook_response|compact_boundary/.test(j.subtype ?? '')) {
    console.log('  system', j.subtype, j.hook_name || j.hook_event_name || '', has);
  } else if (j.type === 'user' && has) {
    console.log('  user message carries sentinel (the compaction summary)');
  } else if (j.type === 'result') {
    console.log('  result', JSON.stringify(j.result));
  }
}
