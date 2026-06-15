#!/usr/bin/env node
// vtfkb thin CLI — the face the Claude Code hooks call (ADR-0015 Tier A/B).
// `hook session-start` / `hook post-tool-use` carry the harness JSON contract.

import {
  addEntry,
  captureToolCall,
  readAll,
  renderContextBundle,
  renderContextMap,
  renderNaiveDump,
  supersede,
  deriveTrust,
} from './engine.js';
import { queryExplained } from './read.js';
import { isBrainWrite, GATING_REASON } from './gating.js';
import { save } from './git.js';
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

  // --- add <type> <text> [--role] [--tag a,b] [--status] [--prov-status] [--valid-until] ---
  if (cmd === 'add') {
    const type = sub as EntryType;
    const role = (flag(rest, 'role') as AuthorRole) || 'executor';
    const tags = flag(rest, 'tag')?.split(',').map((t) => t.trim()).filter(Boolean) ?? [];
    try {
      const e = addEntry(type, cleanText(rest), {
        role,
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

  // context-block-naive: mykb-v1-style flat unfiltered dump (L4 contrast baseline).
  // --limit N truncates load-order (oldest-first) to N entries (reproduces the
  // budget-drops-newest incident).
  if (cmd === 'context-block-naive') {
    const lim = flag([sub, ...rest], 'limit');
    process.stdout.write(renderNaiveDump(sub && !sub.startsWith('--') ? sub : 'spike', undefined, lim ? Number(lim) : undefined));
    return;
  }

  // supersede <oldId> <text...> [--role r]
  if (cmd === 'supersede') {
    try {
      const e = supersede(sub, cleanText(rest), { role: (flag(rest, 'role') as AuthorRole) || 'human' });
      process.stdout.write(`${e.id}\tsupersedes ${sub}\t${e.text}\n`);
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    }
    return;
  }

  // search/query: vtfkb search <text> [--type t] [--tag a,b] [--zone z] [--status s]
  //               [--role r] [--limit N] [--stale] [--superseded]
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
      const project = process.env.VTFKB_PROJECT || 'spike';
      // --naive = the mykb-v1-style flat dump (L4 contrast baseline only); --limit N truncates it.
      const lim = flag(rest, 'limit');
      const additionalContext = rest.includes('--naive')
        ? renderNaiveDump(project, undefined, lim ? Number(lim) : undefined)
        : renderContextBundle(project);
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
        captureToolCall({
          tool_name: payload.tool_name,
          tool_input: payload.tool_input,
          tool_result: payload.tool_result,
          call_id: payload.call_id || payload.tool_use_id,
        });
      } catch {
        /* malformed payload: capture nothing, never block the tool (exit 0) */
      }
      process.stdout.write('{}');
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
    'usage: vtfkb <add|list|search|query|map|save|context-block|' +
      'hook session-start|hook pre-tool-use|hook post-tool-use>\n',
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
