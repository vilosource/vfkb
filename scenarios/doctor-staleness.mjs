#!/usr/bin/env node
// ============================================================================
// vfkb DOCTOR-STALENESS L4 purpose scenario (RFC-024 §1 / ADR-0051 DoD 3)
// ----------------------------------------------------------------------------
// Reproduces the operator's ACTUAL failure of 2026-07-09: plugin v0.4.0 was
// DEMONSTRATED 3/3 and unreachable, because his marketplace clone never
// advanced — and NOTHING could tell him. A release-time gate cannot see this
// (CI runs before any consumer exists). It is a detection problem, owned by
// `vfkb doctor`.
//
// PURPOSE UNDER TEST: an operator asks "am I running the current plugin?",
// runs `vfkb doctor`, and is TOLD the clone is stale — and told the remedy.
//
// CAUSAL DESIGN (the only variable is where the clone's HEAD sits):
//   - wired arm    — clone parked ONE COMMIT BEHIND its remote's main;
//   - contrast arm — identical fixtures, clone level with main (can-fail:
//                    the agent must report CURRENT, not stale).
//
// OBSERVED, NOT ASSERTED (ADR-0029): a wired trial counts only if the agent
//   (a) reports the clone is stale/behind, AND
//   (b) names the remedy (`claude plugin marketplace update`).
// Exiting non-zero is NOT admissible: doctor never `fail`s on this check, and
// per ADR-0051's quiet-success corollary the predicate is a CONTENT assertion.
//
// SUBSTRATE: host-level tmpdir sandbox, OFFLINE, hand-built fixtures — a local
// bare repo as `origin`, a clone of it, and hand-written registry JSON. No
// GitHub, no network, no `claude plugin` CLI, no credentials beyond the agent's
// own model API. Nothing is installed into the sandbox, so the plugin's own
// hooks never fire there.
//
// VERDICT: recomputed per ADR-0022 — wired >= ceil(2n/3), contrast <= floor(n/3).
// RED-FIRST: against the pre-RFC-024 engine doctor has no currency check at all,
// so the wired arm cannot report stale — the recorded RED baseline.
//   node scenarios/doctor-staleness.mjs
//   VFKB_DS_TRIALS=1 node scenarios/doctor-staleness.mjs
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CLI = join(REPO, 'dist', 'cli.js');
const TRIALS = Math.max(1, parseInt(process.env.VFKB_DS_TRIALS || '3', 10));
const MODEL = process.env.VFKB_DS_MODEL || 'claude-haiku-4-5';
const TIMEOUT = parseInt(process.env.VFKB_DS_TIMEOUT || '240000', 10);

const sh = (c, a, o = {}) => execFileSync(c, a, { encoding: 'utf8', ...o });
const git = (cwd, ...args) =>
  sh('git', ['-c', 'user.email=l4@vfkb.test', '-c', 'user.name=l4', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
  });

// The question must contain NONE of the words the predicate scores on. An
// earlier draft asked "is it stale/behind?" and an agent that merely restated
// the question scored as reporting staleness — the predicate was measuring the
// prompt, not the answer. Observed 2026-07-09: a contrast trial came back with
// BOTH stale=true and current=true.
// The capability under test (RFC-024 §1) is stale-CLONE detection — axis (a),
// clone-vs-remote. It deliberately does NOT compare the installed version to
// what the marketplace offers (axis (b), explicitly gated by the RFC). An
// earlier version of this question asked "am I running the newest release?",
// which is an axis-(b) question: an honest axis-(a) check cannot answer it, and
// the only doctor wording that made the contrast arm clean was an axis-(b)
// OVERCLAIM the review gate ruled a blocking delivery-honesty defect. The
// question now asks what doctor actually checks and what the 2026-07-09 incident
// was actually about: whether the local marketplace copy is behind its source.
//
// Review gate (fix/doctor-currency-line) finding: this rewrite still used
// "fallen behind" in the question text itself, and one contrast trial leaked
// on it — the agent echoed the question's own conditional ("If it had fallen
// behind, what commands...? Not applicable, since it is current"), and the
// STALE match landed on that echo, ahead of its own negation. This is the
// exact "question leaked into the predicate" class documented above (2026-07-
// 09): the question must contain NONE of the STALE-list words. Rephrased to
// "matches its source" / "diverged" — neither is in the STALE term list.
const QUESTION =
  'I use the vfkb Claude Code plugin. It is installed from a local copy of a marketplace ' +
  'that I refresh periodically, and I want to know whether that local copy still matches ' +
  'its source. Run this exact command:\n\n' +
  '  {CMD}\n\n' +
  'Then, based ONLY on what that command printed, answer in plain prose:\n' +
  "  1. Does my local copy of the plugin's marketplace still match its source, or has it " +
  'diverged and need refreshing?\n' +
  '  2. If it has diverged, what exact command(s) must I run to bring it back in sync?\n' +
  'Do not guess. If the output does not say, tell me it does not say.';

