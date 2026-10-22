#!/usr/bin/env node
// Jev re-spike corpus builder. THROWAWAY — pre-registration: README.md in this directory.
// Usage: node build-corpus.mjs <outDir> <projectsGlobRoot>... [--exclude sid,..]
// Reads Claude Code transcripts from every <root>/<project>/*.jsonl, writes to <outDir>
// (never committed — it holds transcript text):
//   rows.jsonl      one scored turn per line: window, structural label, rule scores, split
//   sessions.jsonl  one session per line: its tail and the next session's opening, for labellers
// Prints counts only.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const exIdx = args.indexOf('--exclude');
const ex = exIdx >= 0 ? args[exIdx + 1].split(',') : [];
const pos = args.filter((a, i) => !a.startsWith('--') && i !== exIdx + 1);
const [outDir, ...roots] = pos;
if (!outDir || !roots.length) {
  console.error('usage: build-corpus.mjs <outDir> <projectsRoot>... [--exclude sid,..]');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const { detectSecrets } = await import(join(resolve(here, '../../../../..'), 'dist/secrets.js'));
mkdirSync(outDir, { recursive: true });

const SKIP = ['Stop hook feedback', '[Request interrupted', '<local-command', '<command-', 'Caveat:',
  '<task-notification', '<system-reminder', 'This session is being continued', '[Your previous response'];
const LIVE_MS = 2 * 3600e3; // a transcript touched in the last 2 h may still be running
const now = Date.now();

function parseSession(file) {
  const turns = [];
  let cur = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    if (e.type === 'user' && !e.isMeta && !e.toolUseResult) {
      const c = e.message?.content;
      if (Array.isArray(c) && c.some((x) => x?.type === 'tool_result')) continue;
      const txt = typeof c === 'string' ? c : (c || []).filter((x) => x?.type === 'text').map((x) => x.text).join(' ');
      const st = txt.trimStart();
      if (!st || SKIP.some((p) => st.startsWith(p))) continue;
      cur = { src: e.promptSource ?? null, ts: e.timestamp, prompt: txt, final: '', tools: 0 };
      turns.push(cur);
    } else if (e.type === 'assistant' && cur) {
      for (const b of e.message?.content || []) {
        if (b.type === 'text' && b.text?.trim()) cur.final = b.text;
        else if (b.type === 'tool_use') cur.tools++;
      }
    }
  }
  return turns;
}

const KW = /wrap(\s|-)?up|that'?s all|hand\s?off|commit and push|i will exit|new session|we('| a)re done/i;
const CW = /\b(done|complete[d]?|merged|pushed|all set|finished|landed|shipped)\b/i;
const SCORED = new Set(['typed', 'queued']);
const split = (sid) => (createHash('sha256').update('jev-respike-2026-10-22:' + sid).digest()[0] < 102 ? 'dev' : 'test');

const sessions = [];
const counts = { files: 0, live: 0, excluded: 0, sdk: 0, short: 0, kept: 0, rows: 0, secretRows: 0, secretSessions: 0 };
for (const root of roots) {
  for (const proj of readdirSync(root)) {
    const pdir = join(root, proj);
    let entries;
    try { entries = readdirSync(pdir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of entries) {
      counts.files++;
      const file = join(pdir, f);
      const sid = f.replace(/\.jsonl$/, '');
      if (ex.some((p) => sid.startsWith(p))) { counts.excluded++; continue; }
      if (now - statSync(file).mtimeMs < LIVE_MS) { counts.live++; continue; }
      const turns = parseSession(file);
      if (turns.some((t) => t.src === 'sdk')) { counts.sdk++; continue; }
      const scored = turns.map((t, k) => k).filter((k) => SCORED.has(turns[k].src));
      if (scored.length < 2) { counts.short++; continue; }
      sessions.push({ sid, proj, root, turns, scored, start: turns[0].ts, end: turns.at(-1).ts });
    }
  }
}

const R = [];
const S = [];
for (const s of sessions) {
  counts.kept++;
  const sp = split(s.sid);
  for (const [j, k] of s.scored.entries()) {
    const t = s.turns[k];
    const label = s.turns.slice(k + 1).some((u) => u.tools > 0) ? 0 : 1;
    const prompts = s.scored.slice(Math.max(0, j - 2), j + 1).map((m) => s.turns[m].prompt.slice(0, 600));
    const finalTail = (t.final || '').slice(-1000);
    const long = {
      prompts: s.scored.slice(Math.max(0, j - 4), j + 1).map((m) => s.turns[m].prompt.slice(0, 1000)),
      finalTail: (t.final || '').slice(-2000),
    };
    const text = [...long.prompts, long.finalTail].join('\n');
    if (detectSecrets(text).length) { counts.secretRows++; continue; }
    const q = finalTail.trimEnd().endsWith('?');
    R.push({
      sid: s.sid, proj: s.proj, k, j, split: sp, label,
      b1: KW.test(prompts.at(-1)) && !q ? 1 : 0,
      b2: CW.test(finalTail) && !q ? 1 : 0,
      state: { recent_user_messages: prompts, assistant_final_message_tail: finalTail },
      stateLong: { recent_user_messages: long.prompts, assistant_final_message_tail: long.finalTail },
    });
  }
  // labeller view: the last 6 scored turns, and the opening of the next session in the same
  // project that starts within 2 h of this one's end (restart detection)
  const tail = s.scored.slice(-6).map((m) => ({
    prompt: s.turns[m].prompt.slice(0, 600),
    final: (s.turns[m].final || '').slice(-800),
    tools: s.turns[m].tools,
  }));
  const endMs = Date.parse(s.end);
  const next = sessions
    .filter((o) => o.proj === s.proj && o.sid !== s.sid && Date.parse(o.start) >= endMs && Date.parse(o.start) - endMs < 2 * 3600e3)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
  const nextOpen = next ? { minutesLater: Math.round((Date.parse(next.start) - endMs) / 60e3), prompt: next.turns[0].prompt.slice(0, 600) } : null;
  if (detectSecrets(JSON.stringify({ tail, nextOpen })).length) { counts.secretSessions++; continue; }
  S.push({ sid: s.sid, proj: s.proj, split: sp, tail, nextOpen });
}
counts.rows = R.length;
writeFileSync(join(outDir, 'rows.jsonl'), R.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(join(outDir, 'sessions.jsonl'), S.map((r) => JSON.stringify(r)).join('\n') + '\n');
const by = (f) => R.reduce((a, r) => ((a[f(r)] = (a[f(r)] || 0) + 1), a), {});
console.log(JSON.stringify({ ...counts, sessionsForLabelling: S.length, projects: new Set(R.map((r) => r.proj)).size, bySplitLabel: by((r) => `${r.split}:${r.label}`) }, null, 1));
