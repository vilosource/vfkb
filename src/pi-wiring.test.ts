// pi face wiring (ADR-0066) — `vfkb init` scaffolds it, `vfkb doctor` checks it.
//
// The invariant under test is NOT "the files exist". It is that the ONE failure mode
// which is otherwise SILENT gets caught: a pi setup whose bridge cannot find an MCP
// config registers zero kb_* tools, with no error anywhere (brain gotcha 0f1441f9bff2,
// observed live on pi 0.73.1). Every assertion below is paired with the state that must
// NOT produce it, so a guard that stopped guarding goes red.
//
// Design note worth keeping, because it is easy to "fix" backwards: `vfkb init` does
// NOT write `.vfkb/mcp.json`. The package's wrapper extension resolves its own vendored
// MCP server, so an install needs no per-machine env var and no consumer file. A
// `.vfkb/mcp.json` is an OPTIONAL override — absent is healthy, malformed is not.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from './init.js';
import { checkPiWiring, piExtensionOrderProblem, PI_PACKAGE_SOURCE } from './doctor.js';

let root: string;
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vfkb-pi-wiring-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('vfkb init — pi wiring (ADR-0066)', () => {
  it('writes .pi/settings.json loading the git package', () => {
    initProject(root, { project: 'demo' });
    const piSettings = readJson(join(root, '.pi', 'settings.json'));
    expect(piSettings.packages).toContain(PI_PACKAGE_SOURCE);
    expect(PI_PACKAGE_SOURCE.startsWith('git:')).toBe(true); // git-only for milestone 1
  });

  it('does NOT write .vfkb/mcp.json — the package self-resolves, so no $VFKB_BUNDLE_DIR is needed', () => {
    // This is the corrected design. Writing an mcp.json pointing at the consumer's
    // bootstrap would re-impose the per-machine $VFKB_BUNDLE_DIR that ADR-0066 exists
    // to retire, and would silently shadow the package's own bundled server.
    initProject(root, { project: 'demo' });
    expect(existsSync(join(root, '.vfkb', 'mcp.json'))).toBe(false);
  });

  it('is idempotent and does not duplicate the package entry', () => {
    initProject(root, { project: 'demo' });
    const second = initProject(root, { project: 'demo' });
    const piSettings = readJson(join(root, '.pi', 'settings.json'));
    expect(piSettings.packages.filter((p: string) => p === PI_PACKAGE_SOURCE)).toHaveLength(1);
    expect(second.find((c) => c.path === '.pi/settings.json')?.action).toBe('skipped');
  });

  it("preserves a consumer's existing pi settings and other packages", () => {
    mkdirSync(join(root, '.pi'), { recursive: true });
    writeFileSync(
      join(root, '.pi', 'settings.json'),
      JSON.stringify({ defaultModel: 'deepseek-v4-pro', packages: ['npm:someone-elses-pkg'] }),
    );
    initProject(root, { project: 'demo' });
    const piSettings = readJson(join(root, '.pi', 'settings.json'));
    expect(piSettings.defaultModel).toBe('deepseek-v4-pro'); // untouched
    expect(piSettings.packages).toEqual(['npm:someone-elses-pkg', PI_PACKAGE_SOURCE]);
  });

  it('never clobbers an existing brain while adding pi wiring', () => {
    mkdirSync(join(root, '.vfkb'), { recursive: true });
    writeFileSync(join(root, '.vfkb', 'entries.jsonl'), '{"id":"keepme"}\n');
    initProject(root, { project: 'demo' });
    expect(readFileSync(join(root, '.vfkb', 'entries.jsonl'), 'utf8')).toContain('keepme');
  });
});

