// FR-4 (ADR-0030) — `vfkb doctor`: catches the failure modes a consumer trips
// over before they corrupt a brain — an incompatible/stale engine binding, missing
// or inconsistent wiring, and the dual-clone drift signal (a brain last stamped by
// a different engine build). Deterministic; unit-tested (the inner gate per ADR-0023).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION, ENGINE_VERSION, ENGINE_COMMIT } from './version.js';
import { readManifest } from './manifest.js';
import type { GitRunner } from './session-end.js';

// `skip` = could not determine, and that is not a defect (offline, no clone,
// directory-source marketplace). RFC-024 §1: this check must NEVER `fail`, and
// must never imply health it did not verify.
export type DoctorStatus = 'ok' | 'warn' | 'fail' | 'skip';
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
  // Prefer the install entry for THIS root; fall back to a user-scope entry; never
  // report another project's install as ours (it would mask the not-installed WARN
  // and can carry the wrong version).
  const findInstall = (key: string) => {
    const entries = registry?.plugins?.[key];
    if (!Array.isArray(entries)) return undefined;
    return entries.find((e: any) => e?.projectPath === root) ?? entries.find((e: any) => e?.scope === 'user');
  };
  const enabled = settings?.enabledPlugins ?? {};
  for (const [key, on] of Object.entries(enabled)) {
    if (/^vfkb@/.test(key) && on) {
      return { key, installed: findInstall(key), registryReadable: registry !== undefined };
    }
  }
  // Registry fallback (user-scope enablement never shows in the project file) — but an
  // EXPLICIT `false` in the project settings is a deliberate disable and always wins:
  // a lingering registry entry must not make doctor advise dismantling working
  // fallback wiring (the #77 failure class, inverted).
  for (const [key, entries] of Object.entries(registry?.plugins ?? {})) {
    if (!/^vfkb@/.test(key) || !Array.isArray(entries)) continue;
    if (enabled[key] === false) continue;
    const forRoot = entries.find((e: any) => e?.projectPath === root);
    if (forRoot) return { key, installed: forRoot, registryReadable: true };
  }
  return undefined;
}

// Claude Code relocates its ENTIRE config dir via CLAUDE_CONFIG_DIR, `plugins/`
// included. Deriving the registry from $HOME alone makes doctor inspect HOST
// state even when pointed at a sandbox — observed 2026-07-09, and a prerequisite
// for any currency check (RFC-024 §1).
function claudeConfigDir(env: Record<string, string | undefined>): string | undefined {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR;
  return env.HOME ? join(env.HOME, '.claude') : undefined;
}

// Read the clone's checked-out sha WITHOUT shelling git: `ls-remote` must be the
// only subcommand this module ever issues, so that "the diagnostic does not
// write" is observable rather than promised.
function localHeadSha(cloneDir: string): string | undefined {
  const head = readFileMaybe(join(cloneDir, '.git', 'HEAD'));
  if (!head) return undefined;
  const ref = head.trim().match(/^ref:\s*(\S+)$/)?.[1];
  if (!ref) return /^[0-9a-f]{40}$/.test(head.trim()) ? head.trim() : undefined; // detached HEAD
  const loose = readFileMaybe(join(cloneDir, '.git', ...ref.split('/')));
  if (loose) return loose.trim();
  const packed = readFileMaybe(join(cloneDir, '.git', 'packed-refs'));
  for (const line of packed?.split('\n') ?? []) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === ref) return sha;
  }
  return undefined;
}

function readFileMaybe(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

// Read-only, short-timeout. `git fetch` is rejected: it writes refs and objects
// into the user's clone and can contend on the repo lock with a running Claude
// Code. A diagnostic must not write.
const realGit: GitRunner = (args, cwd) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes' },
  });

/**
 * Plugin currency (RFC-024 §1) — the check that would have caught the 2026-07-09
 * incident: the plugin was correctly packaged and correctly installed, but the
 * operator's MARKETPLACE CLONE never advanced, so `plugin update` had nothing
 * newer to install and nothing said so.
 *
 * One axis: compare the clone's checked-out sha to its remote's HEAD via
 * `git ls-remote` (read-only). Behind → warn, naming the remedy. Offline,
 * unreachable, no clone, or a directory-source marketplace → skip, NEVER fail.
 * A detector nobody runs detects nothing, so it is attempted by default with a
 * short timeout.
 *
 * Returns the verdict rather than emitting it, so the install-state line above
 * can say whether currency was compared instead of asserting it was not.
 */
