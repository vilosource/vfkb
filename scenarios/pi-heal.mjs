#!/usr/bin/env node
// ============================================================================
// vfkb PI-HEAL L4 purpose scenario (issue #205 — ADR-0064 §2 parity for the pi face)
// ----------------------------------------------------------------------------
// Proves the PURPOSE of journal recovery ON THE PI FACE: knowledge captured
// mid-session survives the destructive-git loss window and is back in front of
// the NEXT pi session — same ids, no operator action — because the pi
// extension heals at injection time, exactly as the Claude session-start hook
// does (brain-durability.mjs proves the Claude half).
//
// WHY THIS SCENARIO EXISTS SEPARATELY: `recoverFromJournal` had ONE call site,
// `cli.ts hook session-start`. A pi-harnessed consumer only healed if that CLI
// hook happened to run — which, in a pi-only project, it never does. The pi
// package is delivered and proven (ADR-0066), so this gap is shipped, not
// theoretical.
//
// TWO ARMS (only variable = the journal behind an identical destroy → pi-session flow):
//   - wired arm: real engine writes (journal on, the default) → the harness
//     destroys the uncommitted tracked state (`git checkout -- entries.jsonl`,
//     the real incident shape) → a fresh REAL pi session starts with the REAL
//     vfkb extension loaded → a live agent must answer with the unguessable
//     sentinel carried ONLY by the destroyed entry. Structural gate on top: the
//     restored line carries the SAME id.
//   - contrast arm (can fail): identical flow with the journal disabled
//     (VFKB_NO_JOURNAL=1, the implementation's kill switch) — nothing on disk
//     carries the sentinel afterwards (asserted), so the agent must say UNKNOWN.
//
// CAUSAL DESIGN: the sentinel exists nowhere but the destroyed entry — not in
// git history (the baseline commit predates it), not in the arm cwd, not in the
// prompt. A wired hit is attributable ONLY to the pi face healing the brain.
//
// SCOPE, STATED (ADR-0051 clause 1): this loads the extension with `pi -e`, so
// it proves the CAPABILITY, not delivery. Delivery of the pi package is proven
// separately and independently (vfkb-pi-package scenarios/records/install-path.json).
//
// RED-FIRST (ADR-0023): against the pre-fix engine the wired arm is 0/N — the
// pi face never called recovery, so destruction was permanent. That observed
// RED is this build's evidence gate, preserved in records/pi-heal.red-baseline.json.
//
// VERDICT: DEMONSTRATED iff wired ≥ 2/3 AND contrast leaks ≤ 1/3 (ADR-0022).
// LIVE + metered (DEEPSEEK_TOKEN). One at a time.
//   node scenarios/pi-heal.mjs
//   VFKB_PH_TRIALS=1 node scenarios/pi-heal.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const EXT = join(REPO, 'dist', 'pi-extension.js');
const TRIALS = Math.max(1, parseInt(process.env.VFKB_PH_TRIALS || '3', 10));
const MODEL = process.env.VFKB_PH_MODEL || 'deepseek-v4-pro';
const PROVIDER = process.env.VFKB_PH_PROVIDER || 'deepseek';
const TIMEOUT = parseInt(process.env.VFKB_PH_TIMEOUT || '300000', 10);
// `read` only: the agent must not be able to hand-restore the file with an exec
// tool, which would make a wired hit prove nothing about the engine.
const TOOLS = 'read';

const SENTINEL = 'brackenvault-cinder-47';
const QUESTION =
  'Based ONLY on the session-start context you were given, answer: what is the codename of ' +
  'the queue-migration decision recorded in this project? Reply with just the codename and ' +
  'nothing else. If your context does not say, reply UNKNOWN.';

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });

// --- preconditions, before anything metered runs ----------------------------
if (!process.env.DEEPSEEK_TOKEN) {
  console.error(
    'DEEPSEEK_TOKEN is not set — refusing to run: an empty token yields a model auth error\n' +
      'that would be scored as a scenario result, reporting a verdict for a run in which no\n' +
      'agent executed.',
  );
  process.exit(2);
}
for (const [what, p] of [['CLI', CLI], ['pi extension', EXT]]) {
  if (!existsSync(p)) {
    console.error(`${what} not found at ${p} — run \`npm run build\` first`);
    process.exit(2);
  }
}
const HOST_MODELS = join(homedir(), '.pi', 'agent', 'models.json');
if (!existsSync(HOST_MODELS)) {
  console.error(`no ${HOST_MODELS} — the sandbox HOME needs a provider config to copy`);
  process.exit(2);
}

