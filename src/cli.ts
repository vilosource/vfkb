#!/usr/bin/env node
// vfkb thin CLI — the face the Claude Code hooks call (ADR-0015 Tier A/B).
// `hook session-start` / `hook post-tool-use` carry the harness JSON contract.

import {
  addEntry,
  captureToolCall,
  readAll,
  renderContext,
  renderContextBundle,
  renderContextMap,
  renderNaiveDump,
  renderResume,
  initContextSpine,
  supersede,
  deriveTrust,
} from './engine.js';
import { SessionState, effectiveSessionId } from './session.js';
import { brainDir, defaultProject, withExclusive, writeMeta } from './storage.js';
import { purgeJournal, recoverFromJournal } from './journal.js';
import { runExport } from './export.js';
import { broadcast as runBroadcast } from './broadcast.js';
import {
  promote,
  archive,
  mergeDuplicate,
  findLexicalDuplicates,
  promoteIfCorroborated,
  eligibleForPromotion,
} from './curator.js';
import { distill } from './distiller.js';
import { recordSignal, tally } from './counters.js';
import { queryExplained } from './read.js';
import { isBrainWrite, GATING_REASON } from './gating.js';
import { decideStop, gatherStopContext } from './stop-reminder.js';
import { save } from './git.js';
import { runSessionEnd } from './session-end.js';
import { initProject, approvalNotice } from './init.js';
import { runDoctor, renderDoctor, checkNpmCurrency } from './doctor.js';
import { ENGINE_VERSION } from './version.js';
import { fromMykb, fromAdr, fromMarkdown, resolveMykbArea } from './import.js';
import { parseArgs, flagValue, flagList, flagInt, UsageError } from './args.js';
import { ENTRY_TYPES, DECISION_STATUSES } from './types.js';
import type { AuthorRole, EntryType, Zone, DecisionStatus } from './types.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The package's OWN version, read from ITS OWN package.json at runtime — never
// hardcoded (ADR-0057 step 1). Resolved relative to this module file so it works
// from dist/cli.js inside an `npm i -g` install: bin -> dist/cli.js, package.json
// is one level up from dist/, in both the tsc dev build and the packed tarball.
// The single-file bundles sit in dist/bundles/ where ../package.json does NOT
// exist — an unguarded read crashed --version in every bundle deployment
// (observed 2026-07-12 vendoring into the plugin). A bundle's ENGINE_VERSION is
// define-injected from this same manifest at build time, so falling back to it
// is the manifest's version by another route, not a hardcoded literal.
function packageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version || ENGINE_VERSION;
  } catch {
    return ENGINE_VERSION;
  }
}

// The hook stdin-read convention (issue #214). A hook must NEVER wedge a tool
// call — it fails open or it does not ship. Two things are required for that,
// and the original guard only did the first:
//
//   1. RESOLVE on a deadline, so a writer that never closes stdin still yields
//      whatever arrived (the pre-existing 2s watchdog did this correctly).
//   2. RELEASE stdin once settled, so the PROCESS can actually exit. A live
//      'data' listener refs the pipe and keeps the event loop alive — MEASURED
//      2026-07-18: `dist/cli.js hook pre-tool-use` wrote its allow decision
//      `{}` at 2s and then hung until SIGKILL at 10s. The right answer,
//      delivered by a process the harness is still waiting on, is still a stall.
//
// Claude Code cancels a `command` hook only at its default 600s timeout
// (code.claude.com/docs/en/hooks), and what it does on expiry — allow or deny —
// is NOT documented. So the wedge is up to ten minutes and its outcome unknown;
// neither is acceptable for a PreToolUse gate.
const STDIN_WATCHDOG_MS = 2000;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      // Stop holding the event loop open: without this the hook produces the
      // correct output and still never exits (clause 2 above).
      process.stdin.pause();
      process.stdin.unref?.();
      resolve(data);
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish); // a broken pipe must fail open too
    setTimeout(finish, STDIN_WATCHDOG_MS).unref?.();
  });
}

// Positional flag lookup for the HOOK subcommands only — hooks stay fail-open
// (never error a harness session over argv), so they bypass the strict parser.
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function argsOf(sub: string | undefined, rest: string[]): string[] {
  return [sub, ...rest].filter((a): a is string => a !== undefined);
}