/**
 * Build one sandbox: a bare `origin` with two commits, a clone parked either at
 * main (current) or one commit behind (stale), plus the Claude Code registry
 * JSON that doctor reads. Entirely offline — `origin` is a filesystem path.
 */
function buildSandbox(stale) {
  const root = mkdtempSync(join(tmpdir(), 'vfkb-ds-'));
  const work = join(root, 'work');
  const origin = join(root, 'origin.git');
  const clone = join(root, 'marketplaces', 'vfkb');
  const proj = join(root, 'project');
  const cfg = join(root, 'cfg');

  // A marketplace repo with two commits: v0.3.0 then v0.4.0.
  mkdirSync(join(work, '.claude-plugin'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main', 'work');
  writeFileSync(join(work, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'vfkb' }));
  writeFileSync(join(work, 'VERSION'), '0.3.0\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'v0.3.0');
  writeFileSync(join(work, 'VERSION'), '0.4.0\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'v0.4.0');

  // `origin` is a bare clone of it, on a filesystem path — no network.
  git(root, 'clone', '-q', '--bare', work, origin);
  mkdirSync(join(root, 'marketplaces'), { recursive: true });
  git(root, 'clone', '-q', origin, clone);
  // The wired arm's clone never advanced past v0.3.0 — the operator's state.
  if (stale) git(clone, 'reset', '-q', '--hard', 'HEAD~1');

  // The registry Claude Code keeps, in a relocated config dir (CLAUDE_CONFIG_DIR).
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(
    join(cfg, 'plugins', 'known_marketplaces.json'),
    JSON.stringify({
      vfkb: {
        source: { source: 'github', repo: 'vilosource/vfkb-claude-plugin' },
        installLocation: clone,
        lastUpdated: '2026-07-09T08:12:16.363Z',
      },
    }),
  );
  writeFileSync(
    join(cfg, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: { 'vfkb@vfkb': [{ scope: 'project', projectPath: proj, installPath: join(clone, 'plugin'), version: '0.3.0' }] },
    }),
  );

  // A plugin-wired project, as a consumer's repo looks.
  mkdirSync(join(proj, '.claude'), { recursive: true });
  mkdirSync(join(proj, '.vfkb'), { recursive: true });
  writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'vfkb@vfkb': true } }, null, 2));
  writeFileSync(join(proj, '.vfkb', 'entries.jsonl'), '');

  return { root, proj, cfg };
}

