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
import { SessionState } from './session.js';
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
import { runDoctor, renderDoctor } from './doctor.js';
import { fromMykb, fromAdr, fromMarkdown, resolveMykbArea } from './import.js';
import type { AuthorRole, EntryType, Zone, DecisionStatus } from './types.js';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    // Guard: if nothing arrives, don't hang forever.
    setTimeout(() => resolve(data), 2000).unref?.();
  });
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [cmd, sub, ...rest] = process.argv.slice(2);

  // --- add <type> <text> [--role] [--tag a,b] [--why …] [--status] [--prov-status] [--valid-until] ---
  if (cmd === 'add') {
    const type = sub as EntryType;
    const role = (flag(rest, 'role') as AuthorRole) || 'executor';
    const tags = flag(rest, 'tag')?.split(',').map((t) => t.trim()).filter(Boolean) ?? [];
    try {
      const e = addEntry(type, cleanText(rest), {
        role,
        why: flag(rest, 'why'),
        tags,
        status: flag(rest, 'status') as any,
        provStatus: flag(rest, 'prov-status') as any,
        validUntil: flag(rest, 'valid-until'),
        zone: flag(rest, 'zone') as any,
        constitutional: rest.includes('--constitutional'),
      });
      process.stdout.write(`${e.id}\t[${e.type} ${deriveTrust(e.author.role)}]\t${e.text}\n`);
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    }
    return;
  }

  // init [project]: FR-1 (ADR-0030) — idempotently scaffold THIS repo (cwd) as a
  // vfkb consumer (portable $VFKB_HOME wiring + .gitignore + empty brain + snippet).
  if (cmd === 'init') {
    const root = process.cwd();
    const project = (sub && !sub.startsWith('--') ? sub : undefined) || process.env.VFKB_PROJECT;
    const changes = initProject(root, { project });
    const resolved = project || root.split(/[/\\]/).filter(Boolean).pop() || 'project';
    for (const c of changes) process.stdout.write(`${c.action}\t${c.path}\n`);
    process.stdout.write('\n' + approvalNotice(resolved) + '\n');
    return;
  }

  // import: FR-3 (ADR-0030) — migrate existing knowledge into the brain (lossy,
  // role=import). --from-mykb <area> | --from-adr [dir] | --from-markdown <file>.
  if (cmd === 'import') {
    const args = [sub, ...rest].filter((a): a is string => a !== undefined);
    const results: { id: string; type: string; text: string }[] = [];
    try {
      if (args.includes('--from-adr')) results.push(...fromAdr(flag(args, 'from-adr') || 'docs/adr'));
      const md = flag(args, 'from-markdown');
      if (md) results.push(...fromMarkdown(md));
      const mykb = flag(args, 'from-mykb');
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
  if (cmd === 'doctor') {
    const report = runDoctor({
      root: process.cwd(),
      brainDir: process.env.VFKB_DATA_DIR || process.env.VFKB_DIR || '.vfkb',
      env: process.env,
    });
    process.stdout.write(renderDoctor(report) + '\n');
    if (!report.ok) process.exit(1);
    return;
  }

  if (cmd === 'list') {
    for (const e of readAll()) {
      process.stdout.write(
        `${e.id}\t${e.type}\t${deriveTrust(e.author.role)}\t${e.provenance.status}\t${e.text}\n`,
      );
    }
    return;
  }

  if (cmd === 'context-block') {
    process.stdout.write(renderContextBundle(sub || 'spike'));
    return;
  }

  if (cmd === 'map') {
    process.stdout.write(renderContextMap() + '\n');
    return;
  }

  // context [project] | context init: the project context doc (D-ii / ADR-0025) — the
  // assembled "agent's first read" (authored spine + derived Constitution/Map/decisions).
  // `init` scaffolds the authored spine (<brain>/context.md) if absent.
  if (cmd === 'context') {
    if (sub === 'init') {
      const { created, path } = initContextSpine();
      process.stdout.write(`${created ? 'created' : 'exists'}\t${path}\n`);
      return;
    }
    const project = (sub && !sub.startsWith('--') ? sub : undefined) || process.env.VFKB_PROJECT || 'spike';
    process.stdout.write(renderContext(project));
    return;
  }

  // resume [project]: the session-continuity render (ADR-0020) — prior-session
  // digest (derived) + the live knowledge bundle. The MCP-pull-floor / CLI face.
  if (cmd === 'resume') {
    const project = (sub && !sub.startsWith('--') ? sub : undefined) || process.env.VFKB_PROJECT || 'spike';
    process.stdout.write(renderResume(project, SessionState.load()) + '\n');
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
    try {
      if (sub === 'dups') {
        const dups = findLexicalDuplicates();
        for (const d of dups) process.stdout.write(`DUP\tloser=${d.loser}\twinner=${d.winner}\n`);
        if (dups.length === 0) process.stdout.write('no exact lexical duplicates\n');
      } else if (sub === 'signal') {
        const kind = rest[1];
        if (kind !== 'helpful' && kind !== 'harmful') {
          process.stderr.write('usage: vfkb curate signal <id> <helpful|harmful>\n');
          process.exit(1);
        }
        recordSignal(rest[0], kind, 'operator');
        const t = tally(rest[0]);
        process.stdout.write(
          `signal ${kind} -> ${rest[0]} (helpful ${t.helpful} / harmful ${t.harmful} / net ${t.net}` +
            `${eligibleForPromotion(rest[0]) ? ', promotable' : ''})\n`,
        );
      } else if (sub === 'promote-auto') {
        const e = promoteIfCorroborated(rest[0]);
        process.stdout.write(`promoted (corroborated) ${e.id} -> ${e.zone}\n`);
      } else if (sub === 'promote') {
        const e = promote(rest[0]);
        process.stdout.write(`promoted ${e.id} -> ${e.zone}\n`);
      } else if (sub === 'archive') {
        const e = archive(rest[0]);
        process.stdout.write(`archived ${e.id}\n`);
      } else if (sub === 'merge') {
        mergeDuplicate(rest[0], rest[1]);
        process.stdout.write(`merged ${rest[0]} -> ${rest[1]} (loser archived)\n`);
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
    const session = SessionState.load();
    const note = cleanText([sub, ...rest].filter((a) => a !== undefined));
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
    const lim = flag([sub, ...rest], 'limit');
    process.stdout.write(renderNaiveDump(sub && !sub.startsWith('--') ? sub : 'spike', undefined, lim ? Number(lim) : undefined));
    return;
  }

  // supersede <oldId> <text...> [--role r] [--why w]
  if (cmd === 'supersede') {
    try {
      const e = supersede(sub, cleanText(rest), {
        role: (flag(rest, 'role') as AuthorRole) || 'human',
        why: flag(rest, 'why'),
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
    const args = [sub, ...rest].filter((a) => a !== undefined);
    const text = args
      .filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
      .join(' ');
    const limit = flag(args, 'limit');
    const { results, diagnosis } = queryExplained({
      text: text || undefined,
      type: flag(args, 'type') as EntryType,
      zone: flag(args, 'zone') as Zone,
      status: flag(args, 'status') as DecisionStatus,
      tags: flag(args, 'tag')?.split(',').map((t) => t.trim()).filter(Boolean),
      authorRole: flag(args, 'role') as AuthorRole,
      verifiedOnly: args.includes('--verified'),
      limit: limit ? Number(limit) : undefined,
      includeStale: args.includes('--stale'),
      includeSuperseded: args.includes('--superseded'),
    });
    for (const e of results) {
      process.stdout.write(`${e.id}\t${e.type}\t${deriveTrust(e.author.role)}\t${e.text}\n`);
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

  if (cmd === 'hook') {
    if (sub === 'session-start') {
      await readStdin(); // payload not needed for the bundle
      const project = process.env.VFKB_PROJECT || 'spike';
      // --naive = the mykb-v1-style flat dump (L4 contrast baseline only); --limit N truncates it.
      const lim = flag(rest, 'limit');
      // The Tier-A payload is the RESUME render (ADR-0020): prior-session digest +
      // the live knowledge bundle, both derived. Persist this session's record so the
      // NEXT session can resume from it (append-only; no-op without KB_SESSION_ID).
      const session = SessionState.load();
      const additionalContext = rest.includes('--naive')
        ? renderNaiveDump(project, undefined, lim ? Number(lim) : undefined)
        : renderResume(project, session);
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
        });
        // record the captured id into the session log (Tier-B → continuity signal).
        if (captured) {
          const session = SessionState.load();
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
      let input: { stop_hook_active?: boolean } = {};
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
        const r = runSessionEnd({ cwd, sessionId });
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
    const r = save([sub, ...rest].filter((a) => a && !a.startsWith('--')).join(' ') || undefined);
    process.stdout.write((r.committed ? 'committed: ' : 'no-op: ') + r.message + '\n');
    return;
  }

  process.stderr.write(
    'usage: vfkb <add|list|search|query|map|context|context init|resume|resume-note|curate|distill|save|context-block|' +
      'hook session-start|hook pre-tool-use|hook post-tool-use|hook stop|hook session-end>\n',
  );
  process.exit(1);
}

// Join all non-flag, non-flag-value args into the entry text.
function cleanText(args: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++; // skip the flag's value
      continue;
    }
    out.push(args[i]);
  }
  return out.join(' ').trim();
}

function isFlagValue(args: string[], a: string): boolean {
  const i = args.indexOf(a);
  return i > 0 && args[i - 1].startsWith('--');
}

main();
