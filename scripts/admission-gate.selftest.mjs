#!/usr/bin/env node
// ============================================================================
// Selftest for the admission gate. "A Brake nobody has watched fail is a Brake
// nobody knows is connected" (scripts/review-gate.mjs).
//
// Both halves are pinned. A gate that blocks honest work is a defect (ADR-0052),
// and an ADMISSION gate with that flaw is the worst kind: it turns "specify your
// issue" into "guess my magic heading", which is what the first draft did — it
// demanded a literal "Acceptance criteria" heading and matched ZERO of this
// repo's 36 real issues. The vocabulary below is the one the corpus actually
// uses, and the honest-work cases are drawn from real issue shapes.
//
// Per brain gotcha 1af189641750, "observed red" is a floor: every check here is
// written so that DELETING its detector makes it fail. Verify that when editing.
//
//   node scripts/admission-gate.selftest.mjs
// ============================================================================
import { admit, repoProbes, repoRoot, looksLikeThisRepo, main, renderViaGitHub, visibleTextFromHtml } from './admission-gate.mjs';

import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failed = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${label}${ok ? '' : ` — wanted ${want}, got ${got}`}`);
};

// ── THE RENDERER IS REPLAYED, NOT MOCKED ────────────────────────────────────
// The gate's visibility layer is GitHub's own renderer, so every case here needs
// rendered HTML. Rendering live on every run would make the selftest need the
// network and make its result depend on the day; so the corpus is rendered ONCE
// into scripts/fixtures/admission-render.json and replayed.
//
// A cache MISS is fatal, never a silent fallback to the live API: if it were a
// fallback, an offline run and a networked run would mean different things and a
// stale fixture would pass. `--live` renders everything through GitHub instead
// and is how the cache is re-verified against the real oracle.
//   node scripts/build-admission-fixtures.mjs        # after adding a case
//   node scripts/admission-gate.selftest.mjs --live  # re-verify the cache
const LIVE = process.argv.includes('--live');
const COLLECT = process.env.ADM_MISS_FILE;   // used only by the fixture builder
const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/admission-render.json');
const fixtures = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : {};
const key = (body) => createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex').slice(0, 32);
let misses = 0;
let oracleDown = 0;
const render = (body) => {
  if (LIVE) {
    // THE SAME LESSON THE DRIVER LEARNED: a measurement that did not happen is
    // not a verdict. This arm exists to detect FIXTURE DRIFT; if the oracle is
    // unreachable — an incident, a secondary rate limit, a fork PR with no
    // token — nothing drifted and saying so would be a false accusation
    // against every PR in the repo (round-6 MAJOR 2).
    try { return renderViaGitHub(body); }
    catch (e) { oracleDown++; console.log(`SKIP  oracle unreachable for one body: ${String(e?.message ?? e).split('\n')[0].slice(0, 80)}`); return fixtures[key(body)] ?? '<p></p>'; }
  }
  const hit = fixtures[key(body)];
  if (hit !== undefined) return hit;
  if (COLLECT) { appendFileSync(COLLECT, `${JSON.stringify(String(body ?? ''))}\n`); return '<p></p>'; }
  misses++; failed++;
  console.log(`FAIL  RENDER FIXTURE MISSING for key ${key(body)} — run: node scripts/build-admission-fixtures.mjs`);
  return '<p></p>';
};

// A repo where src/, test/, scripts/ and two decisions exist.
const REAL = new Set(['src', 'src/engine.ts', 'test', 'test/a.test.ts', 'scripts', 'docs/adr/ADR-0075-the-software-factory.md']);
const probes = {
  has: (p) => REAL.has(p),
  find: (d) => (d === 'ADR-0075' ? 'docs/adr/ADR-0075-the-software-factory.md' : null),
};
const probesR = { ...probes, render };
const ok = (body) => admit(body, probesR).ok;
const why = (body) => admit(body, probesR).problems.join(' | ');

const FULL = `Some context about the bug.

## Acceptance criteria
- [ ] \`src/engine.ts\` stops throwing on an empty brain

## Surfaces
- \`src/engine.ts\`
- \`test/a.test.ts\`

Governing: \`ADR-0075\`
`;

console.log('--- a complete issue is dispatchable ---');
check('the full shape passes', ok(FULL), true);

