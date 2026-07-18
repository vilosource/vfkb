#!/usr/bin/env node
// ============================================================================
// vfkb BRAIN-DURABILITY L4 purpose scenario (ADR-0064 / RFC-034 DoD)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of the durable-capture journal: knowledge captured
// mid-session survives the destructive-git loss window (checkout --/reset
// --hard on the uncommitted tracked brain) and is back in front of the NEXT
// session — same ids, no operator action — via the session-start recovery.
//
// TWO ARMS:
//   - wired arm: real engine writes (journal on, the default) → harness
//     destroys the uncommitted tracked state (`git checkout -- entries.jsonl`,
//     the exact OI/plugin-tree/vilonotes incident shape) → a fresh
//     session-start hook runs → a live agent, given the real injection, must
//     answer with the unguessable sentinel carried ONLY by the destroyed
//     entry. Structural gate on top: the restored line carries the SAME id.
//   - contrast arm (can fail): identical flow with the journal disabled
//     (VFKB_NO_JOURNAL=1, the implementation's kill switch) — the entry must
//     be observably GONE (injection lacks sentinel; agent says UNKNOWN).
//
// CAUSAL DESIGN: the sentinel exists nowhere but the destroyed entry — not in
// git history (the baseline commit predates it), not in the arm cwd. A wired
// hit is attributable ONLY to journal recovery.
//
// RED-FIRST (ADR-0023): against the stock engine the wired arm is 0/N (no
// journal exists; destruction is permanent) — that observed RED is this
// build's evidence gate, preserved in records/brain-durability.red-baseline.json.
//
// VERDICT: DEMONSTRATED iff wired ≥ 2/3 AND wired > contrast (ADR-0022).
// LIVE + metered. One at a time.
//   node scenarios/brain-durability.mjs
//   VFKB_BD_TRIALS=1 node scenarios/brain-durability.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const TRIALS = Math.max(1, parseInt(process.env.VFKB_BD_TRIALS || '3', 10));
const MODEL = process.env.VFKB_BD_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_BD_TIMEOUT || '240000', 10);

// Unguessable sentinel: the decision codename captured mid-session and then
// destroyed with the uncommitted brain state.
const SENTINEL = 'gorsefen-ledger-83';
const QUESTION =
  'You are starting a work session on this project. Based ONLY on the session-start ' +
  'context above, answer: what is the codename of the queue-migration decision recorded ' +
  'in this project? Reply with just the codename and nothing else. If the context does ' +
  'not say, reply UNKNOWN.';

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });

// A consumer repo mid-session: committed brain baseline at HEAD, then the
// session's NEW knowledge sitting uncommitted in the tracked file — the
// RFC-034 loss window, built through the REAL engine surface.
function buildArm({ journal }) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-bd-'));
  const brain = join(dir, '.vfkb');
  const env = {
    ...process.env,
    VFKB_DATA_DIR: brain,
    VFKB_PROJECT: 'durproj',
    ...(journal ? {} : { VFKB_NO_JOURNAL: '1' }),
  };
  const git = (...a) => sh('git', ['-C', dir, ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'l4@example.invalid');
  git('config', 'user.name', 'l4');
  const add = (type, text, tags) =>
    sh('node', [CLI, 'add', type, text, '--role', 'human', '--prov-status', 'verified',
      ...(tags ? ['--tag', tags] : [])], { env });
  // Committed baseline (predates the sentinel — git history stays uninformative).
  add('fact', 'The deploy pipeline promotes staging to prod only after the reconciler reports clean.');
  add('decision', 'Config format is TOML; JSON configs were migrated out in Q2.');
  writeFileSync(join(dir, '.gitignore'), '.vfkb/.sessions/\n.vfkb/.signals/\n.vfkb/index-meta.json\n.vfkb/.lock\n.vfkb/.journal/\n');
  git('add', '.vfkb', '.gitignore');
  git('commit', '-q', '-m', 'baseline brain');
  // The session's capture — the entry the loss window destroys. Uncommitted.
  const out = add('decision',
    `Queue migration decided: move the ingest queue off the shared broker to a dedicated ` +
    `cluster — decision codename ${SENTINEL}. Rollout starts with the low-volume tenants; ` +
    `the shared-broker consumers drain first so replays cannot double-deliver.`,
    'status');
  const id = (out.match(/^([0-9a-f]{12})\t/m) || out.match(/added ([0-9a-f]{12})/) || [])[1] || null;
  return { dir, brain, env, id };
}