function entryType(verb: string, raw: string | undefined): EntryType {
  if (!raw || !(ENTRY_TYPES as readonly string[]).includes(raw)) {
    throw new UsageError(`${verb}: unknown entry type '${raw ?? ''}' — expected ${ENTRY_TYPES.join('|')}`);
  }
  return raw as EntryType;
}

async function main() {
  try {
    await dispatch();
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`error: ${err.message}\n${USAGE}`);
      process.exit(1);
    }
    throw err;
  }
}

const USAGE =
  'usage: vfkb <add|broadcast|journal purge|list|search|query|map|context|context init|resume|resume-note|curate|distill|save|' +
  'export|import|init|doctor|supersede|context-block|context-block-naive|--version|' +
  'hook session-start|hook pre-tool-use|hook post-tool-use|hook stop|hook session-end>\n';

async function dispatch() {
  const [cmd, sub, ...rest] = process.argv.slice(2);

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(USAGE);
    return;
  }

  // --version / -v / version: the package's own version, nothing else on stdout
  // (ADR-0057 step 1 — needed by the install proof, RFC-030's update check, and
  // every future bug report).
  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }

  // --- add <type> <text> [--role] [--tag a,b] [--why …] [--status] [--prov-status] [--valid-until] ---
  if (cmd === 'add') {
    const p = parseArgs('add', argsOf(sub, rest), {
      role: 'value',
      tag: 'value',
      why: 'value',
      contradicts: 'value',
      status: 'value',
      'prov-status': 'value',
      'valid-until': 'value',
      zone: 'value',
      constitutional: 'boolean',
    });
    const type = entryType('add', p.positionals[0]);
    const textArg = p.positionals.slice(1).join(' ').trim();
    if (!textArg) throw new UsageError('add: missing entry text');
    const role = (flagValue(p, 'role') as AuthorRole) || 'executor';
    try {
      const e = addEntry(type, textArg, {
        role,
        why: flagValue(p, 'why'),
        tags: flagList(p, 'tag') ?? [],
        contradicts: flagList(p, 'contradicts'),
        status: flagValue(p, 'status') as any,
        provStatus: flagValue(p, 'prov-status') as any,
        validUntil: flagValue(p, 'valid-until'),
        zone: flagValue(p, 'zone') as any,
        constitutional: p.flags.get('constitutional') === true,
      });
      process.stdout.write(`${e.id}\t[${e.type} ${deriveTrust(e.author.role)}]\t${e.text}\n`);
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    }
    return;
  }

  // --- broadcast "<text>" --to <dir>[,<dir>…] [--op <name>] [--tag a,b] ---
  // ADR-0063 §3: one cross-repo record per target brain, engine-written,
  // origin/date/tag stamped, per-target result + commit posture, no commits.
  if (cmd === 'broadcast') {
    const p = parseArgs('broadcast', argsOf(sub, rest), {
      to: 'value',
      op: 'value',
      tag: 'value',
    });
    const text = p.positionals.join(' ').trim();
    const targets = flagList(p, 'to') ?? [];
    if (!text || targets.length === 0) {
      throw new UsageError('usage: vfkb broadcast "<text>" --to <dir>[,<dir>…] [--op <name>] [--tag a,b]');
    }
    try {
      const results = runBroadcast(text, targets, {
        op: flagValue(p, 'op'),
        tags: flagList(p, 'tag'),
      });
      let failed = 0;
      for (const r of results) {
        if (r.ok) {
          // #212 — `healed` (manifest was ABSENT, #193) and `upgraded` (manifest
          // was PRESENT but of unknown provenance, "dev") are different repairs
          // and must read differently: reporting an upgrade as a heal tells the
          // operator the manifest was missing when it never was, misdirecting
          // diagnosis to #193. An unrendered `upgraded` is the same defect in
          // silent form — the audit signal simply never reaches the operator.
          const repair = r.healed
            ? '\t(manifest healed — brain was wired but manifest-less, vfkb#193)'
            : r.upgraded
              ? '\t(manifest provenance upgraded — engine identity was unknown ("dev"), now the running sha, vfkb#212)'
              : '';
          process.stdout.write(`written\t${r.target}\t${r.id}\t${r.posture}${repair}\n`);
        } else {
          failed++;
          process.stdout.write(`REFUSED\t${r.target}\t${r.reason}\n`);
        }
      }
      process.stdout.write(`\nbroadcast: ${results.length - failed}/${results.length} written${failed ? ` — ${failed} refused (partial broadcast, visible by design)` : ''}\n`);
      process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  // export <agents-md|okf> [--out <path>] — ADR-0047 brain export projections:
  // deterministic, generated-marked, never auto-committed publish artifacts.
  if (cmd === 'export') {
    const p = parseArgs('export', rest, { out: 'value' });
    if (p.positionals.length > 0) {
      throw new UsageError(`export: unexpected argument '${p.positionals[0]}'`);
    }
    try {
      process.stdout.write(runExport(sub, { out: flagValue(p, 'out') }) + '\n');
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    }
    return;
  }

  // init [project]: FR-1 (ADR-0030) — idempotently scaffold THIS repo (cwd) as a
  // vfkb consumer (portable $VFKB_HOME wiring + .gitignore + empty brain + snippet).
  if (cmd === 'init') {
    const p = parseArgs('init', argsOf(sub, rest), { 'no-pi': 'boolean' });
    if (p.positionals.length > 1) throw new UsageError('init: at most one [project] argument');
    const root = process.cwd();
    const project = p.positionals[0] || process.env.VFKB_PROJECT;
    // --no-pi: skip the pi face wiring. The default is ON (ADR-0066), but wiring pi
    // enrolls the repo in a package clone+install at pi startup, and a Claude-only
    // consumer should be able to decline a dependency they will never use.
    const changes = initProject(root, { project, pi: !p.flags.get('no-pi') });
    const resolved = project || root.split(/[/\\]/).filter(Boolean).pop() || 'project';
    for (const c of changes) process.stdout.write(`${c.action}\t${c.path}\n`);
    process.stdout.write('\n' + approvalNotice(resolved) + '\n');
    return;
  }

  // import: FR-3 (ADR-0030) — migrate existing knowledge into the brain (lossy,
  // role=import). --from-mykb <area> | --from-adr [dir] | --from-markdown <file>.
  if (cmd === 'import') {
    const p = parseArgs('import', argsOf(sub, rest), {
      'from-adr': 'optional-value',
      'from-markdown': 'value',
      'from-mykb': 'value',
    });
    if (p.positionals.length > 0) {
      throw new UsageError(`import: unexpected argument '${p.positionals[0]}'`);
    }
    const results: { id: string; type: string; text: string }[] = [];
    try {
      if (p.flags.has('from-adr')) results.push(...fromAdr(flagValue(p, 'from-adr') || 'docs/adr'));
      const md = flagValue(p, 'from-markdown');
      if (md) results.push(...fromMarkdown(md));
      const mykb = flagValue(p, 'from-mykb');
      if (mykb) results.push(...fromMykb(resolveMykbArea(mykb)));
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    }
    if (results.length === 0) {
      process.stderr.write('import: nothing imported — pass --from-mykb <area> | --from-adr [dir] | --from-markdown <file>\n');
      process.exit(1);
    }
    for (const r of results) process.stdout.write(`${r.id}\t${r.type}\t${r.text.split('\n')[0].slice(0, 80)}\n`);
    process.stdout.write(`\nimported ${results.length} entr${results.length === 1 ? 'y' : 'ies'} (role=import, unverified)\n`);
    return;
  }

  // doctor: FR-4 (ADR-0030) — diagnose brain↔engine compat + wiring health.
  // --check-remote (ADR-0058/RFC-030): opt-in npm currency line; plain `doctor`
  // stays fully offline (no fetch call, byte-identical output to pre-ADR-0058).
  if (cmd === 'doctor') {
    const pd = parseArgs('doctor', argsOf(sub, rest), { 'check-remote': 'boolean' });
    if (pd.positionals.length > 0) {
      throw new UsageError(`doctor: unexpected argument '${pd.positionals[0]}'`);
    }
    const brainDir = process.env.VFKB_DATA_DIR || process.env.VFKB_DIR || '.vfkb';
    const report = runDoctor({ root: process.cwd(), brainDir, env: process.env });
    if (pd.flags.get('check-remote') === true) {
      const npm = await checkNpmCurrency({ brainDir, installedVersion: ENGINE_VERSION });
      report.checks.push({ name: 'npm currency', status: npm.status, detail: npm.detail });
      report.ok = !report.checks.some((c) => c.status === 'fail');
    }
    process.stdout.write(renderDoctor(report) + '\n');
    if (!report.ok) process.exit(1);
    return;
  }

  // list [--type t] [--tag a,b] [--status s] [--limit N] — raw dump with structural
  // filters (issue #95 fix (a)). Tag semantics mirror read.ts: entry carries ALL of
  // them. --limit keeps the MOST RECENT N (append order tail).
  if (cmd === 'list') {
    const p = parseArgs('list', argsOf(sub, rest), {
      type: 'value',
      tag: 'value',
      status: 'value',
      limit: 'value',
    });
    if (p.positionals.length > 0) {
      throw new UsageError(`list: unexpected argument '${p.positionals[0]}' (list takes only flags)`);
    }
    const type = flagValue(p, 'type');
    if (type) entryType('list --type', type);
    const tags = flagList(p, 'tag');
    const status = flagValue(p, 'status');
    if (status && !(DECISION_STATUSES as readonly string[]).includes(status)) {
      throw new UsageError(`list: unknown --status '${status}' — expected ${DECISION_STATUSES.join('|')}`);
    }
    const limit = flagInt(p, 'limit');
    let entries = readAll();
    if (type) entries = entries.filter((e) => e.type === type);
    if (tags) entries = entries.filter((e) => tags.every((t) => e.tags.includes(t)));
    if (status) entries = entries.filter((e) => e.status === status);
    if (limit !== undefined) entries = entries.slice(-limit);
    for (const e of entries) {
      process.stdout.write(
        `${e.id}\t${e.type}\t${deriveTrust(e.author.role)}\t${e.provenance.status}\t${e.text}\n`,
      );
    }
    return;
  }

  if (cmd === 'context-block') {
    const p = parseArgs('context-block', argsOf(sub, rest), {});
    if (p.positionals.length > 1) throw new UsageError('context-block: at most one [project] argument');
    process.stdout.write(renderContextBundle(p.positionals[0] || defaultProject()));
    return;
  }

  if (cmd === 'map') {
    const p = parseArgs('map', argsOf(sub, rest), {});
    if (p.positionals.length > 0) throw new UsageError(`map: unexpected argument '${p.positionals[0]}'`);
    process.stdout.write(renderContextMap() + '\n');
    return;
  }

  // context [project] | context init: the project context doc (D-ii / ADR-0025) — the
  // assembled "agent's first read" (authored spine + derived Constitution/Map/decisions).
  // `init` scaffolds the authored spine (<brain>/context.md) if absent.
  if (cmd === 'context') {
    const p = parseArgs('context', argsOf(sub, rest), {});
    if (p.positionals.length > 1) throw new UsageError('context: at most one [init|project] argument');
    if (p.positionals[0] === 'init') {
      const { created, path } = initContextSpine();
      process.stdout.write(`${created ? 'created' : 'exists'}\t${path}\n`);
      return;
    }
    process.stdout.write(renderContext(p.positionals[0] || defaultProject()));
    return;
  }

  // resume [project]: the session-continuity render (ADR-0020) — prior-session
  // digest (derived) + the live knowledge bundle. The MCP-pull-floor / CLI face.
  if (cmd === 'resume') {
    const p = parseArgs('resume', argsOf(sub, rest), {});
    if (p.positionals.length > 1) throw new UsageError('resume: at most one [project] argument');
    process.stdout.write(renderResume(p.positionals[0] || defaultProject(), SessionState.load()) + '\n');
    return;
  }

  // curate: ACE curator maintenance (ADR-0021) — deltas only, NEVER rewrites text.
  //   curate dups                       list exact lexical duplicate pairs (proposal only)
  //   curate promote <id>               incoming -> established
  //   curate archive <id>               retire out of the injection set
  //   curate merge <loserId> <winnerId> archive the loser, keep the winner
  //   curate signal <id> <helpful|harmful>  record an append-only corroboration signal
  //   curate promote-auto <id>          promote ONLY if corroborated (>=N signals)
  if (cmd === 'curate') {
    const p = parseArgs('curate', argsOf(sub, rest), {});
    const [action, id1, id2] = p.positionals;
    const need = (n: number, usage: string) => {
      if (p.positionals.length - 1 !== n) throw new UsageError(`usage: vfkb curate ${usage}`);
    };
    try {
      if (action === 'dups') {
        need(0, 'dups');
        const dups = findLexicalDuplicates();
        for (const d of dups) process.stdout.write(`DUP\tloser=${d.loser}\twinner=${d.winner}\n`);
        if (dups.length === 0) process.stdout.write('no exact lexical duplicates\n');
      } else if (action === 'signal') {
        need(2, 'signal <id> <helpful|harmful>');
        if (id2 !== 'helpful' && id2 !== 'harmful') {
          process.stderr.write('usage: vfkb curate signal <id> <helpful|harmful>\n');
          process.exit(1);
        }
        recordSignal(id1, id2, 'operator');
        const t = tally(id1);
        process.stdout.write(
          `signal ${id2} -> ${id1} (helpful ${t.helpful} / harmful ${t.harmful} / net ${t.net}` +
            `${eligibleForPromotion(id1) ? ', promotable' : ''})\n`,
        );
      } else if (action === 'promote-auto') {
        need(1, 'promote-auto <id>');
        const e = promoteIfCorroborated(id1);
        process.stdout.write(`promoted (corroborated) ${e.id} -> ${e.zone}\n`);
      } else if (action === 'promote') {
        need(1, 'promote <id>');
        const e = promote(id1);
        process.stdout.write(`promoted ${e.id} -> ${e.zone}\n`);
      } else if (action === 'archive') {
        need(1, 'archive <id>');
        const e = archive(id1);
        process.stdout.write(`archived ${e.id}\n`);
      } else if (action === 'merge') {
        need(2, 'merge <loser> <winner>');
        mergeDuplicate(id1, id2);
        process.stdout.write(`merged ${id1} -> ${id2} (loser archived)\n`);
      } else {
        process.stderr.write(
          'usage: vfkb curate <dups|promote <id>|promote-auto <id>|archive <id>|merge <loser> <winner>|signal <id> <helpful|harmful>>\n',
        );
        process.exit(1);
      }
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    }
    return;
  }

  // distill: auto-distill write side (ADR-0021) — turn this session's captured failures
  // into CANDIDATE gotchas in incoming/unverified (containment). Recurrence corroborates
  // an existing candidate instead of duplicating. Deterministic; never touches the
  // trusted set. With KB_SESSION_ID, restricts to the session's captured ids; else all.
  if (cmd === 'distill') {
    const pd = parseArgs('distill', argsOf(sub, rest), {});
    if (pd.positionals.length > 0) {
      throw new UsageError(`distill: unexpected argument '${pd.positionals[0]}'`);
    }
    const session = SessionState.load();
    const ids = session.capturedIds;
    const { created, corroborated } = distill(ids.length ? ids : undefined);
    // Distilling IS session activity — advance the record so the just-written lessons
    // fall inside this session's [startedAt, lastAt] window (M3: the next session's
    // resume digest derives "learned this session" from that window). No-op when ephemeral.
    session.save();
    for (const e of created) process.stdout.write(`CANDIDATE\t${e.id}\tincoming/unverified\t${e.text}\n`);
    for (const id of corroborated) process.stdout.write(`CORROBORATED\t${id}\t${tally(id).net} net\n`);
    if (created.length === 0 && corroborated.length === 0) {
      process.stdout.write('no distillable failure signals\n');
    }
    return;
  }

  // resume-note <text...>: attach an ASSERTED operator intent ("next: …") to the
  // current session's record. Persists only with KB_SESSION_ID (else ephemeral).
  if (cmd === 'resume-note') {
    const p = parseArgs('resume-note', argsOf(sub, rest), {});
    const session = SessionState.load();
    const note = p.positionals.join(' ').trim();
    if (!note) {
      process.stderr.write('usage: vfkb resume-note <text>\n');
      process.exit(1);
    }
    session.setNote(note);
    session.save();
    process.stdout.write(
      session.sessionId
        ? `noted for session ${session.sessionId}: ${note}\n`
        : `note set (ephemeral — set KB_SESSION_ID to persist): ${note}\n`,
    );
    return;
  }

  // context-block-naive: mykb-v1-style flat unfiltered dump (L4 contrast baseline).
  // --limit N truncates load-order (oldest-first) to N entries (reproduces the
  // budget-drops-newest incident).
  if (cmd === 'context-block-naive') {
    const p = parseArgs('context-block-naive', argsOf(sub, rest), { limit: 'value' });
    if (p.positionals.length > 1) throw new UsageError('context-block-naive: at most one [project] argument');
    const lim = flagInt(p, 'limit');
    process.stdout.write(renderNaiveDump(p.positionals[0] || defaultProject(), undefined, lim));
    return;
  }

  // supersede <oldId> <text...> [--role r] [--why w]
  if (cmd === 'supersede') {
    if (!sub || sub.startsWith('--')) {
      throw new UsageError('usage: vfkb supersede <oldId> <text…> [--role r] [--why w]');
    }
    const p = parseArgs('supersede', rest, { role: 'value', why: 'value' });
    const newText = p.positionals.join(' ').trim();
    if (!newText) throw new UsageError('supersede: missing new text');
    try {
      const e = supersede(sub, newText, {
        role: (flagValue(p, 'role') as AuthorRole) || 'human',
        why: flagValue(p, 'why'),
      });
      process.stdout.write(`${e.id}\tsupersedes ${sub}\t${e.text}\n`);
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    }
    return;
  }

  // search/query: vfkb search <text> [--type t] [--tag a,b] [--zone z] [--status s]
  //               [--role r] [--verified] [--limit N] [--stale] [--superseded]
  if (cmd === 'search' || cmd === 'query') {
    const p = parseArgs(cmd, argsOf(sub, rest), {
      type: 'value',
      tag: 'value',
      zone: 'value',
      status: 'value',
      role: 'value',
      limit: 'value',
      verified: 'boolean',
      stale: 'boolean',
      superseded: 'boolean',
    });
    const text = p.positionals.join(' ');
    const { results, diagnosis } = queryExplained({
      text: text || undefined,
      type: flagValue(p, 'type') as EntryType,
      zone: flagValue(p, 'zone') as Zone,
      status: flagValue(p, 'status') as DecisionStatus,
      tags: flagList(p, 'tag'),
      authorRole: flagValue(p, 'role') as AuthorRole,
      verifiedOnly: p.flags.get('verified') === true,
      limit: flagInt(p, 'limit'),
      includeStale: p.flags.get('stale') === true,
      includeSuperseded: p.flags.get('superseded') === true,
    });
    for (const e of results) {
      const contra = e.refs?.contradicts?.length ? `\t⚔ contradicts ${e.refs.contradicts.join(',')}` : '';
      process.stdout.write(`${e.id}\t${e.type}\t${deriveTrust(e.author.role)}\t${e.text}${contra}\n`);
    }
    // RFC-002: an empty result is reported with its cause, not silence — so the
    // human/agent reading the CLI knows "no recorded entry" vs "all matches stale".
    if (results.length === 0 && diagnosis) {
      const extra =
        diagnosis.reason === 'all_filtered'
          ? ` (${diagnosis.candidates} filtered: ${Object.entries(diagnosis.filteredOut ?? {})
              .map(([k, v]) => `${v} ${k}`)
              .join(', ')})`
          : diagnosis.reason === 'no_match' && diagnosis.belowFloor
            ? ` (closest below floor, low confidence: ${diagnosis.belowFloor.entry.text})`
            : '';
      process.stdout.write(`NO-MATCH\t${diagnosis.reason}\tno recorded entry found${extra}\n`);
    }
    return;
  }

  // Hook subcommands are exempt from strict flag parsing BY DESIGN (issue #95):
  // the harness contract is fail-open — a hook must never error a session over
  // an unrecognized argv, so unknown flags here are ignored, not rejected.
  if (cmd === 'hook') {
    if (sub === 'session-start') {
      const raw = await readStdin();
      let payloadId: string | undefined;
      try {
        const p = JSON.parse(raw || '{}');
        if (typeof p.session_id === 'string') payloadId = p.session_id;
      } catch {
        /* malformed → no harness id; env override may still apply */
      }
      const project = defaultProject();
      // --naive = the mykb-v1-style flat dump (L4 contrast baseline only); --limit N truncates it.
      const lim = flag(rest, 'limit');
      // The Tier-A payload is the RESUME render (ADR-0020): prior-session digest +
      // the live knowledge bundle, both derived. Persist this session's record so the
      // NEXT session can resume from it (append-only). ADR-0039: the id comes from the
      // hook's own stdin (KB_SESSION_ID is an optional override) — no harness wiring needed.
      const session = SessionState.load(effectiveSessionId(payloadId));
      // ADR-0064 §2: journal recovery runs BEFORE the digest renders, so a
      // brain destroyed by a careless git operation is whole again by the time
      // the session reads it. Fail-open (a hook must never error a session);
      // the restore report rides the injected digest — the loud channel —
      // because hook stderr is not reliably surfaced.
      let restoreNote = '';
      try {
        const rec = withExclusive(() => recoverFromJournal(brainDir()));
        if (rec.restored > 0) {
          // Restores bypass appendRecord (no re-journaling loop), so refresh
          // the freshness meta here — a long-lived index consumer must not
          // keep serving a pre-restore view (review m9).
          writeMeta();
          restoreNote =
            `⚠ vfkb restored ${rec.restored} journaled entr${rec.restored === 1 ? 'y' : 'ies'} ` +
            `lost from entries.jsonl — likely a destructive git operation on uncommitted brain ` +
            `state (ADR-0064). Verify with kb_list and commit the brain on your next topic branch.\n\n`;
        }
      } catch {
        /* fail-open — recovery must never cost a session its start */
      }
      const additionalContext =
        restoreNote +
        (rest.includes('--naive')
          ? renderNaiveDump(project, undefined, lim ? Number(lim) : undefined)
          : renderResume(project, session));
      session.save();
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
        }),
      );
      return;
    }
    if (sub === 'post-tool-use') {
      const raw = await readStdin();
      try {
        const payload = JSON.parse(raw || '{}');
        const sessionId = effectiveSessionId(
          typeof payload.session_id === 'string' ? payload.session_id : undefined,
        );
        const captured = captureToolCall({
          tool_name: payload.tool_name,
          tool_input: payload.tool_input,
          // Claude Code's PostToolUse payload carries the result under `tool_response`
          // ({stdout,stderr,…}), NOT `tool_result` (verified 2026-06-27). Without this
          // fallback the result was dropped → every live capture classified `ok` → no
          // capture:error → the distiller never fired on a real claude failure (D-iv,
          // the claude analog of the pi tool_call-has-no-result gap). The host-side
          // synthetic seam feeds `tool_result`, so it keeps precedence.
          tool_result: payload.tool_result ?? payload.tool_response,
          call_id: payload.call_id || payload.tool_use_id,
          session_id: sessionId,
        });
        // record the captured id into the session log (Tier-B → continuity signal).
        if (captured) {
          const session = SessionState.load(sessionId);
          session.recordCaptured(captured.id);
          session.save();
        }
      } catch {
        /* malformed payload: capture nothing, never block the tool (exit 0) */
      }
      process.stdout.write('{}');
      return;
    }

    // Stop — conditional end-of-turn decision-capture reminder (RFC-008 / ADR-0027).
    // Verified contract (CLI v2.1.195): emit decision:block + additionalContext to
    // continue the turn; `stop_hook_active` is the native loop guard (never block twice).
    if (sub === 'stop') {
      const raw = await readStdin();
      let input: { stop_hook_active?: boolean; session_id?: string } = {};
      try {
        input = JSON.parse(raw || '{}');
      } catch {
        /* malformed → fail-open: allow the stop, never wedge the turn */
      }
      // Native loop guard first (cheap, git-free): our own re-entry → allow the stop.
      if (input.stop_hook_active) {
        process.stdout.write('{}');
        return;
      }
      // ADR-0039: a real (non-re-entry) Stop = one turn ended — accumulate it on the
      // session record so continuity signals survive across `--resume` turns.
      try {
        const session = SessionState.load(
          effectiveSessionId(typeof input.session_id === 'string' ? input.session_id : undefined),
        );
        session.bumpTurn();
        session.save();
      } catch {
        /* session bookkeeping must never wedge the turn */
      }
      const d = decideStop({ stop_hook_active: false }, gatherStopContext());
      process.stdout.write(
        d.block
          ? JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'Stop',
                decision: 'block',
                additionalContext: d.reminder,
              },
            })
          : '{}',
      );
      return;
    }

    // SessionEnd — GAP 2 (RFC-011 / ADR-0033): auto-commit the brain so `/exit` is
    // safe by default. Cannot block exit / inject context (verified contract, gotcha
    // f0e913b97824) → fire-and-forget; only a `systemMessage` (the main-branch warning)
    // is surfaced. Fail-open: never throw, always exit 0.
    if (sub === 'session-end') {
      const raw = await readStdin();
      let cwd: string | undefined;
      let sessionId: string | undefined;
      try {
        const payload = JSON.parse(raw || '{}');
        if (typeof payload.cwd === 'string') cwd = payload.cwd;
        if (typeof payload.session_id === 'string') sessionId = payload.session_id;
      } catch {
        /* malformed → fall back to process.cwd()/env */
      }
      let systemMessage: string | undefined;
      try {
        const r = runSessionEnd({ cwd, sessionId: effectiveSessionId(sessionId) });
        systemMessage = r.systemMessage;
      } catch {
        /* fail-open: never block exit */
      }
      process.stdout.write(systemMessage ? JSON.stringify({ systemMessage }) : '{}');
      return;
    }

    // PreToolUse gating — deny direct writes to the brain (force engine writes).
    if (sub === 'pre-tool-use') {
      const raw = await readStdin();
      try {
        const payload = JSON.parse(raw || '{}');
        if (isBrainWrite(payload.tool_name, payload.tool_input)) {
          process.stdout.write(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: GATING_REASON,
              },
            }),
          );
          return;
        }
      } catch {
        /* malformed → allow (fail-open: never wedge the harness) */
      }
      process.stdout.write('{}');
      return;
    }
  }

  if (cmd === 'save') {
    const p = parseArgs('save', argsOf(sub, rest), {});
    const r = save(p.positionals.join(' ').trim() || undefined);
    if (r.refused) {
      // NOT a no-op: the brain lives inside a project repo and is committed by that
      // project, not by this command. Printing "no-op" here read as success and left a
      // script believing the brain was saved. Name the actual next step.
      // Exit 0 is DELIBERATE: a refusal is correct behaviour, not an error — this brain
      // is simply not this command's to commit. Scripts should branch on the brain's
      // shape (or use the engine's SaveResult.refused), not on this exit code.
      //
      // The path comes from r.message, which carries the brain the ENGINE resolved.
      // Reading $VFKB_DATA_DIR instead printed the wrong path whenever it was unset and
      // the default (~/.vfkb, under a git-managed home) was what refused.
      process.stdout.write(
        `not committed: ${r.message}\n` +
          '  this brain ships INSIDE a project repo (ADR-0019), so commit it there:\n' +
          '      git add <brain>/entries.jsonl && git commit -m "vfkb: update"\n' +
          '  (a Claude Code session does this for you at session end — ADR-0033)\n',
      );
      return;
    }
    process.stdout.write((r.committed ? 'committed: ' : 'no-op: ') + r.message + '\n');
    return;
  }

  // --- journal purge (--id <id> | --all) — the ADR-0064 §4 redaction escape
  // hatch: removes journal lines and suppresses their (id, updated) pairs so
  // recovery never resurrects a deliberately redacted entry.
  if (cmd === 'journal') {
    if (sub !== 'purge') {
      throw new UsageError('usage: vfkb journal purge (--id <id> | --all)');
    }
    const p = parseArgs('journal purge', rest, { id: 'value', all: 'boolean' });
    const id = flagValue(p, 'id');
    const all = p.flags.has('all');
    if (!!id === all) {
      throw new UsageError('usage: vfkb journal purge (--id <id> | --all)');
    }
    const r = withExclusive(() => purgeJournal(brainDir(), { id, all }));
    process.stdout.write(
      r.purged > 0
        ? `purged ${r.purged} journal line(s); pair(s) suppressed — recovery will never restore them (ADR-0064 §4). Remember: a redaction of entries.jsonl is complete only with this purge.\n`
        : 'no matching journal lines\n',
    );
    return;
  }

  process.stderr.write(USAGE);
  process.exit(1);
}

main();
