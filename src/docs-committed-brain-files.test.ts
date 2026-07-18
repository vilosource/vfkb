import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from './init.js';

/**
 * Issue #220 — "only .vfkb/entries.jsonl is committed" is FALSE.
 *
 * `.vfkb/manifest.json` is committed BY DESIGN (ADR-0030: the brain↔engine
 * version stamp, explicitly distinct from the derived, gitignored
 * `index-meta.json`). The false sentence caused a real defect: the natural
 * response to an untracked `manifest.json` is to gitignore it, and ViloGate
 * ended up the only consumer with NO engine stamp at all.
 *
 * These guards assert at the altitude of the SHIPPED artifacts — the doc files
 * a reader actually reads, and **git itself** for ground truth — not a helper.
 *
 * HISTORICAL documents are deliberately out of scope. `docs/adr/` and
 * `docs/rfc/` are decided, immutable records (ADR-0001); the sentence was TRUE
 * when RFC-011 was written (manifest.json arrived with ADR-0030, `.journal/`
 * with ADR-0064). Editing a decided document to match present reality is the
 * opposite of the immutability norm. CHANGELOG.md is a historical log too.
 */

const REPO = join(__dirname, '..');

/** Docs a reader/agent consults for CURRENT truth. Excludes decided records. */
const LIVE_DOCS = [
  'CLAUDE.md',
  'README.md',
  'docs/CONSUMER-ONBOARDING.md',
  'docs/CONSUMER-ONBOARDING-PROMPT.md',
  'docs/RUNBOOK-claude-code-integration.md',
];

const read = (p: string) => readFileSync(join(REPO, p), 'utf8');

/** The full derived/operational set that must be gitignored. */
const DERIVED = [
  'index-meta.json',
  '.sessions/',
  '.signals/',
  '.journal/',
  '.lock',
];

