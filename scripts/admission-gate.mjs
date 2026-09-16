#!/usr/bin/env node
// ============================================================================
// ADMISSION GATE (P12-a, ADR-0075 clause 3 / RFC-039 D2).
//
// An issue is dispatchable only if it names (a) acceptance criteria, (b) the
// surfaces it touches, and (c) its governing ADR/RFC. Anything short of that is
// returned WITH THE SPECIFIC MISSING THING rather than dispatched.
//
// This is the highest-leverage clause in RFC-039 and the only one with no
// counter-evidence in the research behind it. Four independent measurements:
// stripping human-written requirements swings GPT-5 25.9% -> 8.40% on SWE-Bench
// Pro; an interpretable issue-readiness model reaches median AUC 72%; Sweep.dev
// pivoted away from issue-to-PR naming underspecification as failure reason #1;
// and OpenAI found underspecification is what makes contamination PAY, because
// a memorised model has information the spec never gave.
//
// ── WHY IT CHECKS EXISTENCE, NOT QUALITY ────────────────────────────────────
// The obvious build is "ask a model whether this issue is well specified". That
// is the shape that failed four times on this phase's sibling gate (#307): a
// judgement call, authored and graded by the same kind of thing, with no
// authoritative referent. The lesson recorded from that arc (brain gotcha
// 1af189641750) is to hand the hardest sub-problem to something authoritative.
//
// Here that is the repository itself. Two of the three requirements are
// MECHANICALLY VERIFIABLE: a named surface either exists (or its parent
// directory does, for a file yet to be written) or it does not; a cited ADR/RFC
// either exists or it does not. No model, no prose scoring, no judgement — and
// the failure message can name the exact path that is wrong, which is what makes
// a refusal actionable instead of discouraging.
//
// The third requirement — acceptance criteria — is structural: a section exists
// and has at least one checkable item. Whether those criteria are GOOD is
// review's job (ADR-0052) and a human's, not this gate's. Stated rather than
// implied, because a gate that overstates its reach is read as coverage it does
// not have.
//
// ── WHAT THIS DELIBERATELY DOES NOT CHECK ───────────────────────────────────
// Stated, because a gate that overstates its reach is read as coverage it does
// not have — and because two of these are tempting to fake with a model.
//
//   * WHETHER THE CRITERIA ARE GOOD. It checks a section exists and has at
//     least one checkable item. "- [ ] make it work" passes. Judging criteria is
//     review's job (ADR-0052) and a human's.
//   * WHETHER THE CITED DECISION ACTUALLY GOVERNS. Any real ADR/RFC reference
//     satisfies clause (c) — a passing mention counts the same as the decision
//     being implemented. Distinguishing them is a judgement call with no
//     authoritative referent, so it is not attempted. The value here is narrow
//     and real: an issue citing NO decision at all is refused, which was 9 of
//     this repo's 36 issues when the gate was built.
//   * WHETHER THE SURFACES ARE THE RIGHT ONES. It verifies the named paths
//     exist (or their directories do). Naming the wrong file passes.
//
// Measured on this repo's full issue corpus at build time: 4 of 36 dispatchable,
// 32 returned. Failure reasons were 22 no criteria, 9 no surfaces, 9 no
// governing decision, 6 an empty criteria section. A gate that passed or failed
// ALL of them would not be discriminating, which is why that split was measured
// rather than assumed.
//
//   node scripts/admission-gate.mjs <issue-number>
//   node scripts/admission-gate.mjs --body-file <path>     (for testing)
// ============================================================================
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/**
 * Headings that introduce "what must be true when this is done", in the
 * spellings THIS REPO ACTUALLY USES. Calibrated against all 36 issues rather
 * than invented: the first draft demanded a literal "Acceptance criteria"
 * heading and matched ZERO of them, while the corpus says "suggested fix" (4),
 * "proposed fix" (2), "fix shape" (2), "requirements", "the property to assert".
 * A gate that demands a magic word teaches people to add the magic word; a gate
 * that matches how people already write makes the missing ones mean something.
 */
const CRITERIA_HEADING = /^#{1,4}\s*(?:acceptance\s+criteria|done\s+when|definition\s+of\s+done|success\s+criteria|dod|requirements?|(?:suggested|proposed|the)\s+fix|fix\s+shape|what\s+would\s+resolve|resolution|the\s+property\s+to\s+assert|proposed\s+(?:change|design)|scope)\b/im;
/** A checkable item: a task box, or a bullet under the criteria heading. */
const CHECKABLE = /^\s*(?:[-*]\s*\[[ xX]\]|[-*]\s+\S|\d+\.\s+\S)/;

