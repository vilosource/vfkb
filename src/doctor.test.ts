// FR-4 (ADR-0030) inner gate — `vfkb doctor` catches the failure modes a consumer
// trips over: incompatible/stale engine binding, missing/inconsistent wiring.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initProject } from './init.js';
import { runDoctor } from './doctor.js';
import { SCHEMA_VERSION } from './version.js';

let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vfkb-doctor-'));
  // a fake $VFKB_BUNDLE_DIR with the two bundle files present
  home = mkdtempSync(join(tmpdir(), 'vfkb-home-'));
  writeFileSync(join(home, 'vfkb.mjs'), '');
  writeFileSync(join(home, 'vfkb-mcp.mjs'), '');
});

const doctor = (env: Record<string, string | undefined>) =>
  runDoctor({ root, brainDir: join(root, '.vfkb'), env });

const status = (r: ReturnType<typeof runDoctor>, name: string) =>
  r.checks.find((c) => c.name === name)?.status;

describe('vfkb doctor (FR-4)', () => {
  it('a freshly init-ed repo with $VFKB_BUNDLE_DIR set is healthy (ok)', () => {
    initProject(root, { project: 'demo' });
    const r = doctor({ VFKB_BUNDLE_DIR: home });
    expect(r.ok).toBe(true);
    expect(status(r, 'brain↔engine compat')).toBe('ok');
    expect(status(r, '$VFKB_BUNDLE_DIR')).toBe('ok');
    expect(status(r, '.mcp.json')).toBe('ok');
    expect(status(r, '.claude/settings.json')).toBe('ok');
    expect(status(r, 'VFKB_PROJECT')).toBe('ok');
  });

  it('warns (not fails) on a bare repo with no wiring and no $VFKB_BUNDLE_DIR', () => {
    const r = doctor({ VFKB_BUNDLE_DIR: undefined });
    expect(r.ok).toBe(true); // warnings don't fail
    expect(status(r, '$VFKB_BUNDLE_DIR')).toBe('warn');
    expect(status(r, '.mcp.json')).toBe('warn');
    expect(status(r, 'brain manifest')).toBe('warn');
  });

  it('FAILS when the brain schema is newer than the engine (incompatible)', () => {
    initProject(root, { project: 'demo' });
    writeFileSync(
      join(root, '.vfkb', 'manifest.json'),
      JSON.stringify({ schema_version: SCHEMA_VERSION + 1, engine_version: '9.9.9', engine_commit: 'x' }),
    );
    const r = doctor({ VFKB_BUNDLE_DIR: home });
    expect(r.ok).toBe(false);
    expect(status(r, 'brain↔engine compat')).toBe('fail');
  });

  it('FAILS on a VFKB_PROJECT mismatch between .mcp.json and settings', () => {
    initProject(root, { project: 'demo' });
    // corrupt .mcp.json to a different project than the settings hooks
    const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
    mcp.mcpServers.vfkb.env.VFKB_PROJECT = 'other';
    writeFileSync(join(root, '.mcp.json'), JSON.stringify(mcp));
    const r = doctor({ VFKB_BUNDLE_DIR: home });
    expect(r.ok).toBe(false);
    expect(status(r, 'VFKB_PROJECT')).toBe('fail');
  });

  it('warns when a deprecated env alias (VFKB_DIR / VFKB_HOME) is in use', () => {
    initProject(root, { project: 'demo' });
    const r = doctor({ VFKB_BUNDLE_DIR: home, VFKB_DIR: '.vfkb' });
    expect(status(r, 'env (deprecated)')).toBe('warn');
    expect(r.ok).toBe(true); // a deprecation is a warning, not a failure
  });

  it('warns when $VFKB_BUNDLE_DIR is set but the bundles are missing', () => {
    initProject(root, { project: 'demo' });
    const r = doctor({ VFKB_BUNDLE_DIR: mkdtempSync(join(tmpdir(), 'empty-home-')) });
    expect(status(r, '$VFKB_BUNDLE_DIR')).toBe('warn');
  });
});

