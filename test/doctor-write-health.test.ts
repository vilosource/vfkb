// ADR-0065 §2 — doctor's `write-health` check.
//
// §0 (scenarios/probes/mcp-disconnect.md, brain 07316bfe69e3) established the
// constraint this test exists to enforce:
//
//   - a CRASHED MCP server is respawned by the harness and loses nothing;
//   - a HUNG one loses the write with NO error and wedges the turn;
//   - so LIVENESS != HEALTH.
//
// Doctor is the CLI face. It probes the engine + filesystem path an agent would
// fall back to, and it CANNOT vouch for the MCP client's pipe — which is exactly
// where §0 found the data loss. The dangerous outcome is therefore not a wrong
// verdict but a TRUE verdict a reader over-reads: "write-health ok" taken to
// mean "my kb_* capture is fine".
//
// That is gotcha 6ad98196b5a2, the sharpest of its session: a doctor line was
// once made MORE CONFIDENT rather than more true, an L4 went green because the
// claim was more quotable, and a unit test ended up DEFENDING the overclaim.
// So the scope disclaimer is pinned here as hard as the behaviour, and the
// must-not-claim assertions are written as negatives that fail if the line ever
// grows into an MCP/capture claim the code does not verify.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor, type DoctorReport } from '../src/doctor.js';

let root: string;
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

function setup() {
  const proj = join(root, 'project');
  const brain = join(proj, '.vfkb');
  const cfg = join(root, 'cfg');
  mkdirSync(join(proj, '.claude'), { recursive: true });
  mkdirSync(brain, { recursive: true });
  mkdirSync(join(cfg, 'plugins'), { recursive: true });
  writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify({}));
  writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: {} }));
  writeFileSync(join(brain, 'entries.jsonl'), '');
  return { proj, brain, cfg };
}

const run = (proj: string, brain: string, cfg: string): DoctorReport =>
  runDoctor({ root: proj, brainDir: brain, env: { HOME: root, CLAUDE_CONFIG_DIR: cfg } });
const check = (r: DoctorReport, name: string) => r.checks.find((c) => c.name === name);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vfkb-wh-'));
});
afterEach(() => {
  try {
    chmodSync(join(root, 'project', '.vfkb'), 0o755);
  } catch {
    /* best effort */
  }
  rmSync(root, { recursive: true, force: true });
});

describe('ADR-0065 §2 — write-health round-trip', () => {
  it('reports ok when the engine can write to the brain dir', () => {
    const { proj, brain, cfg } = setup();
    const c = check(run(proj, brain, cfg), 'write-health');
    expect(c?.status).toBe('ok');
  });

  it('reports a FAILURE when the brain dir is unwritable', () => {
    if (isRoot) return; // chmod is a no-op for root — skip rather than assert something untrue
    const { proj, brain, cfg } = setup();
    chmodSync(brain, 0o555);
    const c = check(run(proj, brain, cfg), 'write-health');
    chmodSync(brain, 0o755);
    expect(c?.status === 'fail' || c?.status === 'warn').toBe(true);
    expect(c?.detail ?? '').toMatch(/EACCES|permission|cannot write/i);
  });

  it('leaves NOTHING behind — no probe file, and entries.jsonl untouched', () => {
    const { proj, brain, cfg } = setup();
    writeFileSync(join(brain, 'entries.jsonl'), '{"id":"a","type":"fact","text":"pre-existing"}\n');
    run(proj, brain, cfg);
    // The committed log must not grow: an append-only store has no "append then
    // remove", and a probe namespace would dirty the working tree every run.
    const body = readdirSync(brain);
    expect(body.filter((f) => /probe/i.test(f))).toEqual([]);
    expect(existsSync(join(brain, 'entries.jsonl'))).toBe(true);
    const entries = require('node:fs').readFileSync(join(brain, 'entries.jsonl'), 'utf8');
    expect(entries).toBe('{"id":"a","type":"fact","text":"pre-existing"}\n');
  });

  it('does not touch entries.jsonl even when the probe FAILS', () => {
    if (isRoot) return;
    const { proj, brain, cfg } = setup();
    writeFileSync(join(brain, 'entries.jsonl'), '{"id":"a"}\n');
    chmodSync(brain, 0o555);
    run(proj, brain, cfg);
    chmodSync(brain, 0o755);
    const entries = require('node:fs').readFileSync(join(brain, 'entries.jsonl'), 'utf8');
    expect(entries).toBe('{"id":"a"}\n');
  });
});

describe('ADR-0065 §2 — the line must not invite a false inference (gotcha 6ad98196b5a2)', () => {
  // §0 proved doctor is blind to the failure that actually loses data. A reader
  // who takes "write-health ok" as "capture is fine" has been misled BY A TRUE
  // STATEMENT — which is why the scope caveat is part of the behaviour, not
  // decoration, and is pinned as such.
  it('names its scope: the CLI/engine/filesystem path', () => {
    const { proj, brain, cfg } = setup();
    const d = check(run(proj, brain, cfg), 'write-health')?.detail ?? '';
    expect(d).toMatch(/CLI|engine|filesystem/i);
  });

  it('explicitly disclaims the MCP path it cannot see', () => {
    const { proj, brain, cfg } = setup();
    const d = check(run(proj, brain, cfg), 'write-health')?.detail ?? '';
    expect(d).toMatch(/MCP/);
    expect(d).toMatch(/does not|cannot|not check/i);
  });

  it('does NOT claim capture, kb_* tools, or the MCP server are healthy', () => {
    // Negative assertions, deliberately: the failure mode here is the line
    // GROWING into a claim the code never verified, and that is what a future
    // "helpful" edit would do.
    const { proj, brain, cfg } = setup();
    const d = check(run(proj, brain, cfg), 'write-health')?.detail ?? '';
    expect(d).not.toMatch(/capture is (working|healthy|fine)/i);
    expect(d).not.toMatch(/kb_\* (?:tools )?(?:are |is )?(?:working|healthy)/i);
    expect(d).not.toMatch(/MCP (?:server |face )?is (?:working|healthy|up)/i);
    expect(d).not.toMatch(/your writes are safe/i);
  });
});
