// FR-4 (ADR-0030) — `vfkb doctor`: catches the failure modes a consumer trips
// over before they corrupt a brain — an incompatible/stale engine binding, missing
// or inconsistent wiring, and the dual-clone drift signal (a brain last stamped by
// a different engine build). Deterministic; unit-tested (the inner gate per ADR-0023).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION, ENGINE_VERSION, ENGINE_COMMIT } from './version.js';
import { readManifest } from './manifest.js';

export type DoctorStatus = 'ok' | 'warn' | 'fail';
export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}
export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean; // no FAILs
}

function readJson(path: string): any | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function projectFromSettings(settings: any): string | undefined {
  const blob = JSON.stringify(settings ?? '');
  const m = blob.match(/VFKB_PROJECT=([^\s"\\]+)/);
  return m?.[1];
}

// ADR-0045 (issue #77) — plugin wiring detection. Primary signal: a truthy
// `enabledPlugins["vfkb@…"]` in the project's .claude/settings.json (the committed,
// project-scope shipping shape). Fallback signal: an entry in the machine's installed-plugins
// registry whose projectPath is this root (covers user-scope enablement, which never
// appears in the project file).
interface PluginWiring {
  key: string;
  installed?: { version?: string };
  registryReadable: boolean; // false ⇒ install state unverifiable, not absent
}

function detectPluginWiring(settings: any, root: string, pluginsFile: string | undefined): PluginWiring | undefined {
  const registry = pluginsFile ? readJson(pluginsFile) : undefined;
  const findInstall = (key: string) => {
    const entries = registry?.plugins?.[key];
    return Array.isArray(entries) ? entries[0] : undefined;
  };
  const enabled = settings?.enabledPlugins ?? {};
  for (const [key, on] of Object.entries(enabled)) {
    if (/^vfkb@/.test(key) && on) {
      return { key, installed: findInstall(key), registryReadable: registry !== undefined };
    }
  }
  for (const [key, entries] of Object.entries(registry?.plugins ?? {})) {
    if (!/^vfkb@/.test(key) || !Array.isArray(entries)) continue;
    const forRoot = entries.find((e: any) => e?.projectPath === root);
    if (forRoot) return { key, installed: forRoot, registryReadable: true };
  }
  return undefined;
}

export interface DoctorOpts {
  root: string;
  brainDir: string;
  env: Record<string, string | undefined>;
  // Injectable for tests; defaults to the machine's Claude Code plugin registry.
  pluginsFile?: string;
}

export function runDoctor(opts: DoctorOpts): DoctorReport {
  const { root, brainDir, env } = opts;
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: DoctorStatus, detail: string) => checks.push({ name, status, detail });

  // 1. Engine identity (info).
  add('engine', 'ok', `version ${ENGINE_VERSION} · commit ${ENGINE_COMMIT} · schema v${SCHEMA_VERSION}`);

  // Read the project settings once (used by plugin detection, hooks checks, and
  // project-consistency below), and detect ADR-0045 plugin wiring up front — it changes
  // what "healthy" means for the wiring checks AND which advice is safe to give
  // (`vfkb init` on a plugin-wired repo scaffolds double wiring — issue #77).
  const settings = readJson(join(root, '.claude', 'settings.json'));
  const pluginsFile =
    opts.pluginsFile ?? (env.HOME ? join(env.HOME, '.claude', 'plugins', 'installed_plugins.json') : undefined);
  const plugin = detectPluginWiring(settings, root, pluginsFile);

  // 2. Brain ↔ engine compat (the load-bearing check).
  const mf = readManifest(brainDir);
  if (!mf) {
    add(
      'brain manifest',
      'warn',
      plugin
        ? `no manifest.json in ${brainDir} — it will be stamped on the next write`
        : `no manifest.json in ${brainDir} — run \`vfkb init\` (or it will be stamped on next write)`,
    );
  } else if (typeof mf.schema_version !== 'number') {
    add('brain manifest', 'warn', 'manifest has no numeric schema_version');
  } else if (mf.schema_version > SCHEMA_VERSION) {
    add('brain↔engine compat', 'fail', `brain schema v${mf.schema_version} is NEWER than engine v${SCHEMA_VERSION} — update the engine before using this brain`);
  } else if (mf.schema_version < SCHEMA_VERSION) {
    add('brain↔engine compat', 'warn', `brain schema v${mf.schema_version} is older than engine v${SCHEMA_VERSION} — migration may be needed`);
  } else {
    add('brain↔engine compat', 'ok', `schema v${mf.schema_version} matches`);
    // Drift signal: same schema but a different engine build last stamped the brain.
    if (mf.engine_commit && ENGINE_COMMIT !== 'dev' && mf.engine_commit !== ENGINE_COMMIT) {
      add('engine drift', 'warn', `brain last stamped by engine ${mf.engine_commit}, running ${ENGINE_COMMIT} — possible dual-clone drift`);
    }
  }

  // 3. $VFKB_BUNDLE_DIR resolves the bundles (the portability indirection, FR-2).
  // On a plugin-wired repo the plugin vendors its own engine copy (ADR-0045), so an
  // unset bundle dir is healthy, not a gap.
  const home = env.VFKB_BUNDLE_DIR || env.VFKB_HOME;
  if (!home) {
    if (plugin) {
      add('$VFKB_BUNDLE_DIR', 'ok', 'unset — not needed here: the plugin vendors the engine (ADR-0045)');
    } else {
      add('$VFKB_BUNDLE_DIR', 'warn', 'unset — set it once per machine to the vfkb bundles dir (so the wiring resolves the engine)');
    }
  } else if (!existsSync(join(home, 'vfkb.mjs')) || !existsSync(join(home, 'vfkb-mcp.mjs'))) {
    add('$VFKB_BUNDLE_DIR', 'warn', `set to ${home} but vfkb.mjs / vfkb-mcp.mjs not found there (run \`npm run build:bundles\`)`);
  } else {
    add('$VFKB_BUNDLE_DIR', 'ok', home);
  }

  // 3b. Deprecated env-var aliases still in use (ADR-0032) — work, but should be renamed.
  if (env.VFKB_DIR && !env.VFKB_DATA_DIR) {
    add('env (deprecated)', 'warn', 'VFKB_DIR is a deprecated alias — rename it to VFKB_DATA_DIR');
  }
  if (env.VFKB_HOME && !env.VFKB_BUNDLE_DIR) {
    add('env (deprecated)', 'warn', 'VFKB_HOME is a deprecated alias — rename it to VFKB_BUNDLE_DIR');
  }

  // 4. MCP wiring. Plugin-wired repos need no .mcp.json (the plugin bundles the MCP
  // server); one present ALONGSIDE the plugin is double wiring — advise removal, never
  // `vfkb init` (issue #77: that advice is what causes the double wiring).
  const mcp = readJson(join(root, '.mcp.json'));
  const mcpProject = mcp?.mcpServers?.vfkb?.env?.VFKB_PROJECT;
  const mcpPresent = Boolean(mcp?.mcpServers?.vfkb);
  if (plugin && mcpPresent) {
    add('.mcp.json', 'warn', `vfkb MCP server registered ALONGSIDE the plugin (double wiring) — remove the .mcp.json vfkb entry; the plugin is primary (ADR-0045)`);
  } else if (plugin) {
    add('.mcp.json', 'ok', `not needed — MCP server wired via plugin ${plugin.key} (ADR-0045)`);
  } else if (!mcpPresent) {
    add('.mcp.json', 'warn', 'no vfkb MCP server registered — run `vfkb init`');
  } else {
    add('.mcp.json', 'ok', `vfkb server present (project ${mcpProject ?? '?'})`);
  }

  // 5. Hooks wiring (same plugin logic as check 4).
  const hooks = settings?.hooks ?? {};
  const expected = ['SessionStart', 'PreToolUse', 'Stop', 'SessionEnd'];
  const have = expected.filter((e) => JSON.stringify(hooks[e] ?? '').includes('vfkb'));
  if (plugin && have.length > 0) {
    add('.claude/settings.json', 'warn', `vfkb hooks present ALONGSIDE the plugin (double wiring) — remove them; the plugin's hooks are primary (ADR-0045)`);
  } else if (plugin) {
    add('.claude/settings.json', 'ok', `hooks wired via plugin ${plugin.key} (ADR-0045)`);
  } else if (have.length === 0) {
    add('.claude/settings.json', 'warn', 'no vfkb hooks — run `vfkb init`');
  } else if (have.length < expected.length) {
    add('.claude/settings.json', 'warn', `only ${have.join(', ')} wired (expected ${expected.join(', ')})`);
  } else {
    add('.claude/settings.json', 'ok', `${have.join(', ')} wired`);
  }

  // 5a. Hooks must anchor to $CLAUDE_PROJECT_DIR (issue #22 / ADR-0035) — a bare
  // CWD-relative bootstrap path breaks (MODULE_NOT_FOUND) when the session cd's out
  // of the repo root, silently disabling the write-gate and the SessionEnd auto-commit.
  // Skipped on plugin wiring: the plugin owns its hook paths, and any stray fallback
  // hooks are already flagged for removal above — anchoring advice would be moot.
  const hooksBlob = JSON.stringify(hooks ?? '');
  if (!plugin && have.length > 0 && hooksBlob.includes('bootstrap.mjs') && !hooksBlob.includes('CLAUDE_PROJECT_DIR')) {
    add('hooks anchor', 'warn', 'vfkb hooks use a CWD-relative bootstrap path — they break when the session cd\'s out of the repo root; re-run `vfkb init` to anchor them to $CLAUDE_PROJECT_DIR (issue #22)');
  }

  // 5b. The committed bootstrap entry-point (ADR-0031). Fallback wiring only — the
  // plugin resolves its own engine and needs no committed bootstrap.
  if (existsSync(join(root, '.vfkb', 'bin', 'bootstrap.mjs'))) {
    add('bootstrap', 'ok', '.vfkb/bin/bootstrap.mjs present');
  } else if (!plugin && (mcpPresent || have.length > 0)) {
    add('bootstrap', 'warn', 'wiring present but .vfkb/bin/bootstrap.mjs is missing — run `vfkb init`');
  }

  // 5c. Plugin install state (best-effort, informational; ADR-0045). Doctor cannot
  // compare the vendored engine's currency — the version is reported as information,
  // never as "up to date". Soft-skipped when the machine's plugin registry can't even
  // be located (doctor may run where Claude Code isn't installed).
  if (plugin && pluginsFile) {
    if (plugin.installed?.version) {
      add('plugin', 'ok', `${plugin.key} installed, version ${plugin.installed.version} (informational — currency not compared)`);
    } else if (plugin.installed) {
      add('plugin', 'ok', `${plugin.key} installed (version unknown)`);
    } else if (plugin.registryReadable) {
      add('plugin', 'warn', `${plugin.key} enabled in settings but not found in the local plugin registry — run \`/plugin install ${plugin.key}\` in Claude Code`);
    } else {
      add('plugin', 'warn', `${plugin.key} enabled but the plugin registry at ${pluginsFile} is unreadable — install state unverified`);
    }
  }

  // 6. VFKB_PROJECT consistency across the two wiring files.
  const settingsProject = projectFromSettings(settings);
  if (mcpProject && settingsProject && mcpProject !== settingsProject) {
    add('VFKB_PROJECT', 'fail', `mismatch: .mcp.json says "${mcpProject}", settings says "${settingsProject}"`);
  } else if (mcpProject || settingsProject) {
    add('VFKB_PROJECT', 'ok', `${mcpProject ?? settingsProject}`);
  }

  return { checks, ok: !checks.some((c) => c.status === 'fail') };
}

const ICON: Record<DoctorStatus, string> = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL' };

export function renderDoctor(report: DoctorReport): string {
  const lines = report.checks.map((c) => `${ICON[c.status]}  ${c.name} — ${c.detail}`);
  lines.push('');
  lines.push(report.ok ? 'doctor: OK (no failures)' : 'doctor: FAIL — fix the FAIL item(s) above');
  return lines.join('\n');
}