function runArm(stale) {
  const { root, proj, cfg } = buildSandbox(stale);
  const cmd = `CLAUDE_CONFIG_DIR=${cfg} VFKB_DATA_DIR=.vfkb node ${CLI} doctor`;
  const prompt = QUESTION.replace('{CMD}', cmd);
  let out = '';
  let err = '';
  try {
    out = sh('claude', ['-p', prompt, '--strict-mcp-config', '--dangerously-skip-permissions', '--model', MODEL], {
      cwd: proj,
      timeout: TIMEOUT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    err = String(e.stderr || e.message || '').replace(/\s+/g, ' ').slice(0, 200);
    out = String(e.stdout || '');
  }
  rmSync(root, { recursive: true, force: true });

  // Content assertions (ADR-0051's quiet-success corollary: exit status is not
  // admissible). Negated forms — "not stale", "isn't behind", "no longer out of
  // date" — are struck before scoring, so a clean report cannot register as a
  // stale one. The surviving match is recorded, so a leak can be audited later
  // instead of taken on faith.
  // A staleness word counts only when the agent ASSERTS it. Two ways that fails,
  // both observed on 2026-07-09 and both fixed here:
  //   negation — "it is not stale or behind" (scrubbing with one regex leaves
  //              `behind` standing, so each match is checked individually);
  //   hedging  — "the output does not say whether it is the newest or an older
  //              one" is a refusal to claim, not a claim.
  // The term list must also be closed under paraphrase: an earlier list had
  // `older version` but not `older release`, so a contrast trial that genuinely
  // misreported a current clone scored CLEAN. False negatives flatter the
  // result, which is the worse direction.
  // `lead` is already the single clause preceding the term, so the cues need no
  // trailing anchor — and must not have one: `[^.;!?]*$` cannot cross the dots
  // in a version string like "0.3.0", which severed the cue from its own clause.
  const STALE = /\b(stale|behind|out ?of ?date|outdated|old copy|older (?:one|copy|version|release|build))\b/gi;
  const NEG_CUE = /\b(not|isn'?t|aren'?t|no longer|never|nothing|neither|nor|no)\b/i;
  const HEDGE_CUE = /\b(does ?n'?o?t say|doesn'?t say|cannot tell|can'?t tell|unclear|not stated|does not indicate|doesn'?t indicate|whether)\b/i;

  // Review gate (fix/doctor-currency-line), finding #1: NEG_CUE was tested
  // against the WHOLE lead clause (up to 120 chars back to the last sentence
  // break), not just the words immediately before the term. The new
  // disjunctive question ("...up to date, OR has it fallen behind...") invites
  // "No, it has fallen behind" — where "No" answers "is it up to date?" and
  // does not negate the "behind" six words later, but the old scan saw "no"
  // anywhere in the clause and negated the match anyway. Traced against the
  // committed record: 3 of 5 wired trials used exactly this construction and
  // were rescued only because the model happened to re-quote doctor's raw
  // "...STALE..." text later in the same answer — a second, unnegated match.
  // Restricting the negation scan to the immediate pre-term words (not the
  // whole clause) fixes the sentence-initial "No," case while still catching
  // adjacent negations ("not stale", "isn't behind", "no longer out of date").
  const NEG_WINDOW_WORDS = 4;

  // Agents answer in Markdown. `**You are not on the newest.**` puts `.**` where
  // the sentence break belongs, so the clause scan runs past it and a `not` from
  // the PREVIOUS sentence negates a genuine detection. Observed: a wired trial
  // that quoted "marketplace clone is STALE" scored stale=false. Strip emphasis
  // before scoring; keep the raw text for the record.
  const flat = out.replace(/[*_`~]/g, '');

  let staleHit = null;
  for (const m of flat.matchAll(STALE)) {
    const clause = flat.slice(Math.max(0, m.index - 120), m.index);
    // Sentence break = terminator followed by whitespace. Splitting on a bare
    // `.` cuts version numbers ("0.3.0") in half and severs the hedge cue that
    // precedes them — which silently turned a hedged answer into a stale claim.
    const lead = clause.split(/[.;!?](?=\s|$)/).pop() ?? '';
    const immediate = lead.trim().split(/\s+/).slice(-NEG_WINDOW_WORDS).join(' ');
    if (!NEG_CUE.test(immediate) && !HEDGE_CUE.test(lead)) {
      staleHit = { term: m[0], at: m.index };
      break;
    }
  }
  const saysStale = Boolean(staleHit);
  const namesRemedy = /marketplace update/i.test(out);
  const saysCurrent = /\b(up to date|newest|current|matches|no update)\b/i.test(out);

  return {
    stale: saysStale,
    remedy: namesRemedy,
    current: saysCurrent,
    // Audit trail for the predicate itself: what matched, and its context. A
    // leak that cannot be inspected later is a leak taken on faith.
    staleMatch: staleHit?.term ?? null,
    staleContext: staleHit
      ? flat.slice(Math.max(0, staleHit.at - 70), staleHit.at + 70).replace(/\s+/g, ' ')
      : null,
    out: out.replace(/\s+/g, ' ').slice(0, 240),
    err,
  };
}

// Fixture check: build both sandboxes and run `doctor` directly, no agent, no
// cost. Verifies the substrate before spending trials on it.
if (process.env.VFKB_DS_DRYRUN) {
  for (const stale of [true, false]) {
    const { root, proj, cfg } = buildSandbox(stale);
    let out;
    try {
      out = sh('node', [CLI, 'doctor'], { cwd: proj, env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, VFKB_DATA_DIR: '.vfkb' } });
    } catch (e) {
      out = String(e.stdout || '') + String(e.stderr || '');
    }
    console.log(`\n===== clone ${stale ? 'ONE COMMIT BEHIND' : 'LEVEL WITH'} remote =====`);
    console.log(out.trim());
    rmSync(root, { recursive: true, force: true });
  }
  process.exit(0);
}

console.log(`vfkb doctor-staleness L4  (model=${MODEL}, trials=${TRIALS})`);
console.log('only variable = whether the marketplace clone is one commit behind its remote\n');

const arms = {
  wired: { role: 'positive', predicate: ['stale', 'remedy'], trials: [] },
  contrast: { role: 'contrast', predicate: ['stale'], trials: [] },
};
for (let t = 1; t <= TRIALS; t++) {
  for (const arm of ['wired', 'contrast']) {
    process.stdout.write(`  trial ${t}  ${arm.padEnd(9)} … `);
    const r = runArm(arm === 'wired');
    arms[arm].trials.push(r);
    const tag = arm === 'wired'
      ? (r.stale && r.remedy ? 'DETECTED' : `miss (stale=${r.stale} remedy=${r.remedy})`)
      : (r.stale ? 'LEAK' : 'clean');
    console.log(`${tag}  — "${r.out}"${r.err ? '  ERR:' + r.err : ''}`);
  }
}

const hits = (a) => a.trials.filter((x) => a.predicate.every((p) => x[p] === true)).length;
const wiredN = hits(arms.wired);
const contrastN = hits(arms.contrast);
const need = Math.ceil((2 * TRIALS) / 3);
const demonstrated = wiredN >= need && contrastN <= Math.floor(TRIALS / 3);

console.log(`\nwired: ${wiredN}/${TRIALS} (stale+remedy)   |   contrast leaks: ${contrastN}/${TRIALS}`);
console.log(demonstrated
  ? `DEMONSTRATED — \`vfkb doctor\` names the stale clone and its remedy (ADR-0022, recomputed)`
  : `NOT demonstrated (need wired >=${need}/${TRIALS} AND contrast <=${Math.floor(TRIALS / 3)})`);

const vfkbSha = sh('git', ['rev-parse', 'HEAD'], { cwd: REPO }).trim();
mkdirSync(join(REPO, 'scenarios/records'), { recursive: true });
writeFileSync(
  join(REPO, 'scenarios/records/doctor-staleness.json'),
  JSON.stringify({ scenario: 'doctor-staleness', recordVersion: 2, vfkbSha, model: MODEL,
    trials: TRIALS, generated: new Date().toISOString(), arms }, null, 2) + '\n',
);
console.log(`record → scenarios/records/doctor-staleness.json (vfkbSha=${vfkbSha.slice(0, 7)})`);
process.exit(demonstrated ? 0 : 1);
