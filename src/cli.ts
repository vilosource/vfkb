#!/usr/bin/env node
// vtfkb thin CLI — the face the Claude Code hooks call (ADR-0015 Tier A/B).
// `hook session-start` / `hook post-tool-use` carry the harness JSON contract.

import {
  addEntry,
  captureToolCall,
  readAll,
  renderContextBundle,
  deriveTrust,
} from './engine.js';
import type { AuthorRole, EntryType } from './types.js';

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
    const e = addEntry(type, cleanText(rest), {
      role,
      tags,
      status: flag(rest, 'status') as any,
      provStatus: flag(rest, 'prov-status') as any,
      validUntil: flag(rest, 'valid-until'),
    });
    process.stdout.write(`${e.id}\t[${e.type} ${deriveTrust(e.author.role)}]\t${e.text}\n`);
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

  if (cmd === 'hook') {
    if (sub === 'session-start') {
      await readStdin(); // payload not needed for the bundle
      const additionalContext = renderContextBundle(process.env.VTFKB_PROJECT || 'spike');
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
  }

  process.stderr.write(
    'usage: vtfkb <add|list|context-block|hook session-start|hook post-tool-use>\n',
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
