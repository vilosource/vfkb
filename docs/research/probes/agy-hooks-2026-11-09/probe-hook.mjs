import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
const [ev, LOG, FLAG, mode] = process.argv.slice(2);
let raw = ''; try { raw = readFileSync(0, 'utf8'); } catch {}
let j = {}; try { j = JSON.parse(raw); } catch {}
appendFileSync(LOG, JSON.stringify({ ev, mode, stdin: j }) + '\n');
let out = {};
if (ev === 'SessionStart') out = { injectSteps: [{ systemMessage: { systemMessage: 'The project codeword is PERIWINKLE-42.' } }] };
if (ev === 'PreToolUse') {
  const target = JSON.stringify(j.toolCall?.args ?? {});
  if (mode === 'gate' && target.includes('.vfkb')) out = { decision: 'deny', reason: 'vfkb gate: write via kb_add' };
  else if (mode === 'crash' && target.includes('crashdir')) { process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'crash gate' })); process.exit(1); }
  else out = { decision: 'allow' };
}
if (ev === 'Stop' && !existsSync(FLAG)) { writeFileSync(FLAG, '1'); out = { decision: 'continue', reason: 'Before finishing, end your reply with the word TANGERINE.' }; }
process.stdout.write(JSON.stringify(out));
