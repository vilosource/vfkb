// FR-4 (ADR-0030) — `vfkb doctor`: catches the failure modes a consumer trips
// over before they corrupt a brain — an incompatible/stale engine binding, missing
// or inconsistent wiring, and the dual-clone drift signal (a brain last stamped by
// a different engine build). Deterministic; unit-tested (the inner gate per ADR-0023).

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, unlinkSync } from 'node:fs';
import { join, dirname, relative, resolve, isAbsolute } from 'node:path';
import { SCHEMA_VERSION, ENGINE_VERSION, ENGINE_COMMIT } from './version.js';
import { journalStatus } from './journal.js';
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
    // Answer the reader's question, but only as far as the check actually goes.
    //
    // An earlier version said "you are running the newest published version".
    // That is axis (b) — installed-vs-offered — which RFC-024 §1 explicitly
    // GATES and this code never performs. All that is compared here is the
    // marketplace clone against its remote (axis (a)). In the half-upgraded
    // `--scope user` state the RFC documents, the clone is level while the
    // INSTALL lags, and that wording would have told an operator running old
    // code that they were current. It made the L4's contrast arm clean by being
    // more confident, not by being more true.
    //
    // So: state the clone's currency plainly, and name the limit in the same
    // breath. The stale branch says "you are running an old copy" because in
    // that state the clone cannot be ahead of itself; the healthy branch cannot
    // honestly say the converse about the install.
    return {
      status: 'ok',
      detail:
        `${marketplace} marketplace clone is CURRENT — level with its remote (${local.slice(0, 7)}), so ` +
        `\`claude plugin update\` will find nothing newer to install from it. Note: this compares the clone ` +
        `to its remote; it does not compare your INSTALLED version (${plugin.installed?.version ?? 'unknown'}) ` +
        `against what the clone offers.`,
    };
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
  // Injectable for tests. ENGINE_COMMIT is a module constant that resolves to the
  // 'dev' sentinel under the tsc/test build, so without this seam the drift branch
  // below is unreachable from a test and could be deleted with the suite green
  // (observed — review of PR #216). Defaults to the real running identity.
  engineCommit?: string;
}

/**
 * npm currency (ADR-0058 / RFC-030) — the npm-channel sibling of `checkCurrency`
 * above. Opt-in ONLY (the CLI calls this solely under `--check-remote`; plain
 * `runDoctor` never touches it, so plain `doctor` stays fully offline with zero
 * network calls — verified by the "plain doctor" unit tests and by diffing
 * `vfkb doctor`'s output against pre-ADR-0058 `main`).
 *
 * Axis-(b) wording discipline (the meta-lesson behind this whole ADR): the
 * healthy line says exactly what was compared — the RUNNING CLI's version
 * against the npmjs `latest` dist-tag for @viloforge/vfkb — and nothing more.
 * Never "you are up to date". A unit test pins this with a positive regex (the
 * comparison claim) and a negative regex (forbidden overclaim phrases).
 */
const NPM_PACKAGE_NAME = '@viloforge/vfkb';
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@viloforge%2Fvfkb/latest';
const NPM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NPM_CACHE_FILE = 'npm-currency-cache.json';

// Minimal structural shape a fetch response must satisfy — NOT the full DOM
// `Response` interface — so tests can inject a plain object instead of
// constructing a real Response. The real global `fetch`'s return value
// satisfies this structurally (TS is structural, not nominal).
export interface NpmFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}
export type NpmFetch = (url: string, init: { signal: AbortSignal }) => Promise<NpmFetchResponse>;

interface NpmCurrencyCacheEntry {
  version: string;
  fetchedAt: string; // ISO timestamp
}

