#!/usr/bin/env node
// ============================================================================
// ADR lint — build status does not belong in an immutable document
// ----------------------------------------------------------------------------
// Observed 2026-07-19 (brain gotcha 9653e77c09fc). Three ADRs asserted their own
// BUILD state in prose:
//
//   ADR-0064  "Decided, NOT yet built."  — false within ONE DAY: the journal
//             shipped as plugin v0.10.0 and reached all 12 consumers.
//   ADR-0065  "Decided, NOT yet built."  — wrong in BOTH directions: §1/§2a
//             shipped in v0.11.0 while §0/§2 did not. One frozen sentence
//             cannot describe a decision that ships in parts.
//   ADR-0048  "tracked — not yet built"  — the referenced issue is closed.
//   ADR-0051  "Unbuilt; it is the remaining live work" — found by this lint's own
//             third pattern during review; the detector and its record both exist.
//
// ADR-0001 makes ADRs immutable, so none of these could simply be corrected;
// fixing them required an explicit maintainer exception to the immutability rule.
//
// THE CATEGORY ERROR: an ADR's status tracks the DECISION's lifecycle
// (Proposed → Accepted → Amended | Superseded). Build state is mutable, has a
// different lifetime, and already lives in places that are allowed to change —
// the tracking issue, docs/H4-DEVELOPMENT-ROADMAP.md, the brain, and
// machine-derived files like the plugin's DELIVERY-STATUS.json (whose value the
// release gate DERIVES from committed evidence rather than trusting prose).
//
// WHY A SCRIPT AND NOT A SENTENCE: docs/adr/README.md ALREADY documented the
// status lifecycle as decision-only, and all three ADRs were written anyway. A
// prose rule with no Brake gets skipped — this repo's founding lesson, and the
// reason scripts/review-gate.mjs exists.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT: it catches the phrasings that have
// actually occurred, in the places they occurred. It cannot understand prose, so
// a determined author can still smuggle build state past it. Like the review
// gate, the point is that doing so is no longer SILENT or accidental.
//
//   node scripts/adr-lint.mjs
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADR_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'adr');

// Assertions about IMPLEMENTATION state. Each has been seen in a real ADR.
// Deliberately narrow: these are claims an ADR makes about itself, not ordinary
// prose about the world.
// Deliberately NARROW. A first cut flagged 8 ADRs, and all but the 3 real ones
// were legitimate: ADR-0050 DEFINES the phrase "built, NOT yet verified";
// ADR-0043 says "nothing is built speculatively" as policy; ADR-0015 sequences
// work in prose. A gate that blocks honest work is a defect, not caution, so
// this matches only the two shapes actually observed as defects:
//
//   1. a STATUS SECTION HEADING — a document declaring its own implementation
//      state as a standing section, which is the part that cannot stay true;
//   2. the self-referential verdict "Decided, NOT yet built".
//
// Ordinary prose that happens to mention building is none of this lint's
// business, and the selftest pins that by asserting the real corpus stays clean.
export const BUILD_STATUS_PATTERNS = [
  {
    re: /^#{1,4}\s*(?:status honesty|implementation status|build status|current status)\b.*$/i,
    why: 'a status SECTION freezes mutable build state into an immutable document — point at the tracker instead',
  },
  {
    re: /\bDecided,?\s+NOT yet built\b/i,
    why: 'asserts this decision\'s own build state; it will go stale (ADR-0064 did, within a day)',
  },
  {
    // ADR-0048's shape ("tracked — not yet built") and ADR-0051's ("Unbuilt; it
    // is the remaining live work"). The header cited the first as motivating and
    // the lint did not catch it; the second was a live, false instance nobody had
    // noticed (review of #226, major 3).
    re: /\b(?:not yet built|unbuilt)\b/i,
    why: 'asserts build state of something; name the tracker and let the issue carry the state',
  },
];

// An ADR may legitimately POINT at where build state lives. These shapes are the
// recommended replacement, so they must not trip the lint.
const POINTER_ALLOW = [
  /tracked in \[?#\d+/i,
  /see that issue for its state/i,
  /Fixes on build:/i,
  /^#{1,4}\s.*,\s*not here\b/i, // only as a HEADING, not a whole-line escape hatch
];

/** Lines that are inside a maintainer-authorized correction block are exempt:
 *  they exist precisely to DESCRIBE the removed claim, and quoting it must not
 *  re-trip the rule that removed it. */
function isExempt(line) {
  const t = line.trim();
  if (t.startsWith('>')) return true; // blockquote: the correction notes
  if (t.startsWith('//')) return true;
  return POINTER_ALLOW.some((re) => re.test(t));
}

export function lintAdr(text, file) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (const { re, why } of BUILD_STATUS_PATTERNS) {
    // Heading patterns are anchored per-line already; test line by line so the
    // exemption can apply at line granularity rather than whole-file.
    lines.forEach((line, i) => {
      if (isExempt(line)) return;
      const probe = new RegExp(re.source, re.flags.replace('m', ''));
      if (probe.test(line)) {
        findings.push(`${file}:${i + 1}: ${why} — ${line.trim().slice(0, 90)}`);
      }
    });
  }
  return findings;
}

export function lintAll(dir = ADR_DIR) {
  const findings = [];
  let scanned = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!/^ADR-\d+.*\.md$/.test(name)) continue;
    scanned++;
    findings.push(...lintAdr(readFileSync(join(dir, name), 'utf8'), `docs/adr/${name}`));
  }
  // A gate that scans nothing and reports green is the ADR-0051 §3 quiet-success
  // trap: a successful run lacking the capability. If the docs tree moves or the
  // naming convention shifts, this must go RED, not quietly clean (review of
  // #226, major 2).
  if (scanned === 0) {
    findings.push(`${dir}: scanned 0 ADRs — the corpus path or ADR-NNNN naming convention has moved; this gate was checking nothing`);
  }
  return findings;
}

/** Files actually scanned — exposed so the selftest can assert a real floor. */
export function scannedCount(dir = ADR_DIR) {
  return readdirSync(dir).filter((n) => /^ADR-\d+.*\.md$/.test(n)).length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = lintAll();
  for (const f of findings) console.error(`ADR-LINT: ${f}`);
  if (findings.length) {
    console.error(
      `\n${findings.length} ADR(s) assert their own build state.\n` +
        `An ADR records a DECISION; its status is Proposed → Accepted → Amended | Superseded.\n` +
        `Build state is mutable — put it in the tracking issue, the roadmap, or the brain, and\n` +
        `have the ADR POINT there instead ("Build status — tracked in #NNN, not here").\n` +
        `Rationale: brain gotcha 9653e77c09fc; ADR-0064 was false within a day of being written.`,
    );
    process.exit(1);
  }
  console.log(`adr-lint: ${scannedCount()} ADR(s) clean — no build-state assertions`);
}
