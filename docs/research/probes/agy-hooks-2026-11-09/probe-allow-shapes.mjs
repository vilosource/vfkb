import { appendFileSync, readFileSync } from 'node:fs';
const [ev, LOG, mode] = process.argv.slice(2);
let raw=''; try{raw=readFileSync(0,'utf8')}catch{}; let j={}; try{j=JSON.parse(raw)}catch{}
appendFileSync(LOG, JSON.stringify({ev,mode,tool:j.toolCall?.name,path:j.toolCall?.args?.Path})+'\n');
const p = String(j.toolCall?.args?.Path ?? '');
if (ev==='SessionStart') process.exit(1);
if (p.includes('emptyobj')) process.stdout.write('{}');
else if (p.includes('nostdout')) {}
else process.stdout.write(JSON.stringify({decision:'allow'}));