export interface NpmCurrencyOpts {
  brainDir: string;
  installedVersion: string;
  // Injectable for tests (mirrors the `git` seam above); defaults to the
  // machine's real global `fetch`.
  fetch?: NpmFetch;
  // Injectable cache-file path for tests; defaults to
  // <brainDir>/.signals/npm-currency-cache.json. `.signals/` — NOT the brain
  // dir root: consumers COMMIT the brain dir (entries.jsonl + manifest.json),
  // and only the derived paths — index-meta.json, .sessions/, .signals/,
  // .journal/, .lock — are in init's .gitignore stanza, which
  // existing consumers never re-run. A root-level cache file would land in
  // their history and churn on every refresh. Nothing enumerates .signals/
  // (counters.ts reads only counters.jsonl by name), so a sibling file there
  // is inert.
  cacheFile?: string;
  timeoutMs?: number; // default 4000ms — bounded, "a few seconds"
  now?: () => number; // injectable clock for cache-age tests; defaults to Date.now
}

function npmCacheFilePath(opts: NpmCurrencyOpts): string {
  return opts.cacheFile ?? join(opts.brainDir, '.signals', NPM_CACHE_FILE);
}

// Corrupt or missing cache is treated as absent, silently — never an error
// surfaced to the user (RFC-030 §2 cache design).
function readNpmCache(path: string): NpmCurrencyCacheEntry | undefined {
  const raw = readJson(path);
  if (!raw || typeof raw.version !== 'string' || typeof raw.fetchedAt !== 'string') return undefined;
  if (!Number.isFinite(Date.parse(raw.fetchedAt))) return undefined;
  return { version: raw.version, fetchedAt: raw.fetchedAt };
}

function writeNpmCache(path: string, entry: NpmCurrencyCacheEntry): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entry));
  } catch {
    // Best-effort — a failed cache write must never fail the check itself.
  }
}

// Small, dependency-free semver-ish comparator: numeric major.minor.patch,
// with a release ranking above any pre-release of the same core (so 1.0.0 >
// 1.0.0-beta.1). Sufficient for comparing two npm-published version strings;
// not a full semver implementation.
function parseSemverish(v: string): { core: number[]; pre: string } {
  const [core, ...preParts] = v.replace(/^v/, '').split('-');
  const nums = core.split('.').map((n) => parseInt(n, 10));
  while (nums.length < 3) nums.push(0);
  return { core: nums.map((n) => (Number.isFinite(n) ? n : 0)), pre: preParts.join('-') };
}