/** Paths that are implementation surfaces in this repo. */
// `*` not `+` after the slash: naming a DIRECTORY (`scripts/`) is a legitimate
// way to say what a change touches, and requiring a filename refused it.
const SURFACE = /(?:^|[\s`(])((?:src|test|tests|scripts|scenarios|docs\/templates|\.claude|\.github)\/[\w./-]*)/g;
/** A governing decision document. */
const GOVERNING = /(?:^|[\s`(])(docs\/(?:adr|rfc)\/(?:ADR|RFC)-[\w./-]+\.md)/gi;
/** A bare reference like "ADR-0075" or "RFC-039" with no path. */
const BARE_DECISION = /\b((?:ADR|RFC)-\d{3,4})\b/g;

const uniq = (a) => [...new Set(a)];
const matches = (body, re) => uniq([...String(body).matchAll(re)].map((m) => m[1]));

/**
 * @param body   the issue body
 * @param has    (path) => boolean — does this path exist in the repo?
 * @param find   (decision) => string|null — resolve "ADR-0075" to its file
 * @returns {{ok: boolean, problems: string[], surfaces: string[], governing: string[]}}
 */
export function admit(body, { has, find }) {
  const text = String(body ?? '');
  const problems = [];

  // (a) acceptance criteria — structural only
  const hIdx = text.search(CRITERIA_HEADING);
  if (hIdx === -1) {
    problems.push('No acceptance criteria. Add a section headed "Acceptance criteria" (or "Done when") listing what must be true for this to be finished.');
  } else {
    const after = text.slice(hIdx).split('\n').slice(1);
    const stop = after.findIndex((l) => /^#{1,4}\s/.test(l));
    const section = (stop === -1 ? after : after.slice(0, stop));
    if (!section.some((l) => CHECKABLE.test(l))) {
      problems.push('The acceptance-criteria section is empty. List at least one checkable item, e.g. "- [ ] `vfkb doctor` exits non-zero when …".');
    }
  }

  // (b) surfaces — verified against the repo, not judged
  const surfaces = matches(text, SURFACE).map((p) => p.replace(/\/$/, ''));
  if (!surfaces.length) {
    problems.push('No surfaces named. List the files or directories this touches, e.g. `src/engine.ts` or `scripts/`. A path that does not exist yet is fine if its directory does.');
  }
  const badSurfaces = surfaces.filter((p) => !has(p) && !has(dirname(p)));
  if (badSurfaces.length) {
    problems.push(`These named surfaces do not exist, and neither do their directories — check the paths: ${badSurfaces.map((p) => `\`${p}\``).join(', ')}`);
  }

  // (c) a governing decision — verified to exist
  const cited = matches(text, GOVERNING);
  const bare = matches(text, BARE_DECISION);
  const resolved = [];
  const unresolved = [];
  for (const p of cited) (has(p) ? resolved : unresolved).push(p);
  for (const d of bare) { const f = find(d); if (f) resolved.push(f); else unresolved.push(d); }
  if (!resolved.length) {
    problems.push(
      unresolved.length
        ? `The governing decision could not be found: ${unresolved.map((d) => `\`${d}\``).join(', ')}. Cite one that exists under docs/adr/ or docs/rfc/.`
        : 'No governing ADR or RFC. Cite the decision this implements (e.g. `ADR-0075`). If there is not one yet, that is the signal to write an RFC first — a change with no standard to build against cannot be reviewed against one either.',
    );
  }

  return { ok: problems.length === 0, problems, surfaces, governing: uniq(resolved) };
}

// ------------------------------------------------------------------- driver --
const gh = (...a) => execFileSync('/opt/homebrew/bin/gh', a, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

export function repoProbes(root = process.cwd()) {
  const has = (p) => existsSync(resolve(root, p));
  const find = (decision) => {
    const [kind, num] = decision.split('-');
    const dir = kind.toUpperCase() === 'ADR' ? 'docs/adr' : 'docs/rfc';
    try {
      const listing = execFileSync('ls', [resolve(root, dir)], { encoding: 'utf8' }).split('\n');
      const hit = listing.find((f) => f.startsWith(`${kind.toUpperCase()}-${num}`));
      return hit ? `${dir}/${hit}` : null;
    } catch { return null; }
  };
  return { has, find };
}

export function main(argv = process.argv.slice(2)) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const bodyFile = arg('--body-file', null);
  const issue = argv.find((a) => /^\d+$/.test(a));

  let body, label;
  if (bodyFile) { body = readFileSync(bodyFile, 'utf8'); label = bodyFile; }
  else if (issue) {
    try { body = JSON.parse(gh('issue', 'view', issue, '--json', 'body')).body ?? ''; label = `#${issue}`; }
    catch { console.error(`admission-gate FAILED — could not read issue #${issue}. Refusing to admit an issue it cannot see.`); return 1; }
  } else { console.error('usage: admission-gate.mjs <issue-number> | --body-file <path>'); return 2; }

  const { ok, problems, surfaces, governing } = admit(body, repoProbes());
  console.log(`admission-gate: ${label}`);
  console.log(`  surfaces named: ${surfaces.length ? surfaces.join(', ') : 'none'}`);
  console.log(`  governing: ${governing.length ? governing.join(', ') : 'none'}`);
  if (ok) { console.log('admission-gate PASSED — dispatchable'); return 0; }

  console.error('\nadmission-gate: NOT DISPATCHABLE. This is not a rejection of the idea — it is a');
  console.error('request for the specifics an agent would otherwise have to invent:\n');
  for (const p of problems) console.error(`  • ${p}`);
  console.error('\nAdd them and re-run. Nothing is dispatched until an issue says what "done" means.');
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