describe('vfkb doctor — pi wiring checks', () => {
  const wired = { packages: [PI_PACKAGE_SOURCE] };
  const mcpOk = { mcpServers: { vfkb: { command: 'node', args: [] } } };

  it('reports skip (not warn) when pi is simply not wired — pi is optional', () => {
    const checks = checkPiWiring(undefined, undefined, false, false);
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('skip');
  });

  it('is OK with the package listed and NO mcp.json — the normal, healthy install', () => {
    const checks = checkPiWiring(wired, undefined, true, false);
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
    expect(checks.find((c) => c.name === 'pi mcp config')!.detail).toMatch(/bundled MCP server/);
  });

  it('is OK with a well-formed override present', () => {
    const checks = checkPiWiring(wired, mcpOk, true, true);
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
    expect(checks.find((c) => c.name === 'pi mcp override')!.status).toBe('ok');
  });

  it('FAILS on an mcp.json that exists but configures nothing — the silent no-tools override', () => {
    const checks = checkPiWiring(wired, { mcpServers: {} }, true, true);
    const c = checks.find((x) => x.name === 'pi mcp override')!;
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/ZERO kb_\* tools/);
  });

  it('FAILS on an mcp.json holding a bare server spec instead of an mcpServers map', () => {
    // readConfig() pulls `.mcpServers`; a bare spec parses as JSON and yields nothing.
    const checks = checkPiWiring(wired, { command: 'node', args: [] }, true, true);
    expect(checks.find((x) => x.name === 'pi mcp override')!.status).toBe('fail');
  });

  it('WARNS when extensions are hand-listed with no package and no override', () => {
    const checks = checkPiWiring({ extensions: ['/x/vfkb-pi-wrapper.js'] }, undefined, true, false);
    expect(checks.find((c) => c.name === 'pi mcp config')!.status).toBe('warn');
  });

  it('never prescribes `vfkb init` on a plugin-wired repo (issue #77 — that advice scaffolds double wiring)', () => {
    // I broke this invariant while adding these checks; doctor.test.ts caught it.
    // Guarded here too, at the layer that produces the text.
    const pluginWired = true;
    const checks = [
      ...checkPiWiring(wired, { mcpServers: {} }, true, true, pluginWired), // FAIL path
      ...checkPiWiring({ packages: [] }, mcpOk, true, true, pluginWired), // WARN path
      ...checkPiWiring(undefined, undefined, false, false, pluginWired), // SKIP path
    ];
    for (const c of checks) expect(c.detail).not.toContain('vfkb init');
    expect(checks.find((c) => c.status === 'warn')!.detail).toContain('.pi/settings.json');
  });

  it('still prescribes `vfkb init` on a NON-plugin repo (the contrast that keeps the check above honest)', () => {
    const checks = checkPiWiring({ packages: [] }, mcpOk, true, true, false);
    expect(checks.find((c) => c.status === 'warn')!.detail).toContain('vfkb init');
  });

  it('does not fail a Claude-only repo just because pi wiring is absent', () => {
    const checks = checkPiWiring(undefined, undefined, false, false);
    expect(checks.some((c) => c.status === 'fail')).toBe(false);
  });
});

describe('pi extension ORDER — the trap that fails silently', () => {
  // The bridge resolves $VFKB_MCP_CONFIG at module top level, and pi loads extensions
  // sequentially in array order (both verified live on 0.73.1). So a wrapper listed
  // after the bridge is indistinguishable, at runtime, from no wrapper at all.
  const bridge = '/pkg/dist/pi-mcp-bridge.js';
  const wrapper = '/pkg/extensions/vfkb-pi-wrapper.js';

  it('accepts wrapper BEFORE bridge', () => {
    expect(piExtensionOrderProblem({ extensions: [wrapper, bridge] })).toBeUndefined();
  });

  it('rejects wrapper AFTER bridge', () => {
    expect(piExtensionOrderProblem({ extensions: [bridge, wrapper] })).toMatch(/AFTER pi-mcp-bridge/);
  });

  it('rejects a hand-listed bridge with no wrapper at all', () => {
    expect(piExtensionOrderProblem({ extensions: [bridge] })).toMatch(/no wrapper before it/);
  });

  it('stays silent when the bridge is not hand-listed (package manifest governs order)', () => {
    expect(piExtensionOrderProblem({ packages: [PI_PACKAGE_SOURCE] })).toBeUndefined();
    expect(piExtensionOrderProblem({ extensions: ['/some/unrelated-ext.js'] })).toBeUndefined();
    expect(piExtensionOrderProblem(undefined)).toBeUndefined();
  });

  it('surfaces the order problem as a doctor FAIL', () => {
    const ok = { mcpServers: { vfkb: { command: 'node', args: [] } } };
    const checks = checkPiWiring({ extensions: [bridge, wrapper] }, ok, true, true);
    expect(checks.find((c) => c.name === 'pi extension order')?.status).toBe('fail');
  });
});
