#!/usr/bin/env node
// Jev re-spike session-ending labellers. THROWAWAY — pre-registration: README.md here.
// Usage: node label.mjs <corpusDir>
// Two independent AI labellers (different models, same instructions) classify how each
// session ended. Raw outputs are cached under <corpusDir>/labels/ (never committed).
// Writes <corpusDir>/labels.json and prints aggregate agreement only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [dir] = process.argv.slice(2);
if (!dir) { console.error('usage: label.mjs <corpusDir>'); process.exit(2); }
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
const CLASSES = ['natural_close', 'restart', 'context_limit', 'abandoned', 'unclear'];
const SYSTEM = `You classify how a Claude Code session ended. You get the session's last turns (each: the user's prompt, the tail of the assistant's final message, and how many tools the assistant used in that turn) and, if one exists, the opening prompt of the next session in the same project that started within 2 hours of this one ending.

Classify the ending as exactly one of:
- natural_close: the work reached a stopping point. The user said they were finished or wrapping up, asked for a handoff or summary, said thanks or goodbye, or the assistant reported the requested work complete and the user asked for nothing further. A restart AFTER such a stopping point is still natural_close.
- restart: the session was cut off for a technical reason (to reload plugins, settings or credentials, a crash, switching profile) while the work had not reached a stopping point; typically the next session picks the same work straight back up.
- context_limit: the session ended because its context ran out.
- abandoned: the session ended while work was still pending, or with a question to the user left unanswered, and nothing suggests a technical cut-off.
- unclear: the evidence does not support any of the above.

Judge only from what is shown. Return the class and a reason of at most 20 words.`;
const SCHEMA = JSON.stringify({
  type: 'object',
  properties: { ending: { type: 'string', enum: CLASSES }, reason: { type: 'string' } },
  required: ['ending', 'reason'],
});

const sessions = readFileSync(join(dir, 'sessions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const render = (s) => {
  const turns = s.tail.map((t, i) => `--- turn ${i + 1} of the last ${s.tail.length} (tools used: ${t.tools})\nUSER: ${t.prompt}\nASSISTANT (final message tail): ${t.final}`).join('\n\n');
  const next = s.nextOpen ? `\n\n=== next session in the same project, ${s.nextOpen.minutesLater} min later, opens with:\n${s.nextOpen.prompt}` : '\n\n=== no session in the same project started within 2 hours.';
  return `=== last turns of the session\n${turns}${next}`;
};

function call(model, s) {
  const f = join(dir, 'labels', model, `${s.sid}.json`);
  if (existsSync(f)) return Promise.resolve(JSON.parse(readFileSync(f, 'utf8')));
  return new Promise((ok, fail) => {
    const p = execFile('claude', ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--setting-sources', '',
      '--no-session-persistence', '--output-format', 'json', '--system-prompt', SYSTEM, '--json-schema', SCHEMA],
    { cwd: tmpdir(), maxBuffer: 1 << 24, timeout: 300e3 }, (err, out) => {
      if (err) return fail(err);
      const d = JSON.parse(out);
      const used = Object.keys(d.modelUsage || {});
      if (d.is_error || !d.structured_output || !used.some((m) => m.startsWith(model))) return fail(new Error(`${model} ${s.sid}: bad result (models ${used})`));
      const r = { ending: d.structured_output.ending, reason: d.structured_output.reason, models: used };
      writeFileSync(f, JSON.stringify(r));
      ok(r);
    });
    p.stdin.end(render(s));
  });
}

for (const m of MODELS) mkdirSync(join(dir, 'labels', m), { recursive: true });
const jobs = sessions.flatMap((s) => MODELS.map((m) => [m, s]));
const out = {};
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const [m, s] = jobs[next++];
    for (let a = 0; ; a++) {
      try { (out[s.sid] ??= {})[m] = (await call(m, s)).ending; break; } catch (e) { if (a >= 2) throw e; }
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
writeFileSync(join(dir, 'labels.json'), JSON.stringify(out));

// Cohen's kappa on the binary natural_close / not
const pairs = Object.values(out).map((v) => MODELS.map((m) => (v[m] === 'natural_close' ? 1 : 0)));
const n = pairs.length;
const po = pairs.filter(([a, b]) => a === b).length / n;
const pa = pairs.filter(([a]) => a).length / n, pb = pairs.filter(([, b]) => b).length / n;
const pe = pa * pb + (1 - pa) * (1 - pb);
const tally = Object.fromEntries(MODELS.map((m) => [m, CLASSES.reduce((a, c) => ((a[c] = Object.values(out).filter((v) => v[m] === c).length), a), {})]));
console.log(JSON.stringify({ sessions: n, agreeBinary: +po.toFixed(4), kappa: +((po - pe) / (1 - pe)).toFixed(4), bothNatural: pairs.filter(([a, b]) => a && b).length, tally }, null, 1));