// The incident: a careless destructive git operation on the tracked brain.
function destroy(arm) {
  sh('git', ['-C', arm.dir, 'checkout', '--', '.vfkb/entries.jsonl'], { stdio: 'ignore' });
}

// The NEXT session starts: the real session-start hook (where ADR-0064 §2
// recovery runs), then the real injection surface.
function nextSession(arm) {
  let hookOut = '';
  try {
    hookOut = sh('node', [CLI, 'hook', 'session-start'], {
      env: arm.env,
      input: JSON.stringify({ session_id: 'bd-l4', cwd: arm.dir, hook_event_name: 'SessionStart' }),
    });
  } catch (e) {
    hookOut = String(e.stdout || '') + String(e.stderr || '');
  }
  const injection = sh('node', [CLI, 'resume'], { env: arm.env });
  const entries = existsSync(join(arm.brain, 'entries.jsonl'))
    ? readFileSync(join(arm.brain, 'entries.jsonl'), 'utf8')
    : '';
  return {
    hookOut,
    injection,
    restoredSameId: arm.id ? entries.split('\n').some((l) => l.includes(`"id":"${arm.id}"`) && l.includes(SENTINEL)) : false,
    injectionCarries: injection.includes(SENTINEL),
  };
}

function askAgent(injection) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-bd-arm-'));
  const prompt = `${injection}\n\n${QUESTION}`;
  let out = '';
  let err = '';
  try {
    out = sh('claude', ['-p', prompt, '--strict-mcp-config', '--dangerously-skip-permissions', '--model', MODEL], {
      cwd: dir,
      timeout: TIMEOUT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    err = String(e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 160);
    out = String(e.stdout || '');
  }
  rmSync(dir, { recursive: true, force: true });
  return { hit: out.toLowerCase().includes(SENTINEL), out: out.replace(/\s+/g, ' ').slice(0, 110), err };
}

console.log(`vfkb brain-durability L4  (model=${MODEL}, trials=${TRIALS})`);
console.log('only variable = the journal behind an identical destroy → session-start flow\n');

const arms = { wired: [], contrast: [] };
const structural = { wired: [], contrast: [] };
for (let t = 1; t <= TRIALS; t++) {
  for (const name of Object.keys(arms)) {
    const arm = buildArm({ journal: name === 'wired' });
    destroy(arm);
    const s = nextSession(arm);
    structural[name].push({ restoredSameId: s.restoredSameId, injectionCarries: s.injectionCarries });
    process.stdout.write(`  trial ${t}  ${name.padEnd(8)} restored=${s.restoredSameId ? 'SAME-ID' : 'no'} inject=${s.injectionCarries ? 'YES' : 'no'} … `);
    const r = askAgent(s.injection);
    // A wired hit requires the full causal chain: same-id restoration AND the
    // agent surfacing the sentinel — an agent guess cannot fake the id gate.
    const hit = name === 'wired' ? r.hit && s.restoredSameId : r.hit;
    arms[name].push({ ...r, hit });
    console.log(`${hit ? 'HIT' : name === 'contrast' ? (r.hit ? 'LEAK' : 'clean') : 'miss'}  — "${r.out}"${r.err ? '  ERR:' + r.err : ''}`);
    rmSync(arm.dir, { recursive: true, force: true });
  }
}

const hits = (a) => a.filter((r) => r.hit).length;
const wiredN = hits(arms.wired);
const contrastN = hits(arms.contrast);
const need = Math.ceil((2 * TRIALS) / 3);
const demonstrated = wiredN >= need && wiredN > contrastN;

console.log(`\nwired: ${wiredN}/${TRIALS}   contrast(journal off): ${contrastN}/${TRIALS}`);
console.log(demonstrated
  ? `DEMONSTRATED — captured knowledge survives destructive git and re-briefs the next session, same ids (ADR-0022, recomputed)`
  : `NOT demonstrated (need wired ≥${need}/${TRIALS} AND > contrast) — expected RED until the ADR-0064 journal ships`);

mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
writeFileSync(
  join(REPO, 'scenarios/records/brain-durability.json'),
  JSON.stringify({ scenario: 'brain-durability', model: MODEL, trials: TRIALS,
    generated: new Date().toISOString(), wired: wiredN, contrast: contrastN,
    demonstrated, structural, arms }, null, 2),
);
console.log('record → scenarios/records/brain-durability.json');
process.exit(demonstrated ? 0 : 1);