const redact = (s) => {
  let out = String(s ?? '');
  const tok = process.env.DEEPSEEK_TOKEN;
  if (tok && tok.length >= 8) out = out.split(tok).join('***REDACTED***');
  return out.replace(/sk-[A-Za-z0-9]{16,}/g, '***REDACTED***');
};

// A consumer repo mid-session: committed brain baseline at HEAD, then the
// session's NEW knowledge sitting uncommitted in the tracked file — the
// RFC-034 loss window, built through the REAL engine surface.
function buildArm({ journal }) {
  const dir = mkdtempSync(join(tmpdir(), 'vfkb-ph-'));
  const home = mkdtempSync(join(tmpdir(), 'vfkb-ph-home-'));
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(home, '.pi', 'agent', 'models.json'), readFileSync(HOST_MODELS));

  const brain = join(dir, '.vfkb');
  const env = {
    ...process.env,
    VFKB_DATA_DIR: brain,
    VFKB_PROJECT: 'healproj',
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
  writeFileSync(join(dir, '.gitignore'),
    '.vfkb/.sessions/\n.vfkb/.signals/\n.vfkb/index-meta.json\n.vfkb/.lock\n.vfkb/.journal/\n');
  git('add', '.vfkb', '.gitignore');
  git('commit', '-q', '-m', 'baseline brain');
  // The session's capture — the entry the loss window destroys. Uncommitted.
  const out = add('decision',
    `Queue migration decided: move the ingest queue off the shared broker to a dedicated ` +
    `cluster — decision codename ${SENTINEL}. Rollout starts with the low-volume tenants; ` +
    `the shared-broker consumers drain first so replays cannot double-deliver.`,
    'status');
  const id = (out.match(/^([0-9a-f]{12})\t/m) || out.match(/added ([0-9a-f]{12})/) || [])[1] || null;
  return { dir, home, brain, env, id };
}

// The incident: a careless destructive git operation on the tracked brain.
function destroy(arm) {
  sh('git', ['-C', arm.dir, 'checkout', '--', '.vfkb/entries.jsonl'], { stdio: 'ignore' });
}

