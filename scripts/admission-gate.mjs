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
// ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
// It PRINTS a verdict and exits 0 or 1. It does not relabel, move or return
// anything: RFC-039 D2 speaks of an issue "returned to fsm:needs-spec with
// specific questions", but the FSM is D1 and unbuilt, so the questions are the
// only half that exists yet.
//
// Measured on this repo's full 38-issue corpus (re-run after round 1's fixes):
// 9 dispatchable, 29 returned — 24 no criteria, 9 no surfaces, 8 no governing
// decision. A gate that passed or failed ALL of them would not be
// discriminating, which is why the split is measured rather than assumed.
//
// AND THE HONEST PART, by the same standard this header sets above: 100% of that
// discrimination comes from the STRUCTURAL checks — is there a heading, is any
// path named, is any decision cited. The existence probes, which are the answer
// to the model-as-judge problem and the reason given for the whole design, have
// never fired on a real issue: not one refusal was "these surfaces do not
// exist" or "could not be found". They are prospective — they catch a typo or a
// stale path the day someone makes one — not the measured discriminator.
//
//   node scripts/admission-gate.mjs <issue-number>
//   node scripts/admission-gate.mjs --body-file <path>     (for testing)
// ============================================================================
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
/**
 * Something a reader could check off: a task box, a bullet, a numbered item —
 * or PROSE. Round 1 found the bullet requirement was a magic word one level
 * down from the magic heading the first draft demanded: all 6 "empty section"
 * refusals were false, every one of them a criteria section written as prose or
 * a blockquote (#95 #96 #127 #186 #280 #306). #306 was the worst — the most
 * carefully specified issue in the corpus, refused and told to list an item it
 * already listed twice, because only the FIRST matching heading was read. The
 * remedy the message asked for was to prepend "- ", which adds no
 * specification. Any non-heading content now satisfies (a); judging whether the
 * criteria are GOOD stays review's job and a human's.
 */
// A word character, not merely any non-whitespace: round 2's `/\S/` admitted a
// section whose only content was `---`, `***` or a stray backtick — markdown
// that renders as nothing readable — and `---` between sections is a routine
// template idiom. Still prose-friendly, still not a magic word.
const CHECKABLE = /\w/;