// ADR-0045 — plugin-wired repos (issue #77): doctor must recognize the plugin as the
// primary wiring and stop prescribing `vfkb init` (which would double-wire the repo).
describe('vfkb doctor — plugin wiring (ADR-0045 / issue #77)', () => {
  const PLUGIN_KEY = 'vfkb@vfkb';

  function wirePlugin(extra: Record<string, unknown> = {}) {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: true }, ...extra }),
    );
  }

  function writeRegistry(entries: unknown) {
    const file = join(mkdtempSync(join(tmpdir(), 'vfkb-plugreg-')), 'installed_plugins.json');
    writeFileSync(file, JSON.stringify({ version: 2, plugins: entries }));
    return file;
  }

  const pluginDoctor = (env: Record<string, string | undefined>, pluginsFile?: string) =>
    runDoctor({ root, brainDir: join(root, '.vfkb'), env, pluginsFile });

  it('plugin-wired repo: wiring checks are OK, no check prescribes `vfkb init`, bundle dir may be unset', () => {
    wirePlugin();
    const file = writeRegistry({ [PLUGIN_KEY]: [{ scope: 'project', projectPath: root, version: '0.2.0' }] });
    const r = pluginDoctor({}, file);
    expect(r.ok).toBe(true);
    expect(status(r, '.mcp.json')).toBe('ok');
    expect(status(r, '.claude/settings.json')).toBe('ok');
    expect(status(r, '$VFKB_BUNDLE_DIR')).toBe('ok'); // unset is fine — the plugin vendors the engine
    expect(status(r, 'plugin')).toBe('ok');
    for (const c of r.checks) expect(c.detail).not.toContain('vfkb init');
  });

  it('reports the installed plugin version as information, without claiming currency', () => {
    wirePlugin();
    const file = writeRegistry({ [PLUGIN_KEY]: [{ scope: 'project', projectPath: root, version: '0.2.0' }] });
    const r = pluginDoctor({}, file);
    const plugin = r.checks.find((c) => c.name === 'plugin');
    expect(plugin?.detail).toContain('0.2.0');
    expect(plugin?.detail).not.toMatch(/up.to.date|latest|current/i);
  });

  it('warns when the plugin is enabled but not in the local install registry', () => {
    wirePlugin();
    const file = writeRegistry({});
    const r = pluginDoctor({}, file);
    expect(status(r, 'plugin')).toBe('warn');
    expect(r.ok).toBe(true); // warn, never fail — doctor may run on a machine without Claude Code
  });

  it('soft-skips the install check when neither HOME nor pluginsFile is available', () => {
    wirePlugin();
    const r = pluginDoctor({}); // no HOME in env, no pluginsFile
    expect(r.checks.find((c) => c.name === 'plugin')).toBeUndefined();
    expect(status(r, '.mcp.json')).toBe('ok'); // wiring recognition does not depend on the registry
    expect(r.ok).toBe(true);
  });

  it('WARNs on double wiring (plugin + leftover init wiring) and advises removal, not `vfkb init`', () => {
    initProject(root, { project: 'demo' }); // writes .mcp.json + hooks (the fallback wiring)
    wirePlugin(); // overwrites settings with plugin config…
    // …but keep the init hooks too, to simulate a genuinely double-wired settings file
    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
    settings.hooks = { Stop: [{ hooks: [{ type: 'command', command: 'node .vfkb/bin/bootstrap.mjs cli hook stop # vfkb' }] }] };
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify(settings));
    const file = writeRegistry({ [PLUGIN_KEY]: [{ scope: 'project', projectPath: root, version: '0.2.0' }] });
    const r = pluginDoctor({}, file);
    expect(status(r, '.mcp.json')).toBe('warn'); // stray fallback MCP server alongside the plugin
    expect(status(r, '.claude/settings.json')).toBe('warn'); // stray fallback hooks alongside the plugin
    const blob = JSON.stringify(r.checks);
    expect(blob).toMatch(/double|alongside/i);
    expect(blob).not.toContain('run `vfkb init`');
    expect(r.ok).toBe(true); // warn tier
  });

  it('detects user-scope enablement via the registry projectPath when settings has no enabledPlugins', () => {
    // no .claude/settings.json enabledPlugins at all — plugin enabled at user scope
    const file = writeRegistry({ [PLUGIN_KEY]: [{ scope: 'project', projectPath: root, version: '0.2.0' }] });
    const r = pluginDoctor({}, file);
    expect(status(r, '.mcp.json')).toBe('ok');
    expect(status(r, '.claude/settings.json')).toBe('ok');
    for (const c of r.checks) expect(c.detail).not.toContain('vfkb init');
  });

  it('an explicit enabledPlugins:false disable beats a lingering registry entry — fallback advice stays intact', () => {
    // The repo deliberately disabled the plugin and runs the init fallback; a stale
    // registry entry must NOT make doctor advise removing the working hooks.
    initProject(root, { project: 'demo' });
    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
    settings.enabledPlugins = { [PLUGIN_KEY]: false };
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify(settings));
    const file = writeRegistry({ [PLUGIN_KEY]: [{ scope: 'project', projectPath: root, version: '0.2.0' }] });
    const r = pluginDoctor({ VFKB_BUNDLE_DIR: home }, file);
    expect(status(r, '.mcp.json')).toBe('ok'); // real init wiring, reported as such
    expect(status(r, '.claude/settings.json')).toBe('ok');
    expect(r.checks.find((c) => c.name === 'plugin')).toBeUndefined();
    expect(JSON.stringify(r.checks)).not.toMatch(/double|alongside|via plugin/i);
  });

  it('reports the install entry for THIS root, not another project\'s (and never masks not-installed with a foreign entry)', () => {
    wirePlugin();
    const file = writeRegistry({
      [PLUGIN_KEY]: [
        { scope: 'project', projectPath: '/somewhere/else', version: '0.1.0' },
        { scope: 'project', projectPath: root, version: '0.2.0' },
      ],
    });
    const r = pluginDoctor({}, file);
    expect(r.checks.find((c) => c.name === 'plugin')?.detail).toContain('0.2.0');

    // only a foreign project's entry exists → the not-installed WARN must NOT be masked
    const foreignOnly = writeRegistry({ [PLUGIN_KEY]: [{ scope: 'project', projectPath: '/somewhere/else', version: '0.1.0' }] });
    const r2 = pluginDoctor({}, foreignOnly);
    expect(status(r2, 'plugin')).toBe('warn');
  });
});
