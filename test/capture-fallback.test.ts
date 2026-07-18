// ADR-0065 §1 ← RFC-035 — the injected capture-fallback line.
//
// A dead MCP face does not imply a dead CLI: they are separate processes over the
// same engine bundle, and with ADR-0064's journal the CLI write is exactly as
// durable. The fallback already existed; what was missing is that an agent
// mid-loss has no reason to know it. So the line must actually be THERE, be
// runnable, and survive budget pressure — otherwise it is documentation that
// vanishes exactly when it is needed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { renderCaptureFallback, renderContextBundle, resolveCliFace, SESSION_BUDGET_CHARS } from '../src/engine.js';

let brain: string;
let prevDir: string | undefined;

beforeEach(() => {
  brain = mkdtempSync(join(tmpdir(), 'vfkb-fallback-'));
  prevDir = process.env.VFKB_DATA_DIR;
  process.env.VFKB_DATA_DIR = brain;
});
afterEach(() => {
  if (prevDir === undefined) delete process.env.VFKB_DATA_DIR;
  else process.env.VFKB_DATA_DIR = prevDir;
  rmSync(brain, { recursive: true, force: true });
});

describe('ADR-0065 §1 — the capture-fallback line', () => {
  it('emits an honest marker when no CLI face can be found, never a wrong path', () => {
    const d = join(brain, 'nohost');
    mkdirSync(d, { recursive: true });
    const line = renderCaptureFallback(d);
    expect(line).toMatch(/not found beside the engine/);
    expect(line).not.toMatch(/node "/);
  });

  it('names the CLI write path, with the brain dir and a runnable shape', () => {
    const d = join(brain, 'r');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'cli.js'), '');
    const line = renderCaptureFallback(d);
    expect(line).toContain('capture fallback');
    expect(line).toContain(brain);
    // Absolute, not the configured spelling: a relative VFKB_DATA_DIR (".vfkb")
    // pasted from a different cwd would create a SECOND brain in the wrong place.
    const bd = line.match(/VFKB_DATA_DIR="([^"]+)"/);
    expect(bd).not.toBeNull();
    expect(bd![1].startsWith('/')).toBe(true);
    expect(line).toMatch(/VFKB_DATA_DIR=/);
    expect(line).toMatch(/node .+ add <type>/);
  });

  it('QUOTES both paths — an unquoted path truncates at the first space', () => {
    // Plugin cache paths carry a version segment and may contain spaces. An
    // unquoted command would silently run against the wrong path: precisely the
    // quiet-failure class this ADR exists to eliminate.
    const d = join(brain, 'q');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'cli.js'), '');
    const line = renderCaptureFallback(d);
    expect(line).toMatch(/VFKB_DATA_DIR="[^"]+"/);
    expect(line).toMatch(/node "[^"]+"/);
  });

  it('names a CLI face — never the MCP server or a host script', () => {
    // The assertion that matters. "absolute and non-empty" was TRUE of
    // `node ".../dist/mcp-server.js"`, a command that starts a stdio server,
    // blocks on stdin and writes nothing — shipped and unnoticed until the
    // PR #217 review. Pin the filename, not just the shape.
    // Given an MCP-face directory, it must still name the CLI sibling.
    const d = join(brain, 'bundles');
    mkdirSync(d, { recursive: true });
    for (const f of ['vfkb.mjs', 'vfkb-mcp.mjs']) writeFileSync(join(d, f), '');
    const line = renderCaptureFallback(d);
    const m = line.match(/node "([^"]+)"/);
    expect(m).not.toBeNull();
    expect(basename(m![1])).toMatch(/^(vfkb\.mjs|cli\.js|cli\.mjs)$/);
    expect(m![1]).not.toMatch(/mcp-server|vfkb-mcp/);
  });

  it('ABSOLUTE-ises a relative brain dir (a second brain in the wrong cwd)', () => {
    // Guards the off-spec absolute-ising: with VFKB_DATA_DIR always absolute in
    // the other arms, dropping resolve() was undetectable (review minor 4).
    process.env.VFKB_DATA_DIR = '.vfkb';
    const m = renderCaptureFallback().match(/VFKB_DATA_DIR="([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m![1].startsWith('/')).toBe(true);
    expect(m![1].endsWith('.vfkb')).toBe(true);
  });

  describe('resolveCliFace — the layout matrix behind that guarantee', () => {
    const mk = (dir: string, files: string[]) => {
      mkdirSync(dir, { recursive: true });
      for (const f of files) writeFileSync(join(dir, f), '');
      return dir;
    };

    it('plugin bundle layout: prefers vfkb.mjs over its MCP sibling', () => {
      const d = mk(join(brain, 'bundles'), ['vfkb.mjs', 'vfkb-mcp.mjs']);
      expect(basename(resolveCliFace(d)!)).toBe('vfkb.mjs');
    });

    it('npm dist layout: finds cli.js beside mcp-server.js', () => {
      const d = mk(join(brain, 'dist'), ['cli.js', 'mcp-server.js']);
      expect(basename(resolveCliFace(d)!)).toBe('cli.js');
    });

    it('returns undefined when no CLI face is present, rather than guessing', () => {
      const d = mk(join(brain, 'hostbin'), ['some-host.mjs']);
      expect(resolveCliFace(d)).toBeUndefined();
    });
  });

  it('appears in the injected bundle', () => {
    writeFileSync(join(brain, 'entries.jsonl'), '');
    expect(renderContextBundle('proj')).toContain('capture fallback');
  });

  it('SURVIVES budget pressure — it is preamble, never a ranked line', () => {
    // The failure this guards: under enough entries the line gets budget-dropped
    // and is missing from exactly the loaded sessions most likely to hit a write
    // failure. Fill well past the 10k budget.
    mkdirSync(brain, { recursive: true });
    const rows: string[] = [];
    for (let i = 0; i < 400; i++) {
      rows.push(
        JSON.stringify({
          id: `f${String(i).padStart(4, '0')}`,
          type: 'fact',
          text: `padding entry ${i} ` + 'x'.repeat(120),
          created: '2026-07-18T00:00:00.000Z',
          updated: '2026-07-18T00:00:00.000Z',
          author_role: 'human',
          zone: 'established',
        }),
      );
    }
    writeFileSync(join(brain, 'entries.jsonl'), rows.join('\n') + '\n');
    const bundle = renderContextBundle('proj');
    expect(bundle.length).toBeLessThanOrEqual(SESSION_BUDGET_CHARS);
    expect(bundle).toContain('capture fallback');
    // And the pressure is real — the render did have to drop ranked entries.
    expect(bundle).not.toContain('padding entry 399');
    // STRUCTURAL, not incidental: presence alone would also hold for a line
    // merely appended when budget happened to remain. Being preamble means it
    // sits ABOVE the ranked entries, so the budget loop can never reach it.
    expect(bundle.indexOf('capture fallback')).toBeLessThan(bundle.indexOf('padding entry 0'));
  });

  it('sits above the ranked entries in an unpressured render too', () => {
    writeFileSync(
      join(brain, 'entries.jsonl'),
      JSON.stringify({
        id: 'a1',
        type: 'fact',
        text: 'ranked sentinel RS-1',
        created: '2026-07-18T00:00:00.000Z',
        updated: '2026-07-18T00:00:00.000Z',
        author_role: 'human',
        zone: 'established',
      }) + '\n',
    );
    const bundle = renderContextBundle('proj');
    expect(bundle).toContain('RS-1');
    expect(bundle.indexOf('capture fallback')).toBeLessThan(bundle.indexOf('RS-1'));
  });
});