function compareVersions(a: string, b: string): number {
  const pa = parseSemverish(a);
  const pb = parseSemverish(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1; // a is a release, b is a pre-release of the same core
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

// The comparison + wording (shared by the cache-hit and live-fetch paths — the
// data source suffix is the only thing that differs between them).
function renderCurrencyVerdict(
  installed: string,
  latest: string,
  sourceSuffix: string,
): { status: DoctorStatus; detail: string } {
  const cmp = compareVersions(installed, latest);
  if (cmp === 0) {
    return {
      status: 'ok',
      detail: `installed ${installed} matches the npmjs latest dist-tag (${latest}) ${sourceSuffix}`,
    };
  }
  if (cmp < 0) {
    return {
      status: 'warn',
      detail:
        `installed ${installed}; npmjs latest dist-tag is ${latest} — a newer version is ` +
        `published. Remedy: npm i -g ${NPM_PACKAGE_NAME}@latest ${sourceSuffix}`,
    };
  }
  // Ahead: installed > latest — the normal state right after cutting a
  // release, before/without npm publish, or on a local dev build. Not a
  // problem, so `ok`, but named plainly rather than folded into the "matches"
  // wording (that would overclaim a comparison result that isn't equality).
  return {
    status: 'ok',
    detail:
      `installed ${installed} is newer than the npmjs latest dist-tag (${latest}) — normal ` +
      `right after a release ${sourceSuffix}`,
  };
}

export async function checkNpmCurrency(opts: NpmCurrencyOpts): Promise<{ status: DoctorStatus; detail: string }> {
  const cachePath = npmCacheFilePath(opts);
  const now = opts.now ?? Date.now;
  const nowMs = now();

  const cached = readNpmCache(cachePath);
  if (cached) {
    const ageMs = nowMs - Date.parse(cached.fetchedAt);
    if (ageMs >= 0 && ageMs < NPM_CACHE_TTL_MS) {
      const ageH = Math.max(0, Math.floor(ageMs / 3600000));
      return renderCurrencyVerdict(opts.installedVersion, cached.version, `(cached ${ageH}h)`);
    }
  }

  const fetchImpl = opts.fetch ?? (fetch as unknown as NpmFetch);
  const timeoutMs = opts.timeoutMs ?? 4000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(NPM_REGISTRY_URL, { signal: controller.signal });
    if (res.status === 404) {
      return { status: 'skip', detail: 'skipped (package not on npmjs)' };
    }
    if (!res.ok) {
      return { status: 'skip', detail: 'skipped (registry unreachable)' };
    }
    const body = await res.json();
    const latest = typeof body?.version === 'string' ? body.version : undefined;
    if (!latest) {
      return { status: 'skip', detail: 'skipped (registry unreachable)' };
    }
    writeNpmCache(cachePath, { version: latest, fetchedAt: new Date(nowMs).toISOString() });
    return renderCurrencyVerdict(opts.installedVersion, latest, '(live)');
  } catch {
    return { status: 'skip', detail: 'skipped (registry unreachable)' };
  } finally {
    clearTimeout(timer);
  }
}

// #186 — what OLD (pre-plugin) vfkb wiring actually is: a hook command that
// invokes the ENGINE's hook dispatcher, either through the committed bootstrap
// (ADR-0031) or by naming a hook subcommand directly.
//
// The predicate used to be `JSON.stringify(hook).includes('vfkb')`, which
// classified ANY hook mentioning the string as old wiring — including the
// ADR-0059 INACTIVE guard (`.claude/vfkb-guard.mjs`) that the plugin's own
// MIGRATION_GUIDE tells every consumer to commit. So a correctly migrated repo
// was told to delete its own INACTIVE detector, and real double wiring was
// buried in a warning consumers had learned to ignore.
const HOOK_SUBCOMMANDS = ['session-start', 'pre-tool-use', 'post-tool-use', 'stop', 'session-end'];
export function isEngineWiring(hookJson: string): boolean {
  // Compare against the LITERAL command text, not its JSON encoding: a tab in the
  // command is the two characters \\t once stringified, and a quoted subcommand is
  // \\". Un-escaping first means the separator rule below is about real whitespace
  // and quoting rather than about JSON spelling. (Review of PR #216, minor 5: the
  // previous `\\?` sat before the whitespace, where JSON never puts a backslash.)
  const text = hookJson.replace(/\\[tnr]/g, ' ').replace(/\\(.)/g, '$1');
  if (/bootstrap\.mjs/.test(text)) return true;
  return new RegExp(`\\bhook["'\\s]+(${HOOK_SUBCOMMANDS.join('|')})\\b`).test(text);
}

// #212 — a sentinel commit means "this build does not know its own identity"
// (version.ts's honest `dev` fallback on the tsc/dist path), NOT "a different
// engine stamped this brain". Comparing a sentinel against a real sha is not a
// drift observation, it is an absence of one.
//
// The old predicate exempted a dev RUNNING engine but not a dev MANIFEST, so a
// brain stamped by a dist-path build (e.g. the documented `node dist/cli.js`
// fallback, which is how ViloGate's manifest got `"dev"`) reported drift forever
// against every real-sha engine.
export function engineDrift(manifestCommit: string | undefined, runningCommit: string): boolean {
  if (!manifestCommit || manifestCommit === 'dev') return false;
  if (!runningCommit || runningCommit === 'dev') return false;
  return manifestCommit !== runningCommit;
}

// #206 — the work tree that actually governs a path, or undefined outside a repo.
function repoToplevel(root: string): string | undefined {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

// Containment on path BOUNDARIES: `/repo` must not be judged to contain
// `/repo-other/...`. Both sides are realpath'd so a symlinked brain dir (or a
// /tmp that resolves to /private/tmp) compares honestly rather than by spelling.
function isUnder(parent: string | undefined, child: string): boolean {
  if (!parent) return false;
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const rel = relative(real(parent), real(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// --- pi face wiring (ADR-0066) -------------------------------------------------
// pi is OPTIONAL: a repo wired only for Claude Code is healthy, so absent pi wiring
// is `skip`, never `warn`. What is NOT healthy is HALF the pi wiring, because that
// failure is silent — the extensions load, injection works, and the agent simply has
// no kb_* tools. Nothing errors. See brain gotcha 0f1441f9bff2.
export const PI_PACKAGE_SOURCE = 'git:github.com/vilosource/vfkb-pi-package';

function piPackageListed(piSettings: any): boolean {
  const pkgs: unknown[] = Array.isArray(piSettings?.packages) ? piSettings.packages : [];
  return pkgs.some((p) =>
    typeof p === 'string'
      ? p.includes('vfkb-pi-package')
      : !!p && typeof p === 'object' && String((p as { source?: unknown }).source ?? '').includes('vfkb-pi-package'),
  );
}

// The ordering contract, and the reason it is a FAIL rather than a warning.
// `pi-mcp-bridge` resolves $VFKB_MCP_CONFIG at MODULE TOP LEVEL (`const DEFS = await
// discover()`), so anything that sets the var must run BEFORE the bridge is imported.
// pi loads extensions sequentially in array order (verified on 0.73.1), so a settings
// `extensions` array listing the bridge before the wrapper yields zero tools, silently.
// Only relevant when a consumer hand-lists local extension paths; the package's own
// manifest gets this right and is the supported path.
export function piExtensionOrderProblem(piSettings: any): string | undefined {
  const exts: unknown[] = Array.isArray(piSettings?.extensions) ? piSettings.extensions : [];
  const paths = exts.filter((e): e is string => typeof e === 'string');
  // Match BOTH names the bridge ships under, or this check is decorative: the source
  // tree builds `pi-mcp-bridge.js` while the package vendors `vfkb-pi-bridge.mjs`.
  // Matching only the former meant the check never fired on the real package AND
  // false-FAILed a correct hand-wiring against a source-tree bridge.
  const bridgeAt = paths.findIndex((p) => /pi-mcp-bridge|vfkb-pi-bridge/.test(p));
  if (bridgeAt < 0) return undefined; // no hand-listed bridge → manifest order governs
  // Likewise the resolver: `00-vfkb-config.js` is what the package actually ships.
  const wrapperAt = paths.findIndex((p) => /vfkb-config|vfkb-pi-wrapper|vfkb-wrapper/.test(p));
  if (wrapperAt < 0) {
    return 'pi-mcp-bridge is listed in .pi/settings.json `extensions` with no wrapper before it — the bridge reads $VFKB_MCP_CONFIG at import, so it will register ZERO kb_* tools (silently)';
  }
  if (wrapperAt > bridgeAt) {
    return `the vfkb pi wrapper is listed AFTER pi-mcp-bridge (index ${wrapperAt} vs ${bridgeAt}) — pi loads extensions in array order and the bridge resolves its config at import, so it will register ZERO kb_* tools (silently)`;
  }
  return undefined;
}

export interface PiWiringCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export function checkPiWiring(
  piSettings: any,
  piMcp: any,
  piSettingsExists: boolean,
  piMcpExists: boolean,
  // On a PLUGIN-wired repo (ADR-0045) no check may prescribe `vfkb init` — that advice
  // is what scaffolds double wiring, issue #77, asserted in doctor.test.ts. The pi files
  // can be added on their own, so name them instead of naming the command.
  pluginWired = false,
): PiWiringCheck[] {
  const out: PiWiringCheck[] = [];
  const listed = piPackageListed(piSettings);
  const hasMcp = !!piMcp?.mcpServers?.vfkb;
  const orderProblem = piExtensionOrderProblem(piSettings);
  // "Hand-wired" must mean hand-wired *to vfkb*, not merely "has extensions". Keying on
  // a non-empty array made doctor report healthy vfkb pi wiring for someone whose
  // .pi/settings.json lists their own linter — and then warn them about an MCP config
  // for a capability they never asked for.
  const exts: unknown[] = Array.isArray(piSettings?.extensions) ? piSettings.extensions : [];
  const handWired = exts.some((e) => typeof e === 'string' && /vfkb/i.test(e));
  const fix = pluginWired
    ? 'add `.pi/settings.json` (packages: ["' + PI_PACKAGE_SOURCE + '"]) and `.vfkb/mcp.json`'
    : 'run `vfkb init`';

  // `skip` keys on INTENT, not on file existence. A pi user who has never asked for vfkb
  // still has a .pi/settings.json, and warning them to run `vfkb init` is nagging about a
  // capability they did not request. Only speak up once something here references vfkb.
  if (!listed && !handWired && !piMcpExists && !orderProblem) {
    out.push({
      name: 'pi wiring',
      status: 'skip',
      detail: piSettingsExists
        ? '.pi/settings.json has no vfkb wiring — pi face not wired (optional)'
        : 'no .pi/settings.json — pi face not wired (optional)',
    });
    return out;
  }

  if (listed) {
    out.push({ name: 'pi wiring', status: 'ok', detail: `.pi/settings.json loads ${PI_PACKAGE_SOURCE}` });
  } else if (handWired) {
    out.push({ name: 'pi wiring', status: 'ok', detail: '.pi/settings.json hand-lists local extensions (package not used)' });
  } else {
    out.push({ name: 'pi wiring', status: 'warn', detail: `.pi/settings.json exists but does not load the vfkb pi package — ${fix}` });
  }

  // `.vfkb/mcp.json` is an OPTIONAL override. The package's wrapper resolves its own
  // vendored MCP server, so an absent file is the normal, healthy case. What must not
  // pass quietly is a file that EXISTS but does not configure anything — the consumer
  // believes they have overridden the wiring and instead get zero kb_* tools, silently.
  if (piMcpExists && !hasMcp) {
    out.push({
      name: 'pi mcp override',
      status: 'fail',
      detail: '.vfkb/mcp.json exists but has no mcpServers.vfkb — the bridge reads that exact shape, so it will register ZERO kb_* tools and NOTHING will report it; fix the file or delete it to fall back to the package\'s own server',
    });
  } else if (hasMcp) {
    out.push({ name: 'pi mcp override', status: 'ok', detail: '.vfkb/mcp.json overrides the package\'s bundled MCP server' });
  } else if (listed) {
    out.push({ name: 'pi mcp config', status: 'ok', detail: `kb_* tools come from ${PI_PACKAGE_SOURCE}'s bundled MCP server (no .vfkb/mcp.json needed)` });
  } else if (handWired) {
    out.push({
      name: 'pi mcp config',
      status: 'warn',
      detail: 'pi extensions are hand-listed with no .vfkb/mcp.json and no vfkb package — unless $VFKB_MCP_CONFIG is exported, the bridge will register ZERO kb_* tools',
    });
  }

  if (orderProblem) out.push({ name: 'pi extension order', status: 'fail', detail: orderProblem });

  return out;
}

export function runDoctor(opts: DoctorOpts): DoctorReport {
  const { root, brainDir, env } = opts;
  // The identity we compare the brain's stamp against (injectable — see DoctorOpts).
  const runningCommit = opts.engineCommit ?? ENGINE_COMMIT;
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: DoctorStatus, detail: string) => checks.push({ name, status, detail });

  // 1. Engine identity (info).
  add('engine', 'ok', `version ${ENGINE_VERSION} · commit ${runningCommit} · schema v${SCHEMA_VERSION}`);

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
      // #188 — the ordinary write path (addEntry → appendRecord → backend.append)
      // never touches manifest.json. `writeManifest` has exactly two callers:
      // `vfkb init` (init.ts) and the broadcast heal, which fires only when the
      // manifest is ABSENT (broadcast.ts). Saying "on the next write" claimed
      // behaviour the code does not have.
      // On a PLUGIN-wired repo the message must not prescribe `vfkb init` — that
      // advice is what scaffolds double wiring (issue #77), and the invariant is
      // asserted in doctor.test.ts. A plugin-born brain simply has no manifest
      // until a cross-repo broadcast heals it (vfkb#193).
      plugin
        ? `no manifest.json in ${brainDir} — plugin-born brains have none until a cross-repo broadcast heals it (vfkb#193); the ordinary write path never creates one`
        : `no manifest.json in ${brainDir} — run \`vfkb init\` to stamp it (the ordinary write path never creates one)`,
    );
  } else if (typeof mf.schema_version !== 'number') {
    add('brain manifest', 'warn', 'manifest has no numeric schema_version');
  } else if (mf.schema_version > SCHEMA_VERSION) {
    add('brain↔engine compat', 'fail', `brain schema v${mf.schema_version} is NEWER than engine v${SCHEMA_VERSION} — update the engine before using this brain`);
  } else if (mf.schema_version < SCHEMA_VERSION) {
    add('brain↔engine compat', 'warn', `brain schema v${mf.schema_version} is older than engine v${SCHEMA_VERSION} — migration may be needed`);
  } else {
    // #212 — a sentinel stamp is suppressed as DRIFT (it is not drift), but it must
    // not become invisible: the brain's provenance genuinely is unrecorded, and the
    // stamping half of #212 (a build that does not know its commit should not write
    // one) is still open. Reported in the detail rather than as a new warn — it is a
    // true statement, but not one the consumer can act on, and this PR exists to stop
    // doctor crying wolf.
    const sentinel =
      mf.engine_commit === 'dev'
        ? ` · stamped by a build that did not know its own commit ("dev") — provenance unknown (#212)`
        : '';
    add('brain↔engine compat', 'ok', `schema v${mf.schema_version} matches${sentinel}`);
    // Drift signal: same schema but a different engine build last stamped the brain.
    if (engineDrift(mf.engine_commit, runningCommit)) {
      add('engine drift', 'warn', `brain last stamped by engine ${mf.engine_commit}, running ${runningCommit} — possible dual-clone drift`);
    }
  }

  // 2a-bis. Write-health (ADR-0065 §2): can the engine actually write here?
  //
  // Round-trips a NON-entries file. `entries.jsonl` is append-only — there is no
  // "append then remove" (the only delete is a tombstone, two permanent lines
  // per doctor run), and a probe namespace inside it would dirty the working
  // tree and grow the committed log on every invocation.
  //
  // SCOPE, and it is the whole difficulty. §0 observed that the failure which
  // actually loses writes is a HUNG MCP server: the process is alive and mute,
  // the call never returns, nothing errors (scenarios/probes/mcp-disconnect.md).
  // Doctor is the CLI face and cannot see that at all. So a true "write-health
  // ok" here is exactly the kind of statement a reader over-reads into "my
  // capture is fine" — the 6ad98196b5a2 failure, where a diagnostic was made
  // more CONFIDENT rather than more TRUE and an L4 went green because the claim
  // became more quotable. The scope caveat below is therefore part of the
  // behaviour, not decoration, and is pinned by test/doctor-write-health.test.ts.
  {
    // UNIQUE per run: with a fixed path, two doctors racing read each other's
    // bytes and report "read back different bytes" — a false alarm of silent
    // disk corruption, and report.ok=false exits 1 (reproduced: 4 processes x
    // 200 runs, review of #228).
    const probe = join(brainDir, `.write-probe-${process.pid}-${randomBytes(4).toString('hex')}`);
    const payload = `vfkb write-probe ${process.pid} ${Date.now()}`;
    let failure: string | undefined;
    try {
      mkdirSync(brainDir, { recursive: true });
      writeFileSync(probe, payload);
      // Read BACK: a write that silently no-ops (a full disk, an overlay that
      // swallows writes) must not read as healthy.
      if (readFileSync(probe, 'utf8') !== payload) failure = 'wrote the probe file but read back different bytes';
    } catch (e) {
      failure = (e as Error).message;
    } finally {
      try {
        if (existsSync(probe)) unlinkSync(probe);
      } catch {
        /* leaving the probe behind is not itself a write-health failure */
      }
    }
    // §0 consequence #3 says a §2 design needs its own timeout or it inherits
    // the hang. These are synchronous fs calls: on a wedged NFS/FUSE mount they
    // block indefinitely and so does doctor. Named, not silently dropped — the
    // bounded-round-trip requirement targets an MCP-probing design, which this
    // deliberately is not.
    const SCOPE =
      ' — scope: this is the CLI/engine/filesystem path only; it does NOT check the MCP server, ' +
      'so it cannot tell you whether kb_* capture is reaching the brain (ADR-0065 §0: a hung MCP ' +
      'server loses a write with no error at all)';
    if (failure) {
      add('write-health (filesystem)', 'fail', `cannot write to ${brainDir}: ${failure}${SCOPE}`);
    } else {
      add('write-health (filesystem)', 'ok', `round-trip verified in ${brainDir}${SCOPE}`);
    }
  }

  // 2b. Durable-capture journal (ADR-0064): what would recovery do, and is a
  // redaction half-done? Read-only — recovery itself runs at session start.
  {
    const js = journalStatus(brainDir);
    if (js.suppressedInEntries > 0) {
      add(
        'journal',
        'warn',
        `${js.suppressedInEntries} suppressed (purged) pair(s) still present in entries.jsonl — a redaction is half-done: remove the line(s) from entries.jsonl too (ADR-0064 §4)`,
      );
    } else if (js.restorable > 0) {
      add(
        'journal',
        'warn',
        `${js.restorable} journaled entr${js.restorable === 1 ? 'y' : 'ies'} missing from entries.jsonl — the next session-start restores them (or run \`vfkb hook session-start\` after checking why they vanished; recovery runs ONLY there)`,
      );
    } else {
      add('journal', 'ok', `${js.walLines} line(s) in the uncommitted window, nothing to restore`);
    }
    // Migration gap (review M3): an existing consumer that never re-ran init
    // has no .journal/ gitignore line — its next `git add .vfkb` would COMMIT
    // the wal (a tracked journal dies by the same reset --hard, RFC-034
    // Alternatives; and a committed wal defeats §4 redaction).
    // #206 — judge only a journal the repo actually governs. With the brain on
    // the default ~/.vfkb tier (VFKB_DATA_DIR outside the work tree),
    // `check-ignore` exits 128 ("path outside work tree"), which the catch-all
    // below read as plain "not ignored" — so doctor advised editing a .gitignore
    // that does not govern that path at all.
    if (existsSync(join(brainDir, '.journal')) && isUnder(repoToplevel(root), join(brainDir, '.journal'))) {
      try {
        execFileSync('git', ['-C', root, 'check-ignore', '-q', join(brainDir, '.journal', 'wal.jsonl')], {
          stdio: 'ignore',
        });
      } catch {
        try {
          execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
          add(
            'journal gitignore',
            'warn',
            `.vfkb/.journal/ exists but is NOT gitignored — add '.vfkb/.journal/' to .gitignore before the next brain commit (a committed journal defeats its purpose and the ADR-0064 §4 redaction)`,
          );
        } catch {
          /* not a git repo — nothing to ignore */
        }
      }
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
  const have = expected.filter((e) => isEngineWiring(JSON.stringify(hooks[e] ?? '')));
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

  // 6b. An EMBEDDED git repo inside the brain (gotcha 80683290b4a8). git.ts no longer
  // creates one, but a brain corrupted by an older build never heals itself — and the
  // damage is invisible: `git add .vfkb/entries.jsonl` exits 0 and tracks nothing, so
  // the brain silently stops reaching version control. Nothing else in doctor looks for
  // it, and the repo's own `.gitignore`/journal checks report OK right through it.
  {
    const embedded = join(brainDir, '.git');
    const inRepo = isUnder(repoToplevel(root), brainDir);
    if (inRepo && existsSync(embedded)) {
      add(
        'brain gitlink',
        'fail',
        `${embedded} exists — this brain is an EMBEDDED git repo inside the project, so \`git add ${relative(root, brainDir)}/entries.jsonl\` silently tracks NOTHING and the brain is not in version control. Fix: remove ${embedded} (the brain's own history is separate from the project's), then re-add the file`,
      );
    }
  }

  // 7. pi face wiring (ADR-0066) — optional, but half-wired is a silent tool outage.
  {
    const piSettingsPath = join(root, '.pi', 'settings.json');
    const piSettings = readJson(piSettingsPath);
    const piMcpPath = join(brainDir, 'mcp.json');
    const piMcp = readJson(piMcpPath);
    for (const c of checkPiWiring(piSettings, piMcp, existsSync(piSettingsPath), existsSync(piMcpPath), !!plugin)) {
      add(c.name, c.status, c.detail);
    }
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