function checkCurrency(
  plugin: PluginWiring,
  opts: DoctorOpts,
  configDir: string | undefined,
): { status: DoctorStatus; detail: string } {
  const marketplace = plugin.key.split('@')[1];
  const kmFile =
    opts.knownMarketplacesFile ?? (configDir ? join(configDir, 'plugins', 'known_marketplaces.json') : undefined);
  const entry = kmFile ? readJson(kmFile)?.[marketplace] : undefined;
  const skip = (detail: string) => ({ status: 'skip' as const, detail });

  if (!entry) return skip(`no marketplace "${marketplace}" in ${kmFile ?? 'the plugin registry'} — cannot check currency`);
  // A directory source records the path itself and creates no clone — there is
  // nothing that can be stale.
  if (entry.source?.source !== 'github') {
    return skip(`marketplace "${marketplace}" is a ${entry.source?.source ?? 'unknown'}-source — no clone to compare`);
  }
  if (!entry.installLocation || !existsSync(join(entry.installLocation, '.git'))) {
    return skip(`marketplace clone not found at ${entry.installLocation ?? '(unset installLocation)'}`);
  }

  const clone: string = entry.installLocation;
  const local = localHeadSha(clone);
  let remote: string | undefined;
  try {
    remote = (opts.git ?? realGit)(['ls-remote', 'origin', 'HEAD'], clone).trim().split(/\s+/)[0];
  } catch {
    remote = undefined;
  }

  if (!local) return skip(`cannot read the checked-out revision of ${clone}`);
  // Offline is the common case. Say so plainly: vfkb cannot tell you that you
  // are running old code, and must not imply health it did not verify.
  if (!remote || !/^[0-9a-f]{7,40}$/.test(remote)) {
    return skip(`remote unreachable (offline?) — cannot tell whether ${marketplace} is current`);
  }
  if (remote === local) {
    return { status: 'ok', detail: `${marketplace} marketplace clone matches its remote (${local.slice(0, 7)})` };
  }
  return {
    status: 'warn',
    detail:
      `${marketplace} marketplace clone is STALE — it sits at ${local.slice(0, 7)} but the remote is at ` +
      `${remote.slice(0, 7)}. You are running an old copy of the plugin, and \`claude plugin update\` ` +
      `will find nothing newer until the clone advances. Remedy: ` +
      `\`claude plugin marketplace update ${marketplace}\` then \`claude plugin update ${plugin.key}\`, ` +
      `then restart Claude Code.`,
  };
}

export interface DoctorOpts {
  root: string;
  brainDir: string;
  env: Record<string, string | undefined>;
  // Injectable for tests; defaults to the machine's Claude Code plugin registry.
  pluginsFile?: string;
  knownMarketplacesFile?: string;
  git?: GitRunner; // injectable for tests (the src/session-end.ts seam)
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
  const configDir = claudeConfigDir(env);
  const pluginsFile =
    opts.pluginsFile ?? (configDir ? join(configDir, 'plugins', 'installed_plugins.json') : undefined);
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

  // 5c/5d. Plugin install state, and whether that installed copy is CURRENT.
  //
  // These are computed together because they used to contradict each other. The
  // install line said "(informational — currency not compared)" while the very
  // next line compared it. An agent reading the report inferred staleness from
  // the bare version number plus that hedge, and reported a level clone as "an
  // older version" — the sole contrast leak in the doctor-staleness L4, sitting
  // exactly at ADR-0022's error budget. Every individual line was true; the
  // report as a whole misled. That is a defect in a diagnostic.
  //
  // So the currency verdict is computed FIRST, and the install line says
  // "currency not compared" only when it genuinely was not.
  const currency = plugin ? checkCurrency(plugin, opts, configDir) : undefined;

  if (plugin && pluginsFile) {
    if (plugin.installed?.version) {
      const compared = currency && currency.status !== 'skip';
      add(
        'plugin',
        'ok',
        compared
          ? `${plugin.key} installed, version ${plugin.installed.version} — see \`plugin currency\` below`
          : `${plugin.key} installed, version ${plugin.installed.version} (currency not compared)`,
      );
    } else if (plugin.installed) {
      add('plugin', 'ok', `${plugin.key} installed (version unknown)`);
    } else if (plugin.registryReadable) {
      add('plugin', 'warn', `${plugin.key} enabled in settings but not found in the local plugin registry — run \`/plugin install ${plugin.key}\` in Claude Code`);
    } else {
      add('plugin', 'warn', `${plugin.key} enabled but the plugin registry at ${pluginsFile} is missing or unreadable — install state unverified`);
    }
  }

  if (currency) add('plugin currency', currency.status, currency.detail);

  // 6. VFKB_PROJECT consistency across the two wiring files.
  const settingsProject = projectFromSettings(settings);
  if (mcpProject && settingsProject && mcpProject !== settingsProject) {
    add('VFKB_PROJECT', 'fail', `mismatch: .mcp.json says "${mcpProject}", settings says "${settingsProject}"`);
  } else if (mcpProject || settingsProject) {
    add('VFKB_PROJECT', 'ok', `${mcpProject ?? settingsProject}`);
  }

  return { checks, ok: !checks.some((c) => c.status === 'fail') };
}

const ICON: Record<DoctorStatus, string> = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' };

export function renderDoctor(report: DoctorReport): string {
  const lines = report.checks.map((c) => `${ICON[c.status]}  ${c.name} — ${c.detail}`);
  lines.push('');
  lines.push(report.ok ? 'doctor: OK (no failures)' : 'doctor: FAIL — fix the FAIL item(s) above');
  return lines.join('\n');
}
