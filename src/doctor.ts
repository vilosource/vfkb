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

export function runDoctor(opts: { root: string; brainDir: string; env: Record<string, string | undefined> }): DoctorReport {
  const { root, brainDir, env } = opts;
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: DoctorStatus, detail: string) => checks.push({ name, status, detail });

  // 1. Engine identity (info).
  add('engine', 'ok', `version ${ENGINE_VERSION} · commit ${ENGINE_COMMIT} · schema v${SCHEMA_VERSION}`);

  // 2. Brain ↔ engine compat (the load-bearing check).
  const mf = readManifest(brainDir);
  if (!mf) {
    add('brain manifest', 'warn', `no manifest.json in ${brainDir} — run \`vfkb init\` (or it will be stamped on next write)`);
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
  const home = env.VFKB_BUNDLE_DIR || env.VFKB_HOME;
  if (!home) {
    add('$VFKB_BUNDLE_DIR', 'warn', 'unset — set it once per machine to the vfkb bundles dir (so the wiring resolves the engine)');
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

  // 4. MCP wiring.
  const mcp = readJson(join(root, '.mcp.json'));
  const mcpProject = mcp?.mcpServers?.vfkb?.env?.VFKB_PROJECT;
  if (!mcp?.mcpServers?.vfkb) {
    add('.mcp.json', 'warn', 'no vfkb MCP server registered — run `vfkb init`');
  } else {
    add('.mcp.json', 'ok', `vfkb server present (project ${mcpProject ?? '?'})`);
  }

  // 5. Hooks wiring.
  const settings = readJson(join(root, '.claude', 'settings.json'));
  const hooks = settings?.hooks ?? {};
  const expected = ['SessionStart', 'PreToolUse', 'Stop', 'SessionEnd'];
  const have = expected.filter((e) => JSON.stringify(hooks[e] ?? '').includes('vfkb'));
  if (have.length === 0) {
    add('.claude/settings.json', 'warn', 'no vfkb hooks — run `vfkb init`');
  } else if (have.length < expected.length) {
    add('.claude/settings.json', 'warn', `only ${have.join(', ')} wired (expected ${expected.join(', ')})`);
  } else {
    add('.claude/settings.json', 'ok', `${have.join(', ')} wired`);
  }

  // 5b. The committed bootstrap entry-point (ADR-0031).
  if (existsSync(join(root, '.vfkb', 'bin', 'bootstrap.mjs'))) {
    add('bootstrap', 'ok', '.vfkb/bin/bootstrap.mjs present');
  } else if (mcp?.mcpServers?.vfkb || have.length > 0) {
    add('bootstrap', 'warn', 'wiring present but .vfkb/bin/bootstrap.mjs is missing — run `vfkb init`');
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