/** Paths that are implementation surfaces in this repo. */
// `*` not `+` after the slash: naming a DIRECTORY (`scripts/`) is a legitimate
// way to say what a change touches, and requiring a filename refused it.
// Also matched after a blob permalink of THIS repository, which is a normal way
// to name a file (round 1 found a permalink yielding no surface at all). The
// owner/repo segments are required: round 2 ignored them, so a permalink into
// vfkb-claude-plugin — or any host — contributed a path that was then validated
// against THIS repo and printed as a local surface. This repo genuinely routes
// cross-repo issues (#175–#177), so that was reachable, not theoretical.
const THIS_REPO_BLOB = String.raw`github\.com\/vilosource\/vfkb\/blob\/[\w.-]+\/`;
const SURFACE = new RegExp(String.raw`(?:^|[\s\`(]|${THIS_REPO_BLOB})((?:src|test|tests|scripts|scenarios|docs\/templates|\.claude|\.github)\/[\w./-]*)`, 'g');
/** A governing decision document. */
const GOVERNING = /(?:^|[\s`(])(docs\/(?:adr|rfc)\/(?:ADR|RFC)-[\w./-]+\.md)/gi;
/** A bare reference like "ADR-0075" or "RFC-039" with no path. */
// `find` anchors on the full `ADR-0075-` prefix: round 1 had `ADR-007` (which
// does not exist) resolving to ADR-0070 via a bare `startsWith`, admitting the
// issue AND printing a decision it never cited. The anchor is the whole fix —
// narrowing this to \d{4} as well was tried and its mutation changed nothing,
// so it was reverted rather than carried as an unpinned guard; the wider match
// also gives the better refusal ("could not be found: ADR-007" rather than
// "no governing ADR at all"). Case-insensitive to match GOVERNING — `Per
// adr-0075.` was refused before.
const BARE_DECISION = /\b((?:ADR|RFC)-\d{3,4})\b/gi;

/**
 * Only text a HUMAN SEES on the issue counts. Round 1 admitted an issue whose
 * entire visible body was "Please fix the thing. It is broken." because a
 * nine-line HTML comment carried requirements, a surface and an ADR — the
 * source-text-guard class ADR-0070 §1 bans, already on this repo's record twice
 * (reviews/c2ab99e005*, reviews/0a2fcf8b4e*) and the worked example of a
 * blocking finding in reviews/README.md.
 *
 * ONLY HTML COMMENTS ARE STRIPPED, and that is the whole rule. Round 2 also
 * stripped fenced code blocks; round 3 removed that, because a fenced block
 * RENDERS — a reader sees it — so requirements written inside one are visible
 * and admitting them is correct. The stripper was also subtly wrong (it ate the
 * opener and one line, so its own pins passed for the wrong reason), and a
 * wrong stripper only ever causes FALSE REFUSALS about text the author can see.
 * Verified against GitHub's own renderer (`POST /markdown`, mode=gfm) rather
 * than assumed: an unclosed `<!--` really does hide everything after it, so
 * strip-to-end is right; `<!-->` and `<!--->` close IMMEDIATELY and hide
 * nothing; nested comments and `&lt;!--` entities render visibly.
 *
 * A collapsed <details> is KEPT: folded is not hidden — a reader can open it,
 * and this repo's own issues use it for legitimate detail.
 *
 * Known and accepted: a comment written INSIDE a fence renders literally but is
 * stripped here. It costs a refusal about visible text in a shape nobody uses;
 * the alternative is a markdown parser, which is a larger dependency than the
 * problem.
 */
export const visibleText = (body) => String(body ?? '')
  .replace(/<!--+>/g, '\n')                    // <!--> and <!---> close immediately
  .replace(/<!--[\s\S]*?(?:-->|$)/g, '\n');

const uniq = (a) => [...new Set(a)];
const matches = (body, re) => uniq([...String(body).matchAll(re)].map((m) => m[1]));

/**
 * @param body   the issue body
 * @param has    (path) => boolean — does this path exist in the repo?
 * @param find   (decision) => string|null — resolve "ADR-0075" to its file
 * @returns {{ok: boolean, problems: string[], surfaces: string[], governing: string[]}}
 */
export function admit(body, { has, find }) {
  const text = visibleText(body);
  const problems = [];

  // (a) acceptance criteria — structural only
  const lines = text.split('\n');
  const headings = lines.map((l, i) => (CRITERIA_HEADING.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!headings.length) {
    problems.push('No acceptance criteria. Add a section headed "Acceptance criteria" (or "Done when") listing what must be true for this to be finished.');
  } else {
    // EVERY matching heading, not the first: #306 carries a blockquote criterion
    // under one heading and bullets under a later one, and first-heading-wins
    // refused it.
    const filled = headings.some((h) => {
      const after = lines.slice(h + 1);
      const stop = after.findIndex((l) => /^#{1,4}\s/.test(l));
      return (stop === -1 ? after : after.slice(0, stop)).some((l) => CHECKABLE.test(l));
    });
    if (!filled) {
      problems.push('The acceptance-criteria section has no content — the heading is there but nothing follows it. Say what must be true for this to be finished.');
    }
  }

  // (b) surfaces — verified against the repo, not judged
  // `..` is rejected outright: round 1 showed `src/../../../../../../etc/passwd`
  // satisfying clause (b), so the referent was the whole filesystem rather than
  // "the repository itself" the header claims.
  const named = matches(text, SURFACE).map((p) => p.replace(/\/$/, ''));
  const traversing = named.filter((p) => p.split('/').includes('..'));
  const surfaces = named.filter((p) => !traversing.includes(p));
  if (traversing.length) {
    problems.push(`A surface must be inside the repository — these climb out of it: ${traversing.map((p) => `\`${p}\``).join(', ')}`);
  }
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
  for (const d of bare) { const f = find(d.toUpperCase()); if (f) resolved.push(f); else unresolved.push(d); }
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
// `gh`, not an absolute Homebrew path: the sibling resolves it through PATH
// (reproduction-gate.mjs), which is what makes it macOS-independent AND lets the
// selftest drive the real driver behind a shim — round 1's M1/M3 pair.
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

/**
 * The repository root, from git rather than from the caller's cwd. Round 1: run
 * from anywhere but the root, `repoProbes` refused EVERY issue while asserting
 * that `src/engine.ts` does not exist — and the gate's only intended consumer
 * (D3/D4's orchestrator) polls from its own directory or a per-issue worktree.
 * Realpath'd because git always answers with realpaths.
 */
export function repoRoot(start = dirname(fileURLToPath(import.meta.url))) {
  // Anchored on THIS SCRIPT's directory, not the caller's cwd: the gate ships
  // inside the repository it checks, so its own location is the one referent
  // that is right from anywhere. `git -C <scripts/>` then yields the root even
  // when the caller is outside the repo entirely, which cwd-anchoring could not
  // recover from — from $HOME it refused every issue.
  try { return realpathSync(execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()); }
  catch { return realpathSync(resolve(start, '..')); }
}

/**
 * Is this the repository the gate belongs to? Identity, not shape: a first
 * attempt checked for `scripts/admission-gate.mjs` + `docs/adr/` and a foreign
 * repo satisfied it BECAUSE it had vendored the gate — the very case round-2 M4
 * names (a consumer repo, or D5's pre-seeded worktree). package.json's name is
 * the thing a copy does not bring with it.
 */
export const looksLikeThisRepo = (root) => {
  try { return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).name === '@viloforge/vfkb'; }
  catch { return false; }
};

export function repoProbes(root = repoRoot()) {
  const has = (p) => existsSync(resolve(root, p));
  const find = (decision) => {
    const [kind, num] = decision.split('-');
    const dir = kind.toUpperCase() === 'ADR' ? 'docs/adr' : 'docs/rfc';
    try {
      // readdirSync, not `ls`: no process per citation and no dependence on ls
      // output shape (round 1 m7). The trailing `-` is M4's fix: without it
      // `ADR-007` matched `ADR-0070-…`.
      const hit = readdirSync(resolve(root, dir)).find((f) => f.startsWith(`${kind.toUpperCase()}-${num}-`));
      return hit ? `${dir}/${hit}` : null;
    } catch { return null; }
  };
  return { has, find };
}

export function main(argv = process.argv.slice(2)) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  // The root is asserted, not assumed. `git rev-parse` answers for whatever repo
  // the script currently sits in, so a vendored or copied gate validated an
  // issue's surfaces AND its ADR against a DIFFERENT repository, printing a
  // governing document from that repository as if the issue had cited it
  // (round-2 M4). Round 1's M2 was the same silence in the other direction.
  const root = arg('--repo', null) ? resolve(arg('--repo', null)) : repoRoot();
  if (!looksLikeThisRepo(root)) {
    console.error(`admission-gate FAILED — ${root} does not look like the vfkb repository (no scripts/admission-gate.mjs + docs/adr).`);
    console.error('Refusing to validate an issue\'s surfaces against a repository it does not belong to. Pass --repo <path>.');
    return 1;
  }
  const bodyFile = arg('--body-file', null);
  const issue = argv.find((a) => /^\d+$/.test(a));

  let body, label;
  if (bodyFile) { body = readFileSync(bodyFile, 'utf8'); label = bodyFile; }
  else if (issue) {
    try { body = JSON.parse(gh('issue', 'view', issue, '--json', 'body')).body ?? ''; label = `#${issue}`; }
    catch { console.error(`admission-gate FAILED — could not read issue #${issue}. Refusing to admit an issue it cannot see.`); return 1; }
  } else { console.error('usage: admission-gate.mjs <issue-number> | --body-file <path>'); return 2; }

  const { ok, problems, surfaces, governing } = admit(body, repoProbes(root));
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

// REALPATHS BOTH SIDES. `import.meta.url` is realpath'd by Node while
// `process.argv[1]` is whatever the caller spelled, so invoked through a
// symlinked checkout — or any /tmp or /var path on macOS — the two differed,
// main() never ran, and the script exited 0 PRINTING NOTHING. 0 is this gate's
// dispatchable signal, so an orchestrator invoking it from outside the repo
// (which is now the expected case) would have dispatched the whole backlog.
// The quiet-success trap of ADR-0051 §3, and this repo's own recorded
// realpath gotcha for the fourth time.
const realOrSelf = (f) => { try { return realpathSync(f); } catch { return f; } };
if (process.argv[1] && realOrSelf(fileURLToPath(import.meta.url)) === realOrSelf(process.argv[1])) process.exit(main());
