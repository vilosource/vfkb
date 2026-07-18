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
import { join } from 'node:path';
import { renderCaptureFallback, renderContextBundle, SESSION_BUDGET_CHARS } from '../src/engine.js';

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
  it('names the CLI write path, with the brain dir and a runnable shape', () => {
    const line = renderCaptureFallback();
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
    const line = renderCaptureFallback();
    expect(line).toMatch(/VFKB_DATA_DIR="[^"]+"/);
    expect(line).toMatch(/node "[^"]+"/);
  });

  it('resolves the path from the running process, not a registry lookup', () => {
    // Self-knowable per RFC-035 §1: the renderer IS the vendored bundle.
    const line = renderCaptureFallback();
    const m = line.match(/node "([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m![1].length).toBeGreaterThan(0);
    // It must be an absolute path — a bare relative one would resolve against
    // whatever cwd the agent happens to be in.
    expect(m![1].startsWith('/')).toBe(true);
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