console.log('\n--- each requirement is INDEPENDENTLY load-bearing ---');
check('drop the criteria section → refused', ok(FULL.replace(/## Acceptance criteria\n- \[ \].*\n/, '')), false);
check('drop the surfaces → refused', ok('## Acceptance criteria\n- [ ] it works\n\nGoverning: `ADR-0075`\n'), false);
check('drop the governing decision → refused', ok(FULL.replace('Governing: `ADR-0075`', '')), false);
check('empty criteria section → refused', ok(FULL.replace('- [ ] `src/engine.ts` stops throwing on an empty brain', '')), false);

console.log('\n--- existence is VERIFIED, not assumed (the authoritative half) ---');
check('a surface whose DIRECTORY does not exist → refused', ok(FULL.replace('src/engine.ts', 'src/nowhere/deep.ts')), false);
check('...and the message names the path', why(FULL.replace('src/engine.ts', 'src/nowhere/deep.ts')).includes('src/nowhere/deep.ts'), true);
check('a file that does not exist YET but whose dir does → allowed', ok(FULL.replace('src/engine.ts', 'src/brand-new.ts')), true);
check('a cited ADR that does not exist → refused', ok(FULL.replace('ADR-0075', 'ADR-9999')), false);
check('...and the message names it', why(FULL.replace('ADR-0075', 'ADR-9999')).includes('ADR-9999'), true);
check('a full ADR path that exists → accepted', ok(FULL.replace('`ADR-0075`', '`docs/adr/ADR-0075-the-software-factory.md`')), true);

console.log('\n--- the heading vocabulary THIS REPO uses (first draft matched none of it) ---');
const withHeading = (h) => `## ${h}\n- rewrite the thing\n\nTouches \`src/engine.ts\`. Governing \`ADR-0075\`.\n`;
for (const h of ['Acceptance criteria', 'Done when', 'Definition of done', 'Requirements', 'Suggested fix', 'Proposed fix', 'Fix shape', 'What would resolve it', 'The property to assert', 'Scope']) {
  check(`"${h}" is recognised`, ok(withHeading(h)), true);
}
check('a heading with no items under it → refused', ok('## Suggested fix\n\n## Something else\n\n`src/engine.ts` `ADR-0075`\n'), false);

console.log('\n--- checkable items in the forms people write them ---');
for (const [label, item] of [['task box', '- [ ] do the thing'], ['ticked box', '- [x] done already'], ['bullet', '- do the thing'], ['star bullet', '* do the thing'], ['numbered', '1. do the thing']]) {
  check(`${label} counts as checkable`, ok(`## Requirements\n${item}\n\n\`src/engine.ts\` \`ADR-0075\`\n`), true);
}

console.log('\n--- honest issue shapes must not be blocked ---');
check('surfaces mentioned in prose rather than a list', ok('## Suggested fix\n- guard it\n\nThe change is in `src/engine.ts`, per `ADR-0075`.\n'), true);
check('a directory named instead of a file', ok('## Requirements\n- add a Brake\n\nTouches `scripts/` per `ADR-0075`.\n'), true);
check('multiple decisions cited, one real', ok('## Requirements\n- x\n\n`src/engine.ts`, per `ADR-0075` and `RFC-999`.\n'), true);
check('a body with no markdown headings at all → refused (not crashed)', ok('just do the thing in src/engine.ts'), false);
check('an empty body → refused, not crashed', ok(''), false);
check('a null body → refused, not crashed', ok(null), false);

check('a surface named in a blob permalink is seen', ok('## Requirements\n- x\n\nhttps://github.com/vilosource/vfkb/blob/main/src/engine.ts\n\nADR-0075\n'), true);

console.log('\n--- A PERMALINK MUST NAME **THIS** REPOSITORY (round-2 M5) ---');
check('a permalink into another repo is NOT a surface here', ok('## Requirements\n- x\n\nhttps://github.com/vilosource/vfkb-claude-plugin/blob/main/src/engine.ts\n\nADR-0075\n'), false);
check("...nor another host's", ok('## Requirements\n- x\n\nhttps://github.com/evil/other/blob/v1.2.3/scripts/thing.mjs\n\nADR-0075\n'), false);
check('this repo\'s own permalink still is', ok('## Requirements\n- x\n\nhttps://github.com/vilosource/vfkb/blob/main/src/engine.ts\n\nADR-0075\n'), true);

console.log('\n--- the refusal is ACTIONABLE, which is the point ---');
check('a bare issue names all three missing things', admit('help', probesR).problems.length === 3, true);
check('...and says what to add, not just what is wrong', why('help').includes('Add a section headed'), true);

console.log('\n--- ONLY VISIBLE TEXT COUNTS (round-1 B1) ---');
// An issue whose visible body was "Please fix the thing" was admitted because a
// nine-line HTML comment carried all three requirements. That is the
// source-text-guard class ADR-0070 §1 bans, and reviews/README.md's own worked
// example of a blocking finding.
const HIDDEN = 'Please fix the thing. It is broken.\n';
const PAYLOAD = '## Requirements\n- [ ] x\n\n`src/engine.ts`\n\nADR-0075\n';
check('requirements buried in an HTML comment do NOT admit', ok(`${HIDDEN}\n<!--\n${PAYLOAD}-->\n`), false);
check('an UNCLOSED HTML comment does not admit either', ok(`${HIDDEN}\n<!--\n${PAYLOAD}`), false);
// A fenced block RENDERS — a reader sees it — so requirements inside one are
// visible and admitting them is correct. Round 2 stripped fences; its stripper
// ate the opener and ONE line, so its own pins passed for the wrong reason
// (round-2 M2), and a wrong stripper only ever causes false refusals about text
// the author can see. Round 3 stopped stripping them, and pins the reversal.
check('requirements inside a fenced code block DO admit — a fence is visible', ok(`${HIDDEN}\n\`\`\`\n${PAYLOAD}\`\`\`\n`), true);
check('...including past the first line of the fence (round-2 M2: only 1 line was eaten)', ok(`${HIDDEN}\n\`\`\`\nfiller\nfiller\n${PAYLOAD}\`\`\`\n`), true);
check('a tilde-fenced block admits too', ok(`${HIDDEN}\n~~~\n${PAYLOAD}~~~\n`), true);
// <!--> and <!---> close IMMEDIATELY — verified against GitHub's own renderer —
// so they hide nothing. Round 2 treated them as unclosed and erased the whole
// body, refusing an issue that visibly had all three requirements (round-2 M3).
check('an abrupt-closing <!--> hides nothing', ok(`<!-->\n${PAYLOAD}`), true);
check('<!---> likewise', ok(`<!--->\n${PAYLOAD}`), true);
check('a real unclosed <!-- still hides everything after it', ok(`${HIDDEN}\n<!--\n${PAYLOAD}`), false);
// <details> is FOLDED, not hidden — a reader can open it, and this repo's issues
// use it for legitimate detail. Kept on purpose, and pinned so the choice is visible.
check('a collapsed <details> DOES admit — folded is not hidden', ok(`${HIDDEN}\n<details><summary>detail</summary>\n\n${PAYLOAD}</details>\n`), true);
check('a fence inside the criteria section does not erase the section', ok('## Requirements\n- [ ] x\n\n```\nsome sample output\n```\n\n`src/engine.ts` `ADR-0075`\n'), true);

console.log('\n--- CRITERIA MAY BE PROSE, AND EVERY HEADING IS SCANNED (round-1 B2) ---');
// All 6 "empty section" refusals on the real corpus were false: the sections were
// prose or blockquotes. Demanding a bullet was the magic-word anti-pattern the
// header warns about, one level down.
check('a prose criteria section is enough', ok('## Suggested fix\n\nTighten the predicate so doctor exits non-zero when the hook is missing.\n\n`src/engine.ts` `ADR-0075`\n'), true);
check('a blockquote criteria section is enough', ok('## The property to assert\n\n> Every declared field carries its own `.catch()`.\n\n`src/engine.ts` `ADR-0075`\n'), true);
// #306's exact shape: a blockquote under the FIRST matching heading and bullets
// under a LATER one. first-heading-wins refused the best-specified issue in the corpus.
check('#306 shape: content under a LATER matching heading counts', ok('## Scope\n\n## Requirements\n\n- [ ] make it stop throwing\n\n`src/engine.ts` `ADR-0075`\n'), true);
check('a heading followed only by another heading is still refused', ok('## Suggested fix\n\n## Not in scope\n\n`src/engine.ts` `ADR-0075`\n'), false);
check('...and the message no longer calls a full section "empty"', !why('## Suggested fix\n\n## Not in scope\n\n`src/engine.ts` `ADR-0075`\n').includes('is empty'), true);

// Round 2's /\S/ was the maximally permissive reading and admitted markdown that
// renders as nothing readable — and `---` between sections is a routine template
// idiom (round-2 M6). A word character is the floor; still prose, still no magic word.
check('a horizontal rule is not acceptance criteria', ok('## Requirements\n\n---\n\n## Other\n\n`src/engine.ts` `ADR-0075`\n'), false);
check('a lone backtick is not acceptance criteria', ok('## Requirements\n\n`\n\n## Other\n\n`src/engine.ts` `ADR-0075`\n'), false);
check('*** is not acceptance criteria', ok('## Requirements\n\n***\n\n## Other\n\n`src/engine.ts` `ADR-0075`\n'), false);
check('one real word IS enough', ok('## Requirements\n\nStop throwing.\n\n`src/engine.ts` `ADR-0075`\n'), true);

console.log('\n--- A SURFACE IS INSIDE THE REPOSITORY (round-1 M5) ---');
// With the stub probes this was vacuous — has() rejected the traversing path
// anyway, so only the message pin was load-bearing (round-2 minor). Real probes
// resolve `src/../../../../../../etc/passwd` to a file that EXISTS, so the
// refusal has to come from the traversal check itself.
check('.. climbing out of the repo is refused, against REAL probes', admit('## Requirements\n- x\n\n`src/../../../../../../etc/passwd`\n\nADR-0075\n', { ...repoProbes(), render }).ok, false);
check('...and the message says it climbs out', why('## Requirements\n- x\n\n`src/../../../.ssh`\n\nADR-0075\n').includes('climb out of it'), true);
check('a legitimate path containing dots is fine', ok('## Requirements\n- x\n\n`src/engine.ts`\n\nADR-0075\n'), true);

console.log('\n--- A CITED DECISION IS THE ONE THAT EXISTS (round-1 M4, m3) ---');
// Against the REAL repo, not the stub: with `\d{3,4}` and an unanchored
// startsWith, `ADR-007` resolved to ADR-0070 and the gate admitted the issue
// while printing a decision it never cited (round-1 M4). A stub that only knows
// ADR-0075 would answer null either way, so the pin has to use real probes.
check('ADR-007 does not resolve to a real ADR (3 digits are not a citation)', admit('## Requirements\n- x\n\n`src/engine.ts`\n\nADR-007\n', { ...repoProbes(), render }).ok, false);
check('...and a full 4-digit citation still resolves', admit('## Requirements\n- x\n\n`src/engine.ts`\n\nADR-0070\n', { ...repoProbes(), render }).ok, true);
check('lowercase adr-0075 is recognised', ok('## Requirements\n- x\n\n`src/engine.ts`\n\nPer adr-0075.\n'), true);

console.log('\n--- THE REAL DRIVER, NOT JUST admit() (round-1 M1/M2/M3) ---');
// repoProbes/main/the gh call were executed by nothing, which is what hid M2.
// Driven here the way CI does, with gh behind a PATH shim — the sibling gate's
// pattern (reproduction-gate.selftest.mjs).
const shim = mkdtempSync(join(tmpdir(), 'adm-gh-'));
// The shim answers only `gh issue view <n> --json body`, and answers in the
// shape the gate parses — JSON with a `body` field. Anything else exits 2, so a
// gate that asked for the wrong thing is observed rather than silently passing.
// ── THE SHIM IS CONTENT-ADDRESSED, NOT A CANNED ANSWER ──────────────────────
// It stands in for GitHub — the gate's two calls and nothing else — and round 7
// showed why fidelity matters more than brevity. The previous shell version
// discarded stdin and matched on "$1 $2" only, so it could not tell one body
// from another and ignored the Accept header entirely: `preRendered` and the
// `vnd.github.html+json` header were both unpinnable through it, and the two
// SPAWNED cases could not use it at all (they would have received whatever
// render was staged last). So it is a node script that serves the SAME fixture
// cache by sha256 of the body, and REQUIRES the header the driver must send.
// An unknown body or a missing header exits 2, which is what makes a wrong call
// observable instead of silently answered.
writeFileSync(join(shim, 'gh'), `#!/usr/bin/env node
const { readFileSync, existsSync } = require('node:fs');
const { createHash } = require('node:crypto');
const a = process.argv.slice(2);
const fail = (m) => { process.stderr.write('shim: ' + m + '\\n'); process.exit(2); };
const cache = JSON.parse(readFileSync(${JSON.stringify(fixturePath)}, 'utf8'));
const key = (b) => createHash('sha256').update(String(b ?? ''), 'utf8').digest('hex').slice(0, 32);
if (process.env.GH_RENDER_EXIT && process.env.GH_RENDER_EXIT !== '0') process.exit(Number(process.env.GH_RENDER_EXIT));
// the issue, with its rendered body_html — the gate's only call for an issue
if (a[0] === 'api' && /^repos\\/[^{]/.test(a[1] || '') && /\\/issues\\/\\d+$/.test(a[1])) {
  // The slug must be LITERAL. \`repos/{owner}/{repo}/…\` makes gh resolve from the
  // caller's cwd, which fetched another repository's issue and returned a PASS
  // (round-7 M1); the shim refuses the placeholder so that is observable.
  if (process.env.GH_FAKE_404) { process.stderr.write('gh: HTTP 404: Not Found\\n'); process.exit(1); }
  if (process.env.GH_FAKE_UNREADABLE) process.exit(1);
  if (!a.some((x) => String(x).includes('vnd.github.html+json'))) fail('issue fetched without the html+json Accept header');
  process.stdout.write(readFileSync(process.env.ADM_FAKE_ISSUE, 'utf8'));
  process.exit(0);
}
// POST /markdown, for --body-file only: answer for the body actually sent
if (a[0] === 'api' && a.includes('/markdown')) {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { raw = ''; }
  if (!raw) fail('/markdown called with no payload on stdin');
  const text = JSON.parse(raw).text;
  const hit = cache[key(text)];
  if (hit === undefined) fail('no recorded render for this body — run build-admission-fixtures.mjs');
  process.stdout.write(hit);
  process.exit(0);
}
fail('unexpected call: ' + a.join(' '));
`);
chmodSync(join(shim, 'gh'), 0o755);
const bodyFile = join(shim, 'body.md');
const htmlFile = join(shim, 'render.html');
const issueFile = join(shim, 'issue.json');
/**
 * Point the shim's /markdown answer at the recorded render of `body`. Goes
 * through the same `render()` the direct checks use, so a driver body is
 * collected into the fixture cache exactly like any other and cannot silently
 * fall back to an empty document.
 */
const stageRender = (body) => {
  const html = render(body);
  writeFileSync(htmlFile, html);
  // The issue path receives the SAME html as body_html, so the driver pins
  // exercise the reader's surface rather than a second rendering of it.
  writeFileSync(issueFile, JSON.stringify({ number: 42, body_html: html }));
};
const runMain = (argv, env = {}) => {
  // Restores EVERY key it sets, not just PATH. An earlier version assigned the
  // caller's env and restored only two keys, so GH_RENDER_EXIT=1 from the
  // render-failure check leaked into every later run and made a passing case
  // look broken — a leaked environment changing what a later assertion means,
  // which is the same defect class this branch keeps producing.
  const set = { PATH: `${shim}:${process.env.PATH}`, ADM_FAKE_BODY: bodyFile, ADM_FAKE_HTML: htmlFile, ADM_FAKE_ISSUE: issueFile, ...env };
  const prev = Object.fromEntries(Object.keys(set).map((k) => [k, process.env[k]]));
  Object.assign(process.env, set);
  const q = console.log, qe = console.error; const lines = [];
  console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  let code;
  // main() THROWING is itself a finding: every exit is supposed to be one of the
  // four documented codes, and an uncaught exception would reach a caller as
  // Node's default 1 — which this contract defines as a verdict about the issue.
  // Reported as -1 so a pin can say "not a crash" rather than the suite dying.
  try { code = main(argv); } catch (e) { code = -1; lines.push(`THREW: ${e?.message ?? e}`); }
  finally {
    console.log = q; console.error = qe;
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  return { code, out: lines.join('\n') };
};
writeFileSync(bodyFile, JSON.stringify({ body: PAYLOAD })); stageRender(PAYLOAD);
const viaGh = runMain(['42']);
check('main() reads an issue through gh on PATH and admits a good one', viaGh.code === 0 && /PASSED — dispatchable/.test(viaGh.out), true);
writeFileSync(bodyFile, JSON.stringify({ body: 'help' })); stageRender('help');
const viaGhBad = runMain(['42']);
check('...and refuses a bare one, exit 1', viaGhBad.code === 1 && /NOT DISPATCHABLE/.test(viaGhBad.out), true);
check('main() with no argument is a usage error, exit 2', runMain([]).code === 2, true);

// M2: the gate must work from any cwd, because its consumer polls from its own.
// The root comes from the SCRIPT's location, so this holds even outside the repo.
const root = repoRoot();
check('repoRoot() finds this repository', existsSync(join(root, 'scripts/admission-gate.mjs')), true);
const here = process.cwd();
try {
  process.chdir(tmpdir());
  const pr = repoProbes();
  check('repoProbes resolves real paths from an unrelated cwd', pr.has('src/engine.ts'), true);
  check('...and resolves a real decision from there too', pr.find('ADR-0075') !== null, true);
  check('...and still says no to a path that does not exist', pr.has('src/definitely-not-here.ts'), false);
  writeFileSync(bodyFile, JSON.stringify({ body: PAYLOAD })); stageRender(PAYLOAD);
  check('main() admits from an unrelated cwd (it refused everything before)', runMain(['42']).code === 0, true);
} finally { process.chdir(here); }
check('find() will not accept a truncated decision number', repoProbes().find('ADR-007'), null);

console.log('\n--- THE CLASS THREE ROUNDS COULD NOT CLOSE, CLOSED BY THE ORACLE ---');
// Each of these is a shape that DEFEATED a hand-written visibility layer, and
// each renders to nothing on GitHub. None needed a pattern of its own: the
// renderer drops them, so the detectors never see them. That is the property the
// redesign is for — if a future shape needs a new pattern here, the redesign has
// failed and the operator should be told.
const HID = 'Please fix it.\n';
const REQ = '## Requirements\n- [ ] x\n\n`src/engine.ts`\n\nADR-0075\n';
for (const [label, body] of [
  ['an HTML comment (round-1 B1)', `${HID}\n<!--\n${REQ}-->\n`],
  ['an UNCLOSED HTML comment', `${HID}\n<!--\n${REQ}`],
  ['a processing instruction <?…?> (round-3 B1)', `${HID}\n<?php\n${REQ}?>\n`],
  ['a CDATA section (round-3 B1)', `${HID}\n<![CDATA[\n${REQ}]]>\n`],
  ['a declaration block <!X … > with no blank line (found after round 3)', `${HID}\n<!X\n${REQ}>\n`],
  ['a link-reference definition (found after round 3)', '## Requirements\n\nfix it\n\n[a]: src/engine.ts "ADR-0075"\n'],
  ['a path only in a link target, invisible to a reader', '## Requirements\n\nfix it\n\n[here](src/engine.ts "ADR-0075")\n'],
]) check(`hidden in ${label} → NOT dispatchable`, ok(body), false);

// The other direction, pinned just as hard: everything GitHub DOES render is
// visible, so admitting it is correct. Round 2 broke this by stripping fences.
for (const [label, body] of [
  ['a fenced code block', `${HID}\n\`\`\`\n${REQ}\`\`\`\n`],
  ['a fence with an info string, payload past line 2', `${HID}\n\`\`\`text\nfiller\nfiller\n${REQ}\`\`\`\n`],
  ['a collapsed <details> — folded is not hidden', `${HID}\n<details><summary>d</summary>\n\n${REQ}</details>\n`],

  ['an abrupt-closing <!--> comment', `<!-->\n${REQ}`],
  // The whole payload must be INSIDE the blockquote: the earlier version put the
  // surface and decision in a paragraph after it, so it passed with the quote's
  // contents entirely hidden and asserted nothing (round-5 M5).
  ['a blockquote criterion, payload inside the quote', '## The property to assert\n\n> every field carries its own catch in `src/engine.ts` per `ADR-0075`\n'],
]) check(`visible in ${label} → dispatchable`, ok(body), true);

// Rendered blocks must stay separated: a surface in one paragraph and the
// decision in the next arrive as <p>src/engine.ts</p><p>ADR-0075</p>, and without
// a newline between them the text fuses to "src/engine.tsADR-0075", where \b no
// longer precedes the citation and the decision is silently missed. This is the
// shape a person writes by hand, so the false refusal would be routine.
// GitHub emits an author-written <br> with NO following newline, so without the
// break-to-newline pass `src/engine.ts<br>ADR-0075` fuses and the citation loses
// its \b — a false refusal on a hand-written shape. Load-bearing but unpinned
// until round 4 found it: the fourth unpinned guard on this branch.
check('a hand-written <br> separates a surface from a decision', ok('## Requirements\n\n- fix it\n\nsrc/engine.ts<br>ADR-0075\n'), true);
check('a surface and a decision in ADJACENT blocks are both seen', ok('## Requirements\n\n- fix it\n\nsrc/engine.ts\n\nADR-0075\n'), true);

console.log('\n--- THE WALKER\'S DEFENSIVE PARTS, PINNED DIRECTLY (round-6 m7) ---');
// These branches are unreachable through the oracle — GitHub never emits them —
// so ok() cannot pin them and they were carried untested. visibleTextFromHtml
// is the only tool that can, and it was imported and unused.
const vis = (html) => visibleTextFromHtml(html).replace(/\s+/g, ' ').trim();
check('an unclosed counted tag still yields its text', vis('<p>MARK'), 'MARK');
check('a stray close tag with no open does not unwind the stack', vis('<p>A</span>B</p>').replace(' ', ''), 'AB');
check('mismatched nesting: </p> inside a div does not escape the block', vis('<div>hidden<p>x</div></p>'), '');
check('an attribute containing a quoted > does not end the tag early', vis('<div title="a>b">hidden</div>'), '');
check('...and the same on an allowed div', vis('<div class="highlight" title="a>b">shown</div>'), 'shown');
check('uppercase and spaced tags are matched', vis('<DIV >hidden</DIV >'), '');
check('a void img before the payload does not swallow it', vis('<p><img src="x">MARK</p>'), 'MARK');
// The div-class exception is token-based, so a class list can carry BOTH an
// allowed and a hidden token. Before round 6 that container emitted its payload
// — a hidden element admitted because it also said "highlight", the one
// direction this design exists to exclude. GitHub emits no such class today, so
// this fails closed against a shape it has not shipped (round-6 MINOR 4).
check('render-plaintext-hidden WITH highlight still hides', vis('<div class="render-plaintext-hidden highlight"><pre>MARK</pre></div>'), '');
check('highlight-source-mermaid WITH the hidden token still hides', vis('<div class="highlight highlight-source-mermaid render-plaintext-hidden"><pre>MARK</pre></div>'), '');
check('sr-only with an allowed token still hides', vis('<div class="highlight sr-only"><pre>MARK</pre></div>'), '');
check('a js-render-* token still hides', vis('<div class="highlight js-render-enrichment-target"><pre>MARK</pre></div>'), '');
check('...while a plain highlight div is still read', vis('<div class="highlight highlight-source-ts"><pre>MARK</pre></div>'), 'MARK');
check('a lookalike class is not the allowed one', vis('<div class="not-highlight"><pre>MARK</pre></div>'), '');
// The reader's surface is the issue's body_html, and it wraps a plain fenced
// block in snippet-clipboard-content — a class POST /markdown never emits.
// Round 6 measured the difference on #288 (round-6 MAJOR 3).
check('snippet-clipboard-content is read (it is body_html\'s fence wrapper)', vis('<div class="snippet-clipboard-content notranslate position-relative overflow-auto"><pre>MARK</pre></div>'), 'MARK');
check('...and the highlight div body_html emits, with its extra classes', vis('<div class="highlight highlight-source-yaml notranslate position-relative overflow-auto"><pre>MARK</pre></div>'), 'MARK');

console.log('\n--- THE FOUR EXIT CODES ARE DISTINCT (round-4 M4) ---');
writeFileSync(bodyFile, JSON.stringify({ body: PAYLOAD })); stageRender(PAYLOAD);
check('dispatchable is 0', runMain(['42']).code, 0);
writeFileSync(bodyFile, JSON.stringify({ body: 'help' })); stageRender('help');
check('under-specified is 1 — a verdict about the issue', runMain(['42']).code, 1);
check('no argument is 2', runMain([]).code, 2);
// An unreadable --body-file used to crash: readFileSync sat outside every try,
// so Node's default uncaught-exception code 1 was returned — and 1 is defined
// here as "the issue is under-specified, a verdict". A mistyped path would have
// been recorded as a spec failure for a body never read (round-6 MAJOR 1).
check('a --body-file that does not exist is 2, not a verdict', runMain(['--body-file', join(shim, 'no-such-file.md')]).code, 2);
check('a --body-file that is a directory is 2, not a verdict', runMain(['--body-file', shim]).code, 2);
check('...and neither THROWS — an uncaught error would reach a caller as exit 1', runMain(['--body-file', join(shim, 'no-such-file.md')]).code !== -1, true);
// 3 is the right family for a 404 (not a spec verdict), but an issue that does
// not exist never becomes readable, so the message must say escalate (m5).
const gone = runMain(['42'], { GH_FAKE_404: '1' });
check('a permanent 404 is 3', gone.code, 3);
check('...and tells the consumer to ESCALATE rather than retry', /ESCALATE, do not retry/.test(gone.out), true);
const flaky = runMain(['42'], { GH_FAKE_UNREADABLE: '1' });
check('a transient read failure says retry', /retry, then escalate/.test(flaky.out), true);

console.log('\n--- A NUMBERED OR LETTERED HEADING PREFIX IS PURE SPELLING (round-4 m4) ---');
check('"## 1. Requirements" is recognised', ok('## 1. Requirements\n\n- [ ] x\n\n`src/engine.ts`\n\nADR-0075\n'), true);
check('"## B) Done when" is recognised', ok('## B) Done when\n\n- [ ] x\n\n`src/engine.ts`\n\nADR-0075\n'), true);
// But a TOPIC heading is still refused: clause (a) asks for a section saying what
// must be TRUE when the work is done, and #310's shape does not. Deliberate, and
// stated in the header rather than left as an accident of the vocabulary.
check('a numbered TOPIC heading is still not acceptance criteria', ok('## 1. ADR-0075 cl. 4 — observe the gate RED in CI\n\nsome prose\n\n`src/engine.ts`\n\nADR-0075\n'), false);

console.log('\n--- THE ALLOWLIST: WE COUNT NODES, WE DO NOT GUESS WHAT GITHUB HIDES ---');
// Round 4 killed the strip-every-tag approach: <math-renderer> carries raw TeX
// SOURCE as its text, and ```mermaid falls back into a div GitHub literally
// names render-plaintext-hidden. Neither could be anticipated by a denylist, and
// GitHub ships new js-render-* types over time. These pin the inversion.
for (const [label, body] of [
  ['TeX in an invisible \\hphantom box', `${HID}\n## Requirements\n\n$$\\hphantom{ x src/engine.ts ADR-0075 }$$\n`],
  ['TeX in an inline \\phantom', `${HID}\n## Requirements\n\n$\\phantom{ x src/engine.ts ADR-0075 }$\n`],
  ['a TeX comment inside display math', `${HID}\n## Requirements\n\n$$1 % x src/engine.ts ADR-0075 $$\n`],
  ['a mermaid fence (render-plaintext-hidden)', `${HID}\n## Requirements\n\n\`\`\`mermaid\ngraph TD\n%% x src/engine.ts ADR-0075\nA-->B\n\`\`\`\n`],
  ['a geojson fence (same container)', `${HID}\n## Requirements\n\n\`\`\`geojson\n{"x": "src/engine.ts ADR-0075"}\n\`\`\`\n`],
  ['a bare <div>, which is also the enrichment scaffolding', `${HID}\n<div>\n\n${REQ}</div>\n`],
]) check(`hidden in ${label} → NOT dispatchable`, ok(body), false);

// The other direction: two wrappers GitHub puts around VISIBLE content. Both
// were REFUSED by the first allowlist and added because of it — the loud
// direction working. A table's cells and a footnote definition are read.
check('a markdown table\'s cells are read (markdown-accessiblity-table)', ok('## Requirements\n\n| what | where |\n| --- | --- |\n| stop throwing | `src/engine.ts` |\n\nADR-0075\n'), true);
check('a raw <table> is read too', ok('## Requirements\n\n<table><tr><td>fix `src/engine.ts` per ADR-0075</td></tr></table>\n'), true);
check('text directly inside <details>, outside any block, is read', ok('## Requirements\n\n<details><summary>s</summary>fix `src/engine.ts` per ADR-0075</details>\n'), true);
check('a footnote definition is read (it renders at the bottom)', ok('## Requirements\n\nfix it[^1]\n\n[^1]: `src/engine.ts` per ADR-0075\n'), true);
// section is transparent for footnotes; the enrichment fallback stays hidden
// because the inner div blocks it, which the mermaid pin above proves.

// Round 5: GitHub emits <div> from ORDINARY markdown in two shapes, and the
// first allowlist refused both — a fenced code block and GitHub's own callout
// syntax, neither involving hand-written HTML. Allowed by class; an unknown
// class still hides.
for (const [label, body] of [
  ['a ```ts fence (div.highlight-source-ts)', '## Requirements\n\n```ts\n// fix src/engine.ts per ADR-0075\n```\n'],
  ['a ```yaml fence', '## Requirements\n\n```yaml\nwhere: src/engine.ts\nwhy: ADR-0075\n```\n'],
  ['a ```diff fence', '## Requirements\n\n```diff\n- old src/engine.ts ADR-0075\n```\n'],
  ['a [!NOTE] alert (div.markdown-alert)', '## Requirements\n\n> [!NOTE]\n> fix `src/engine.ts` per `ADR-0075`\n'],
  ['a [!IMPORTANT] alert', '## Requirements\n\n> [!IMPORTANT]\n> fix `src/engine.ts` per `ADR-0075`\n'],
]) check(`visible in ${label} → dispatchable`, ok(body), true);
check('a div with any OTHER class still hides its subtree', ok(`${HID}\n<div class="something-else">\n\n${REQ}</div>\n`), false);

console.log('\n--- EVERY ELEMENT OF THE WALK IS LOAD-BEARING, AND PINNED (round-5 M4) ---');
// Five elements were load-bearing but uncovered: the suite stayed 108 ok under
// each mutation while a real verdict flipped. (d) is the one whose loss ADMITS
// rather than refuses, and it is what holds the hiding property for the nested
// same-name divs the enrichment scaffolding is built from.
check('blockquote is counted', ok('## Requirements\n\n> fix `src/engine.ts` per ADR-0075\n'), true);
check('summary is counted', ok('## Requirements\n\n<details><summary>fix `src/engine.ts` per ADR-0075</summary>x</details>\n'), true);
check('span is transparent', ok('## Requirements\n\n<span>fix `src/engine.ts` per ADR-0075</span>\n'), true);
// The stack unwinds to the LAST matching open tag: with indexOf, an inner
// </div> would close the OUTER div and the payload after it would be admitted
// while invisible — the only mutation in this family that fails open.
check('a payload after an inner </div> stays hidden (stack unwinds to the nearest)', ok(`${HID}\n<div>a<div>b</div>\n\n${REQ}</div>\n`), false);
// Compact HTML has no inter-tag newlines, so the close-tag newline is what
// keeps a cell's surface from fusing with the next cell's decision.
check('a one-line raw <table> keeps its cells apart', ok('## Requirements\n\n<table><tr><td>src/engine.ts</td><td>ADR-0075</td></tr></table>\n'), true);

console.log('\n--- A RENDER THAT DID NOT HAPPEN IS A REFUSAL, NEVER A PASS ---');
writeFileSync(bodyFile, JSON.stringify({ body: PAYLOAD })); stageRender(PAYLOAD);
const renderDown = runMain(['42'], { GH_RENDER_EXIT: '1' });
// A MISSING MEASUREMENT IS NOT A REFUSAL. These shared exit 1 until round 4
// (R4-M4), which would have let an orchestrator record an outage as a spec
// failure and send the issue back to its author. 3 means "no verdict".
check('the renderer failing is INCONCLUSIVE, exit 3 — not a refusal', renderDown.code === 3, true);
// For an ISSUE the read IS the render — one call to the issue API for its
// body_html — so the unreachable-oracle message is the read one. --body-file is
// the only path that still uses POST /markdown, and it reports "could not render".
check('...and says the measurement is missing, not that the issue is bad', /INCONCLUSIVE/.test(renderDown.out) && /could not read issue/.test(renderDown.out) && !/PASSED/.test(renderDown.out), true);
const bodyFileRenderDown = runMain(['--body-file', bodyFile], { GH_RENDER_EXIT: '1' });
check('--body-file with the renderer down is INCONCLUSIVE too, exit 3', bodyFileRenderDown.code === 3, true);
check('...and that one says "could not render"', /could not render/.test(bodyFileRenderDown.out), true);
check('an unreadable issue is INCONCLUSIVE too, exit 3', runMain(['42'], { GH_FAKE_UNREADABLE: '1' }).code === 3, true);

console.log('\n--- THE DRIVER ASKS FOR THE READER\'S SURFACE, EXPLICITLY (round-7 M3/M4) ---');
// The shim requires the html+json Accept header and answers per-body, so both
// are now observable. Without the header the gate would get no body_html, admit
// nothing, and refuse the whole backlog AS A VERDICT; with a canned render it
// could not tell one body from another.
writeFileSync(bodyFile, JSON.stringify({ body: PAYLOAD })); stageRender(PAYLOAD);
check('an issue is admitted through the issue API with the html+json header', runMain(['42']).code, 0);
writeFileSync(bodyFile, JSON.stringify({ body: 'help' })); stageRender('help');
check('...and a bare one is refused — the shim answered for THIS body', runMain(['42']).code, 1);

console.log('\n--- THE ROOT IS THIS REPOSITORY, ASSERTED (round-2 M4) ---');
check('this repo is recognised', looksLikeThisRepo(repoRoot()), true);
check('a directory with no package.json is not', looksLikeThisRepo(tmpdir()), false);
// The case round-2 M4 actually names: a repo that has VENDORED the gate. A first
// marker checked for scripts/admission-gate.mjs + docs/adr/ and this shape
// satisfied it, so the marker has to be identity, not structure.
const foreign = join(shim, 'foreign');
mkdirSync(join(foreign, 'scripts'), { recursive: true });
mkdirSync(join(foreign, 'docs/adr'), { recursive: true });
writeFileSync(join(foreign, 'scripts/admission-gate.mjs'), '// vendored copy\n');
// Deliberately made a repo that would otherwise SATISFY the gate: its own
// src/engine.ts and its own ADR-0075. Without that, main() at the foreign repo
// refuses for missing surfaces and the exit-code pin passes for the wrong
// reason — only the message pin would be load-bearing.
mkdirSync(join(foreign, 'src'), { recursive: true });
writeFileSync(join(foreign, 'src/engine.ts'), '// not this repo\n');
writeFileSync(join(foreign, 'docs/adr/ADR-0075-a-totally-different-decision.md'), '# different\n');
writeFileSync(join(foreign, 'package.json'), JSON.stringify({ name: 'some-consumer', version: '1.0.0' }));
check('a repo that VENDORED the gate is not this repository', looksLikeThisRepo(foreign), false);
// R3-M1: the three checks above exercise the PREDICATE. Deleting the guard that
// ACTS on it left 79/79 green — the third vacuous pin on this branch. This one
// drives main() at the foreign repo and asserts the effect.
writeFileSync(bodyFile, JSON.stringify({ body: PAYLOAD })); stageRender(PAYLOAD);
const atForeign = runMain(['42', '--repo', foreign]);
check('main() refuses to validate against a repo that is not this one, exit 3', atForeign.code === 3, true);
// m1: the message used to name the marker that had been REPLACED, telling an
// operator to create two files that would not help.
check('...and names the REAL predicate, package.json\'s name', /package\.json name is not/.test(atForeign.out) && !/PASSED/.test(atForeign.out), true);
check('...and echoes the --repo it was given', atForeign.out.includes(foreign), true);
const atReal = runMain(['42', '--repo', repoRoot()]);
check('main() with --repo at THIS repo still admits', atReal.code === 0, true);

console.log('\n--- THE SCRIPT ACTUALLY RUNS WHEN SPAWNED (round-2 B1: it exited 0 SILENTLY) ---');
// import.meta.url is realpath'd, process.argv[1] is whatever the caller spelled,
// so through a symlinked path the entry guard never fired: main() did not run and
// the process exited 0 — this gate's dispatchable signal — printing NOTHING. The
// quiet-success trap of ADR-0051 §3, and unreachable by importing main() the way
// every other check here does. So this one SPAWNS, and asserts on CONTENT.
const bare = join(shim, 'bare.md');
writeFileSync(bare, 'help');
const link = join(shim, 'repo-link');
try { symlinkSync(repoRoot(), link, 'dir'); } catch { /* already there */ }
const spawnGate = (script) => {
  // The shim goes on PATH for the spawned process too. Without it these two
  // cases reached the real network: in CI the offline arm has no token, so
  // `gh api` failed, the gate returned 3 (INCONCLUSIVE) instead of refusing,
  // and the required check was RED for three days while four rounds of commits
  // and records asserted it was green (round-7 B1). "Offline" has to mean it.
  const r = spawnSync(process.execPath, [script, '--body-file', bare], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, ADM_FAKE_ISSUE: issueFile },
  });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
};
const viaLink = spawnGate(join(link, 'scripts/admission-gate.mjs'));
check('spawned through a SYMLINKED path it still refuses a bare issue', /NOT DISPATCHABLE/.test(viaLink), true);
check('...and does not exit silently with no output at all', viaLink.trim().length > 0, true);
// The shim answers for the body actually sent, so this asserts the BODY's
// verdict rather than whatever render was staged last (round-7 M3's root cause).
check('...and the spawned run refused the BARE body, not a staged one', /No acceptance criteria/.test(viaLink), true);
const viaReal = spawnGate(join(repoRoot(), 'scripts/admission-gate.mjs'));
check('spawned through the real path it refuses too', /NOT DISPATCHABLE/.test(viaReal), true);
rmSync(shim, { recursive: true, force: true });

if (oracleDown) {
  // Exit 3 REGARDLESS of check failures, because in this state the suite's own
  // result is not meaningful: bodies fell back to the cache, and the spawned
  // cases run the real driver whose --body-file path needs the same oracle, so
  // failures here are artifacts of the outage rather than evidence about the
  // diff. The OFFLINE arm is the authority on correctness and runs first in CI
  // and must pass; this arm only ever answers "did the fixtures drift?", and
  // when the oracle is unreachable the honest answer is "unknown".
  console.error(`\n${oracleDown} live render(s) could not reach GitHub. THE FIXTURES WERE NOT VERIFIED against the`);
  console.error('real renderer — a missing measurement, not drift, and not a statement about this diff.');
  if (failed) console.error(`(${failed} check(s) also failed; in this state they are outage artifacts — see the offline arm.)`);
  process.exit(3);
}
if (misses) console.error(`\n${misses} render fixture(s) missing — run: node scripts/build-admission-fixtures.mjs`);
// COLLECT mode exists so the fixture builder can discover which bodies need
// rendering; it must NOT swallow real failures. It previously exited 0 on ANY
// failure when ADM_MISS_FILE was set — a one-variable green switch inside a
// Brake, settable by the party being checked (round-4 M1).
if (failed) { console.error(`\n${failed} check(s) failed.`); process.exit(COLLECT && failed === misses ? 0 : 1); }
console.log('\nadmission-gate selftest passed (the Brake is connected, and it does not block honest work).');