describe('the committed-vs-gitignored brain contract in live docs (issue #220)', () => {
  it('GROUND TRUTH: git tracks entries.jsonl AND manifest.json under .vfkb/', () => {
    const tracked = execFileSync('git', ['ls-files', '.vfkb/'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .sort();
    // If this ever changes, the docs below are describing a different world and
    // this whole test file must be revisited rather than the docs patched.
    expect(tracked).toEqual(['.vfkb/entries.jsonl', '.vfkb/manifest.json']);
  });

  it.each(LIVE_DOCS)('%s does not repeat the false "only entries.jsonl" claim', (doc) => {
    const text = read(doc);
    // Matches "Only `.vfkb/entries.jsonl` is committed", "only entries.jsonl is
    // committed", "`entries.jsonl` is committed, the rest is gitignored", etc.
    const FALSE_CLAIM =
      /\b(only|Only)\b[^.\n]{0,40}`?\.?(vfkb\/)?entries\.jsonl`?[^.\n]{0,40}\bis committed\b/;
    const REST_IS_IGNORED = /`entries\.jsonl`\s+is committed,\s*the rest is gitignored/;
    expect(text, `${doc}: the false "only entries.jsonl is committed" claim`).not.toMatch(
      FALSE_CLAIM,
    );
    expect(text, `${doc}: "the rest is gitignored" is flatly false`).not.toMatch(REST_IS_IGNORED);
  });

  /**
   * Split a markdown doc into STATEMENTS a reader consumes as one unit: a
   * bullet / table row / code line, plus its indented continuation lines.
   *
   * Checking the whole document is too coarse to be a guard: a doc can drop
   * manifest.json from its `git add` line and still pass, because the name
   * survives in some unrelated paragraph. (Observed — three mutations passed a
   * document-wide check.) The statement is the altitude a reader copies from.
   */
  function statements(text: string): string[] {
    const out: string[] = [];
    let inFence = false;
    let open = false; // is the last statement still accepting continuations?
    // Unwrap blockquotes first — CONSUMER-ONBOARDING-PROMPT.md is one long `>`
    // quote, and without this every wrapped continuation line looks like a new
    // block, splitting one bullet into fragments and reporting a complete list
    // as partial.
    for (const raw of text.replace(/^> ?/gm, '').split('\n')) {
      if (/^\s*```/.test(raw)) {
        inFence = !inFence;
        out.push(raw);
        open = false;
        continue;
      }
      // Inside a fence every line stands alone — a `git add` line is exactly
      // what a reader copies, so it must carry the whole truth by itself.
      if (inFence) {
        out.push(raw);
        open = false;
        continue;
      }
      if (raw.trim() === '') {
        open = false;
        continue;
      }
      // Block starters: bullet, ordered item, table row, heading, blockquote
      // bullet. Each begins a new statement.
      const startsBlock = /^\s*(?:[-*+]\s|\d+\.\s|\||#{1,6}\s)/.test(raw);
      if (open && !startsBlock) out[out.length - 1] += ' ' + raw.trim();
      else out.push(raw.trim());
      open = true;
    }
    return out;
  }

  /** A statement that tells the reader something is committed. */
  const CLAIMS_COMMITTED = /\bgit add\b|\bis committed\b|\bare committed\b|\*\*Committed\b|\bCommitted (from|\(|:)/;

  it.each(LIVE_DOCS.filter((d) => d !== 'README.md'))(
    '%s names manifest.json in EVERY statement that says what is committed',
    (doc) => {
      // Consecutive `git add` lines are ONE instruction to the reader — the
      // correct form splits manifest.json onto its own guarded line (it may not
      // exist on a plugin-born brain), so judging each line alone is wrong.
      const merged: string[] = [];
      for (const s of statements(read(doc))) {
        const prev = merged[merged.length - 1];
        if (prev !== undefined && /^\s*git add\b/.test(s) && /^\s*git add\b/.test(prev))
          merged[merged.length - 1] = prev + ' ; ' + s.trim();
        else merged.push(s);
      }
      const relevant = merged.filter(
        (s) => /entries\.jsonl/.test(s) && CLAIMS_COMMITTED.test(s),
      );
      // If none matched, the guard has silently stopped guarding.
      expect(relevant.length, `${doc}: no committed-brain statement found to check`).toBeGreaterThan(
        0,
      );
      for (const s of relevant) {
        expect(
          s,
          `${doc}: this statement tells the reader what is committed but omits manifest.json:\n  ${s.trim()}`,
        ).toMatch(/manifest\.json/);
        // Naming manifest.json somewhere in the statement is not enough — the
        // statement must not ALSO scope the committed set to entries.jsonh
        // alone. "`entries.jsonl` only (…manifest.json…)" named it and still
        // told the reader the wrong thing (mutation M4 stayed green).
        // Tight window so the legitimate "written only by `vfkb init`" nearby
        // is not caught.
        expect(
          s,
          `${doc}: this statement scopes the committed set to entries.jsonl alone:\n  ${s.trim()}`,
        // `(?<![-\w])` so "append-only JSONL store … entries.jsonl" — an honest
        // sentence — is not rejected. A gate that blocks honest work is a
        // defect, and this one did on first run.
        ).not.toMatch(
          /(?<![-\w])only\b[^.\n]{0,25}entries\.jsonl|entries\.jsonl[^.\n]{0,25}(?<![-\w])only\b/i,
        );
      }
    },
  );

  it.each([
    'docs/CONSUMER-ONBOARDING.md',
    'docs/CONSUMER-ONBOARDING-PROMPT.md',
    'docs/RUNBOOK-claude-code-integration.md',
  ])('%s enumerates the COMPLETE derived/gitignored set', (doc) => {
    const text = read(doc);
    for (const p of DERIVED) {
      expect(text, `${doc} omits the derived path ${p}`).toContain(p);
    }
  });

  /**
   * A reader copies a fenced gitignore block wholesale. Checking the document
   * for the path names is too coarse — a block can drop `.lock` and still pass
   * because the name survives in a prose bullet elsewhere (observed: mutation
   * M9 stayed green against the document-wide check).
   */
  /**
   * Pure extraction so BOTH the per-doc guard and the non-vacuity floor can
   * call it. It used to be a module-level array populated by an earlier
   * `it.each`, which made the floor depend on test execution ORDER — under
   * `-t`, `--shard`, or a `.only` it failed spuriously, and a gate that blocks
   * honest work is a defect in its own right.
   */
  function gitignoreBlocks(doc: string): string[] {
    // Consume ANY language tag. Matching only ```/```gitignore mispairs the
    // fences (a ```sh open is skipped, so the block boundaries invert) and the
    // filter below then silently keeps nothing — a vacuous test. Verified
    // non-empty by the count assertion at the end of this file.
    const text = read(doc).replace(/^> ?/gm, ''); // unwrap blockquoted fences
    return (
      [...text.matchAll(/```[A-Za-z]*\n([\s\S]*?)```/g)]
        .map((m) => m[1])
        // A gitignore block: every non-comment line is a bare path, and at least
        // one is a .vfkb path. Commands (git add …, node …) are not.
        .filter(
          (b) =>
            /^\s*\.vfkb\/\S+\s*$/m.test(b) &&
            b
              .split('\n')
              .filter((l) => l.trim() && !l.trim().startsWith('#'))
              .every((l) => /^\s*\S+\s*$/.test(l) && !/[$=]|^\s*(git|node|npm|claude)\b/.test(l)),
        )
    );
  }

  it.each(LIVE_DOCS)('%s: every copyable .vfkb gitignore block is COMPLETE and correct', (doc) => {
    for (const b of gitignoreBlocks(doc)) {
      for (const p of DERIVED) expect(b, `${doc}: gitignore block omits ${p}:\n${b}`).toContain(p);
      expect(b, `${doc}: a gitignore block ignores the COMMITTED manifest.json:\n${b}`).not.toMatch(
        /manifest\.json/,
      );
      expect(b, `${doc}: a gitignore block ignores the COMMITTED entries.jsonl:\n${b}`).not.toMatch(
        /entries\.jsonl/,
      );
    }
  });

  /**
   * The catch-all. Not every ignore list is a fenced block — the onboarding
   * PROMPT carries one as a `#` comment inside a bash fence, which the fence
   * guard skips (mutation M12 stayed green). Rule: any statement that
   * enumerates two or more derived paths is presenting "the set", so it must
   * present the WHOLE set. A partial list is how `.journal/` and `.lock` went
   * missing from 10 consumer repos.
   *
   * KNOWN FALSE POSITIVE (accepted, and cheap to work around): a statement that
   * legitimately discusses a SUBSET for some other reason — e.g. "`.sessions/`
   * and `.signals/` are per-machine" — is rejected too, because the rule cannot
   * tell "here is the ignore set" from "here are two of its members". Scoping it
   * to statements containing the word "gitignore" was tried and is worse: the
   * PROMPT's list lives on a bare `#   .vfkb/…` line whose gating word is on the
   * PREVIOUS line, so the scoped rule let mutation M12 through. Blocking an
   * honest sentence is a defect (review charge step 6) — the escape hatch is to
   * split such a sentence, or add it to an exemption list here with a reason.
   * The scope is 5 curated docs, so the blast radius is small and visible.
   */
  it.each(LIVE_DOCS)('%s: no statement enumerates a PARTIAL derived set', (doc) => {
    for (const s of statements(read(doc))) {
      const present = DERIVED.filter((p) => s.includes(p));
      if (present.length < 2) continue;
      const missing = DERIVED.filter((p) => !s.includes(p));
      expect(missing, `${doc}: partial derived set — missing ${missing.join(', ')}:\n  ${s}`).toEqual(
        [],
      );
    }
  });

  /**
   * The correction must not overshoot into a SECOND false claim.
   * `writeManifest` has exactly two call sites — `vfkb init` (src/init.ts) and
   * the cross-repo broadcast heal (src/broadcast.ts). The ordinary write path
   * never creates a manifest, so a PLUGIN-born brain legitimately has none
   * (vfkb#193), and `doctor` reports that as a warn. An onboarding doc that
   * says "commit manifest.json" unconditionally hands the plugin reader a
   * `git add` that fails with "pathspec did not match".
   */
  it('the two writeManifest call sites are still exactly init + broadcast', () => {
    // Scan EVERY src/*.ts — a hardcoded candidate list can only notice a caller
    // disappearing, never one being ADDED, which is the direction that falsifies
    // the docs' "exactly two callers" claim. (That was the bug: the old filter's
    // own comment said "if this list grows…" over a list that could not grow.)
    const files = execFileSync('git', ['ls-files', 'src/*.ts'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter((f) => f && !f.endsWith('.test.ts'));
    expect(files.length, 'no src files scanned — the guard would pass vacuously').toBeGreaterThan(
      10,
    );
    // Strip line comments first — grepping the raw text counts a COMMENTED-OUT
    // call as a live call site (mutation M16 stayed green against that).
    const callers = files.filter((f) =>
      /writeManifest\s*\(/.test(
        read(f)
          .split('\n')
          .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
          .join('\n'),
      ),
    );
    // If this list grows, the "plugin-born brains have none" caveat in the docs
    // may have stopped being true and must be re-checked against the new caller.
    expect(callers.sort()).toEqual(['src/broadcast.ts', 'src/init.ts', 'src/manifest.ts']);
  });

  /**
   * POLARITY. The guards above check that manifest.json is NAMED and that fenced
   * ignore blocks do not list it — but a prose sentence is what a reader acts on,
   * and flipping "never gitignore `manifest.json`" to "always gitignore
   * `manifest.json`" satisfies every one of them. That single flip reintroduces
   * the exact ViloGate defect this file exists to prevent, so the polarity of the
   * rule is itself the thing to assert.
   *
   * The negation must sit ADJACENT to the verb (only markdown emphasis or a short
   * "a reason to" may intervene). A loose "somewhere in the sentence there is a
   * 'not'" test passes on "…is not one — gitignoring it is fine", which is the
   * failure it is meant to catch.
   */
  const NEVER_GITIGNORE = /\b(?:never|not)\b[\s*_`]{0,6}(?:a reason to\s+)?gitignor/i;

  /**
   * Fires only when the gitignore VERB is applied to manifest.json — the two are
   * within 30 characters of each other. Merely co-occurring in a long sentence is
   * not the claim (`init` "writes … `manifest.json` … and the `.gitignore`
   * stanza" is honest, as is "`manifest.json` … is committed; the derived paths
   * are gitignored"). `(?<!\.)` drops the FILENAME `.gitignore`, which is a noun.
   *
   * The window is `[^\n]` and NOT `[^.\n]`: excluding dots looked tidier but the
   * path a doc actually writes is `.vfkb/manifest.json`, whose own dots ended the
   * window early — the flip "do NOT gitignore .vfkb/manifest.json" → "do
   * gitignore .vfkb/manifest.json" stayed GREEN against the dot-excluding form.
   */
  const IGNORES_MANIFEST =
    /(?<!\.)gitignor\w*[^\n]{0,30}manifest\.json|manifest\.json[^\n]{0,30}(?<!\.)gitignor/i;

  it.each(LIVE_DOCS)('%s: no statement tells the reader to gitignore manifest.json', (doc) => {
    for (const s of statements(read(doc))) {
      if (!IGNORES_MANIFEST.test(s)) continue;
      expect(
        s,
        `${doc}: this statement pairs manifest.json with gitignoring and is NOT negated — ` +
          `it reads as an instruction to ignore the committed engine stamp:\n  ${s}`,
      ).toMatch(NEVER_GITIGNORE);
    }
  });

  // README.md is a project overview, not a wiring doc — it never enumerates the
  // ignore contract, so requiring the rule there would block honest prose. The
  // other four are exactly the docs a consumer acts on.
  it.each(LIVE_DOCS.filter((d) => d !== 'README.md'))(
    '%s: states the never-gitignore-manifest.json rule outright',
    (doc) => {
      const stated = statements(read(doc)).filter(
        (s) => /manifest\.json/.test(s) && NEVER_GITIGNORE.test(s),
      );
      expect(
        stated.length,
        `${doc}: the load-bearing rule "never gitignore manifest.json" is absent. ` +
          `Naming manifest.json on a committed list is not enough — the reader's mistake ` +
          `is ignoring it, so the doc must say not to.`,
      ).toBeGreaterThan(0);
    },
  );

  /**
   * A reader who skims to the copyable gitignore fence never reads the prose
   * above it. The correction is only delivered if it sits where they land, so
   * every fence must be followed by the rule. This is what makes the sentence
   * after each block undeletable — deleting it, or the RUNBOOK's whole
   * committed-vs-gitignored section, previously left the suite green.
   */
  it.each(LIVE_DOCS)('%s: every .vfkb gitignore fence is followed by the rule', (doc) => {
    const lines = read(doc).replace(/^> ?/gm, '').split('\n');
    for (const b of gitignoreBlocks(doc)) {
      const firstPath = b.split('\n').find((l) => l.trim().startsWith('.vfkb/'))!.trim();
      const at = lines.findIndex((l) => l.trim() === firstPath);
      expect(at, `${doc}: could not locate the block in the file`).toBeGreaterThan(-1);
      // Find the closing fence, then look at the prose immediately after it.
      let close = at;
      while (close < lines.length && !/^\s*```\s*$/.test(lines[close])) close++;
      const after = lines.slice(close + 1, close + 13).join('\n');
      expect(
        after,
        `${doc}: the gitignore block a reader copies is not followed by ` +
          `"never gitignore manifest.json". A skimmer copies the block and never sees ` +
          `the warning:\n${after}`,
      ).toMatch(NEVER_GITIGNORE);
      expect(after, `${doc}: the post-block warning does not name manifest.json`).toMatch(
        /manifest\.json/,
      );
    }
  });

  /**
   * The RUNBOOK's canonical reference block. Every guard above is document-wide
   * or fence-anchored, so this whole section could be DELETED and the suite
   * stayed green — the RUNBOOK's §6 fence and §0 table independently satisfied
   * the document-wide `toContain` checks. That is the "commenting out every
   * emitted path still passed" failure mode: the section is a deliverable, so
   * assert it exists and that its BODY carries the contract.
   */
  it('the RUNBOOK keeps its "Committed vs gitignored" section, correct and complete', () => {
    const text = read('docs/RUNBOOK-claude-code-integration.md');
    const HEADING = '### Committed vs gitignored in `.vfkb/`';
    const at = text.indexOf(HEADING);
    expect(at, `the RUNBOOK's "${HEADING}" section is gone`).toBeGreaterThan(-1);
    // Body = up to the next heading of any level.
    const rest = text.slice(at + HEADING.length);
    const end = rest.search(/\n#{1,6} |\n---\s*\n/);
    const body = end === -1 ? rest : rest.slice(0, end);
    expect(body.length, 'the section heading survives but its body is empty').toBeGreaterThan(200);
    const committed = body.split(/\*\*Gitignored/)[0];
    expect(committed, 'the section no longer lists manifest.json as committed').toMatch(
      /manifest\.json/,
    );
    expect(committed, 'the section no longer lists entries.jsonl as committed').toMatch(
      /entries\.jsonl/,
    );
    for (const p of DERIVED)
      expect(body, `the section's gitignored list omits ${p}`).toContain(p);
    expect(body, 'the section no longer carries the never-gitignore rule').toMatch(
      NEVER_GITIGNORE,
    );
  });

  /**
   * SCOPE. LIVE_DOCS is a curated list, so the false claim could be reintroduced
   * in any doc outside it with no CI signal. Sweep every tracked markdown file
   * instead, minus the decided/immutable records (ADR-0001) and the changelog,
   * where the sentence was TRUE when written.
   */
  it('no tracked markdown outside the decided records repeats the false claim', () => {
    const docs = execFileSync('git', ['ls-files', '*.md'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter(
        (f) => f && !f.startsWith('docs/adr/') && !f.startsWith('docs/rfc/') && f !== 'CHANGELOG.md',
      );
    expect(docs.length, 'no markdown scanned — vacuous').toBeGreaterThan(5);
    const FALSE_CLAIM =
      /\b(only|Only)\b[^.\n]{0,40}`?\.?(vfkb\/)?entries\.jsonl`?[^.\n]{0,40}\bis committed\b/;
    // Statement-level, so a sentence that QUOTES the claim in order to call it
    // false — the roadmap's record of the defect — is a description, not a
    // repetition. Anything asserting it as fact carries no such disclaimer.
    const offenders = docs.flatMap((f) =>
      statements(read(f))
        .filter((s) => FALSE_CLAIM.test(s) && !/\bfalse\b/i.test(s) && !/#220\b/.test(s))
        .map((s) => `${f}: ${s.slice(0, 120)}`),
    );
    expect(offenders, 'these statements repeat "only entries.jsonl is committed"').toEqual([]);
  });

  /**
   * The ENGINE is an emitter of this contract too: `vfkb init` writes an
   * AGENTS.md stanza into every newly-wired consumer repo. It shipped the same
   * partial-derived-set defect the docs had (3 of 5 paths), so a consumer's own
   * agent instructions taught the mistake this PR corrects everywhere else.
   * Asserted against the FILE init actually writes, not the source template.
   */
  it('vfkb init writes an AGENTS.md stanza with the complete, correct contract', () => {
    const root = mkdtempSync(join(tmpdir(), 'vfkb-agents-'));
    try {
      initProject(root, { project: 'probe' });
      const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      for (const p of DERIVED)
        expect(agents, `init's AGENTS.md omits the derived path ${p}`).toContain(p);
      expect(agents, "init's AGENTS.md omits the committed manifest.json").toContain(
        'manifest.json',
      );
      expect(agents, "init's AGENTS.md does not carry the never-gitignore rule").toMatch(
        NEVER_GITIGNORE,
      );
      for (const s of statements(agents)) {
        if (!IGNORES_MANIFEST.test(s)) continue;
        expect(s, `init's AGENTS.md tells the agent to gitignore manifest.json:\n  ${s}`).toMatch(
          NEVER_GITIGNORE,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['docs/CONSUMER-ONBOARDING.md', 'docs/CONSUMER-ONBOARDING-PROMPT.md'])(
    '%s does not promise manifest.json unconditionally exists',
    (doc) => {
      const text = read(doc);
      // It must carry the caveat...
      expect(text, `${doc}: no plugin-born-brain caveat for manifest.json`).toMatch(
        /plugin-born|if present|whenever it exists|have none/i,
      );
      // ...and no bare `git add` may list manifest.json as a required pathspec
      // without an escape (|| true / 2>/dev/null), which is what fails on a
      // plugin-wired repo.
      for (const s of statements(text)) {
        if (!/^\s*git add\b/.test(s) || !/manifest\.json/.test(s)) continue;
        expect(s, `${doc}: this git add fails on a plugin-born brain:\n  ${s}`).toMatch(
          /\|\|\s*true|2>\/dev\/null/,
        );
      }
    },
  );

  // The check above is a loop over a filtered list — if the filter matches
  // nothing it passes vacuously (it did, on the first draft: a fence-pairing
  // bug left 0 blocks and 3 mutations stayed green). This asserts the guard
  // actually had something to guard.
  it('the gitignore-block guard is not vacuous — it saw real blocks', () => {
    const seen = LIVE_DOCS.flatMap(gitignoreBlocks);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it("this repo's own .gitignore ignores every derived path and NOT the committed ones", () => {
    const gi = read('.gitignore');
    for (const p of DERIVED) expect(gi, `.gitignore omits ${p}`).toContain(`.vfkb/${p}`);
    expect(gi).not.toMatch(/^\.vfkb\/manifest\.json\s*$/m);
    expect(gi).not.toMatch(/^\.vfkb\/entries\.jsonl\s*$/m);
  });

  it('doctor.ts does not enumerate a stale partial gitignore set in prose', () => {
    // Strip comment markers + collapse whitespace so a claim that spans a
    // wrapped comment still matches (the stale one did).
    const src = read('src/doctor.ts').replace(/^\s*\/\/ ?/gm, '').replace(/\s+/g, ' ');
    // The old comment said only `.signals/` (plus .sessions/ and
    // index-meta.json) is in init's stanza — 3 of 5, stale since ADR-0064.
    expect(src).not.toMatch(/plus \.sessions\/ and index-meta\.json/);
    // And it must name the two paths ADR-0064 / the lock added.
    expect(src).toMatch(/\.journal\//);
  });
});
