// FR-3 (ADR-0030) — `vfkb import`: bring existing knowledge across so "migrate a
// project to vfkb" is a real verb, not a clean-slate restart. All imports route
// through the engine (the write-gate applies) and are stamped role=import (Trust
// 'import') + an `imported` tag — the mapping is explicitly LOSSY (ADR-0030).
//
//   --from-mykb <areaDir|name>  map a mykb area's *.jsonl into vfkb envelopes
//   --from-adr <dir>            one `link` per ADR markdown file (default docs/adr)
//   --from-markdown <file>      attach a historical doc as a referenced source

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { addEntry } from './engine.js';
import type { EntryType, KnowledgeEntry } from './types.js';

export interface ImportResult {
  id: string;
  type: EntryType;
  text: string;
}

const MYKB_FILES: Record<string, EntryType> = {
  'decisions.jsonl': 'decision',
  'facts.jsonl': 'fact',
  'gotchas.jsonl': 'gotcha',
  'patterns.jsonl': 'pattern',
  'links.jsonl': 'link',
};

function stamp(type: EntryType, text: string, tags: string[], verified: boolean): ImportResult {
  const e = addEntry(type, text, {
    role: 'import',
    tags: ['imported', ...tags.filter((t) => t !== 'imported')],
    provStatus: verified ? 'verified' : 'unverified',
  });
  return { id: e.id, type: e.type, text: e.text };
}

// mykb envelope -> vfkb text (lossy: area/zone/created/rejected fold or drop).
function mykbText(type: EntryType, e: any): string {
  const parts = [String(e.text ?? '').trim()];
  if (type === 'decision' && e.why) parts.push(`Why: ${e.why}`);
  if (type === 'decision' && e.rejected) parts.push(`Rejected: ${e.rejected}`);
  if (type === 'gotcha' && e.resolution) parts.push(`Resolution: ${e.resolution}`);
  if (type === 'link' && e.url) return `${parts[0]} → ${e.url}`;
  return parts.filter(Boolean).join('\n\n');
}

export function resolveMykbArea(nameOrDir: string): string {
  if (existsSync(nameOrDir) && statSync(nameOrDir).isDirectory()) return nameOrDir;
  return join(homedir(), '.mykb', 'areas', nameOrDir);
}

export function fromMykb(areaDir: string): ImportResult[] {
  if (!existsSync(areaDir)) throw new Error(`mykb area not found: ${areaDir}`);
  const out: ImportResult[] = [];
  for (const [file, type] of Object.entries(MYKB_FILES)) {
    const path = join(areaDir, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let e: any;
      try {
        e = JSON.parse(trimmed);
      } catch {
        continue; // skip a malformed line, don't abort the migration
      }
      const text = mykbText(type, e);
      if (!text) continue;
      const verified = e?.provenance?.status === 'verified';
      out.push(stamp(type, text, Array.isArray(e.tags) ? e.tags : [], verified));
    }
  }
  return out;
}

function mdTitle(path: string): string {
  try {
    const heading = readFileSync(path, 'utf8').split(/\r?\n/).find((l) => l.startsWith('# '));
    if (heading) return heading.replace(/^#\s+/, '').trim();
  } catch {}
  return basename(path, extname(path));
}

export function fromAdr(dir = 'docs/adr'): ImportResult[] {
  if (!existsSync(dir)) throw new Error(`ADR dir not found: ${dir}`);
  const out: ImportResult[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (extname(file) !== '.md' || /readme/i.test(file)) continue;
    const rel = join(dir, file);
    out.push(stamp('link', `${mdTitle(rel)} → ${rel}`, ['adr'], false));
  }
  return out;
}

export function fromMarkdown(file: string): ImportResult[] {
  if (!existsSync(file)) throw new Error(`markdown file not found: ${file}`);
  return [stamp('link', `${mdTitle(file)} → ${file}`, ['doc'], false)];
}
