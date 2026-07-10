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

// HISTORY (fix/doctor-currency-line): this question went through three
// designs, each defeated by a different variant of the same problem — scoring
// free prose for staleness language is inherently ambiguous once the question
// itself must mention staleness/currency at all:
//   v1 asked "am I running the newest release?" — an axis-(b) question an
//      honest axis-(a) check cannot answer; the only doctor wording that made
//      the contrast arm clean was an axis-(b) OVERCLAIM the review gate ruled
//      a blocking delivery-honesty defect.
//   v2 asked "...has it fallen behind...?" — a contrast trial echoed the
//      question's own conditional ("If it had fallen behind... Not
//      applicable, since it is current"), and the STALE regex matched that
//      echo ahead of a negation the scanner (backward-only) never saw. A
//      narrower negation-scan window fixed the RECORDED case but a fresh
//      review reproduced the identical bug with a one-word-shorter phrasing
//      ("No, it has fallen behind") and found the narrower window broke
//      legitimate long-distance negations the old scan used to catch.
// v3 (current) does not parse negation in prose AT ALL. The agent must answer
// in a fixed three-line format; STATUS is a closed-vocabulary label, not a
// clause a negation word can modify, so "no negation-scope bug" is true by
// construction rather than by another regex heuristic. EVIDENCE still ties
// the label back to doctor's actual output text (ADR-0051's quiet-success
// corollary: a content assertion, not a bare claim) — a model that fills in
// the format without reading the output fails the evidence check, not the
// (now trivial) status check.
const QUESTION =
  'I use the vfkb Claude Code plugin. It is installed from a local copy of a marketplace ' +
  'that I refresh periodically. Run this exact command:\n\n' +
  '  {CMD}\n\n' +
  'Then, based ONLY on what that command printed, answer in EXACTLY this three-line format ' +
  'and nothing else — no other text before or after it:\n\n' +
  'STATUS: <one word, either "current" or "diverged">\n' +
  'EVIDENCE: <the exact line from the command output that tells you>\n' +
  'REMEDY: <the exact command(s) to run to fix it, or "none needed">\n\n' +
  'Do not guess. If the output does not say, put "unclear" as the STATUS.';

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
  // admissible) — but no negation/hedge parsing over free prose. STATUS is a
  // closed-vocabulary label the agent must fill in verbatim; there is no
  // clause for a negation word to modify, so there is nothing for a "No," /
  // "not" / "whether" to ambiguously scope over. Markdown emphasis is stripped
  // first so `**STATUS:** diverged` still matches the label.
  const flat = out.replace(/[*_`~]/g, '');
  const statusHit = flat.match(/\bSTATUS\s*:\s*["']?(current|diverged|unclear)\b/i);
  const evidenceHit = flat.match(/\bEVIDENCE\s*:\s*(.+)/i);
  const remedyHit = flat.match(/\bREMEDY\s*:\s*(.+)/i);
  const status = statusHit?.[1]?.toLowerCase() ?? null;
  const evidence = evidenceHit?.[1]?.trim() ?? '';
  const remedyLine = remedyHit?.[1]?.trim() ?? '';

  // A STATUS label counts only if EVIDENCE quotes doctor's own STALE/CURRENT
  // marker text — ties the label back to something actually printed, not a
  // guess that happens to fill in the right word. This is the sole grounding
  // check now that there's no negation scan to leak through: a model that
  // never reads the output fails here even if it names the right label.
  const saysStale = status === 'diverged' && /\bSTALE\b/i.test(evidence);
  const saysCurrent = status === 'current' && /\bCURRENT\b/i.test(evidence);
  const namesRemedy = /marketplace update/i.test(remedyLine) || /marketplace update/i.test(out);

  return {
    stale: saysStale,
    remedy: namesRemedy,
    current: saysCurrent,
    // Audit trail: the raw STATUS/EVIDENCE captured, so a miss or leak can be
    // inspected later instead of taken on faith.
    staleMatch: status,
    staleContext: evidence || null,
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