const entriesText = (arm) => {
  const p = join(arm.brain, 'entries.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};

/**
 * STRUCTURAL: does the extension's own injection carry the sentinel?
 *
 * Review finding: with `--tools read` the agent could in principle answer from
 * reading entries.jsonl rather than from the injection, so `said` alone does not
 * attribute the hit to the injection path. This drives the REAL
 * `before_agent_start` handler and inspects the systemPrompt it returns — a
 * deterministic observation, no model involved.
 *
 * It runs against a BYTE-COPY of the arm so the probe's own heal cannot
 * contaminate the arm the live pi session is about to exercise.
 */
function probeInjection(arm) {
  const copy = mkdtempSync(join(tmpdir(), 'vfkb-ph-probe-'));
  try {
    cpSync(arm.dir, copy, { recursive: true });
    const script =
      `const ext = (await import(${JSON.stringify(EXT)})).default;` +
      `const h = {};` +
      `ext({ on: (e, fn) => { h[e] = fn; } });` +
      `const out = await h['before_agent_start']({ systemPrompt: '' });` +
      `process.stdout.write(String(out?.systemPrompt ?? ''));`;
    const out = sh('node', ['--input-type=module', '-e', script], {
      cwd: copy,
      env: { ...arm.env, VFKB_DATA_DIR: join(copy, '.vfkb') },
      timeout: 60000,
    });
    return out.includes(SENTINEL);
  } catch {
    return false; // a probe failure is never scored as a pass
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

/**
 * The NEXT session starts — a REAL pi session with the REAL vfkb extension.
 * Recovery, if it happens at all, happens INSIDE pi (that is the thing under test).
 */
function piSession(arm) {
  let out = '';
  let err = '';
  try {
    out = sh('pi',
      ['-p', '--no-session', '--provider', PROVIDER, '--model', MODEL, '--tools', TOOLS, '-e', EXT, QUESTION],
      { cwd: arm.dir, env: { ...arm.env, HOME: arm.home }, timeout: TIMEOUT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    err = redact(String(e.stderr || e.message || '')).replace(/\s+/g, ' ').slice(0, 160);
    out = String(e.stdout || '');
  }
  out = redact(out);
  const entries = entriesText(arm);
  return {
    said: out.toLowerCase().includes(SENTINEL),
    // Same-id restoration: an agent guess cannot fake this, and it is the exact
    // byte-identical-restore promise RFC-034 makes.
    restoredSameId: arm.id ? entries.split('\n').some((l) => l.includes(`"id":"${arm.id}"`) && l.includes(SENTINEL)) : false,
    // Contrast honesty: assert the sentinel really is gone from disk, so a
    // clean contrast means "nothing to find", not "the agent was coy".
    onDisk: entries.includes(SENTINEL),
    out: out.replace(/\s+/g, ' ').slice(0, 110),
    err,
  };
}

console.log(`vfkb pi-heal L4  (model=${MODEL}, trials=${TRIALS})`);
console.log('only variable = the journal behind an identical destroy → REAL pi session flow\n');

const arms = {
  // injectionCarries is the STRUCTURAL half of the attribution: the sentinel
  // reached the agent through the extension's own injection, not merely through
  // a file the agent could have read.
  wired: { role: 'positive', predicate: ['said', 'restoredSameId', 'injectionCarries'], trials: [] },
  contrast: { role: 'contrast', predicate: ['said'], trials: [] },
};

for (let t = 1; t <= TRIALS; t++) {
  for (const name of Object.keys(arms)) {
    const arm = buildArm({ journal: name === 'wired' });
    try {
      destroy(arm);
      const injectionCarries = probeInjection(arm);
      const r = piSession(arm);
      // A trial whose pi process errored is an OBSERVATION FAILURE, not an
      // observation: without this an expired token would score the contrast arm
      // "clean" for a reason that has nothing to do with the journal.
      const invalid = Boolean(r.err);
      arms[name].trials.push({
        said: r.said, restoredSameId: r.restoredSameId, injectionCarries,
        onDisk: r.onDisk, invalid, out: r.out, err: r.err,
      });
      const hit = !invalid && arms[name].predicate.every((p) => ({ ...r, injectionCarries })[p] === true);
      console.log(
        `  trial ${t}  ${name.padEnd(8)} ${invalid ? 'INVALID' : name === 'wired' ? (hit ? 'HIT ' : 'miss') : (hit ? 'LEAK' : 'clean')}` +
        `  said=${r.said} restored=${r.restoredSameId} inject=${injectionCarries} onDisk=${r.onDisk}` +
        `  — "${r.out}"${r.err ? '  ERR:' + r.err : ''}`,
      );
    } finally {
      rmSync(arm.dir, { recursive: true, force: true });
      rmSync(arm.home, { recursive: true, force: true });
    }
  }
}

// Record shape v2 — the verdict is recomputed from these observations, never asserted here.
const hits = (arm) => arm.trials.filter((t) => !t.invalid && arm.predicate.every((p) => t[p] === true)).length;
const invalidTrials = Object.values(arms).reduce((n, a) => n + a.trials.filter((t) => t.invalid).length, 0);
const wiredN = hits(arms.wired);
const contrastN = hits(arms.contrast);
const need = Math.ceil((2 * TRIALS) / 3);
const allow = Math.floor(TRIALS / 3);
// An invalid trial means the run did not observe what it claims to observe.
const demonstrated = invalidTrials === 0 && wiredN >= need && contrastN <= allow;

const record = {
  scenario: 'pi-heal',
  recordVersion: 2,
  issue: 205,
  harness: 'pi',
  loadPath: 'pi -e (capability, not delivery — see vfkb-pi-package install-path for delivery)',
  outerModel: MODEL,
  // Engine identity, so "this ran against the pre-fix engine" is an observation
  // in the record rather than a sentence in a note field.
  engineSha: (() => { try { return sh('git', ['-C', REPO, 'rev-parse', 'HEAD']).trim(); } catch { return 'unknown'; } })(),
  engineDirty: (() => { try { return sh('git', ['-C', REPO, 'status', '--porcelain', '--', 'src']).trim().length > 0; } catch { return null; } })(),
  trials: TRIALS,
  generated: new Date().toISOString(),
  arms,
};
mkdirSync(join(REPO, 'scenarios', 'records'), { recursive: true });
// A 1-trial smoke run must not overwrite the committed >=3-trial evidence
// (ADR-0022 §5): it lands beside it, clearly named.
const recordName = TRIALS >= 3 ? 'pi-heal.json' : 'pi-heal.partial.json';
writeFileSync(join(REPO, 'scenarios', 'records', recordName), JSON.stringify(record, null, 2) + '\n');

console.log(`\nwired ${wiredN}/${TRIALS} (need >=${need}) · contrast ${contrastN}/${TRIALS} (allow <=${allow})`);
console.log(demonstrated
  ? 'DEMONSTRATED — the pi face heals a destroyed brain (ADR-0022, recomputed)'
  : 'NOT demonstrated');
console.log(`record → scenarios/records/${recordName}${invalidTrials ? ` (${invalidTrials} INVALID trial(s))` : ''}`);
process.exit(demonstrated ? 0 : 1);
