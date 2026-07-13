#!/usr/bin/env node
// ============================================================================
// vfkb-guard.mjs — the "vfkb INACTIVE" detector (ADR-0059, restores the signal
// ADR-0045 removed).
// ----------------------------------------------------------------------------
// Committed to a plugin-wired consumer repo at .claude/vfkb-guard.mjs and wired
// as a SessionStart hook in the SAME .claude/settings.json that declares the
// vfkb plugin. It CANNOT live in the plugin's own hooks.json: when the plugin
// is absent those hooks do not load either — which is the exact failure this
// guards. Node stdlib ONLY, for the same reason (no dependency on the engine
// whose absence it detects).
//
// It compares the project's `enabledPlugins` DECLARATION against Claude Code's
// `~/.claude/plugins/installed_plugins.json` FULFILLMENT. Declared-but-not-
// fulfilled = a session silently running without vfkb (no resume digest, no
// brain-write gate, no capture) — so it prints an actionable banner into the
// session-start context.
//
// FAIL-OPEN: every path is wrapped so that ANY read/parse error exits 0
// silently. A guard is a smoke alarm, never a lock — it must never block a
// session, and a format drift in Claude Code's internal state must degrade to
// "the banner goes quiet," never "sessions break."
//
// KNOWN LIMITATION (ADR-0059): the installed-but-UNAPPROVED state may be
// invisible here (approval state lives outside installed_plugins.json). This
// decisively covers uninstalled / never-fulfilled / wrong-project.
// ============================================================================
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const PLUGIN = 'vfkb@vfkb';

// Same on-disk location, tolerating symlinks: a project-scope install records
// projectPath at install time, which may be a realpath while CLAUDE_PROJECT_DIR
// is a symlinked path (or vice-versa). Without this a genuinely-installed
// project would falsely banner. realpathSync only resolves paths that exist;
// fall back to the lexical compare (already done) when it throws.
function samePath(a, b) {
  const ra = resolve(a);
  const rb = resolve(b);
  if (ra === rb) return true;
  try {
    return realpathSync(ra) === realpathSync(rb);
  } catch {
    return false;
  }
}

try {
  const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || '.');

  // 1. Does THIS project declare the plugin? If not, the guard is irrelevant —
  //    exit silently (a repo that never wanted vfkb must see nothing).
  let declared = false;
  try {
    const s = JSON.parse(readFileSync(join(projectDir, '.claude', 'settings.json'), 'utf8'));
    declared = Boolean(s && s.enabledPlugins && s.enabledPlugins[PLUGIN]);
  } catch { declared = false; }
  if (!declared) process.exit(0);

  // 2. Is the plugin actually fulfilled for this project? A user-scope install
  //    covers every project; a project-scope install must name THIS projectPath.
  let fulfilled = false;
  try {
    const home = process.env.HOME || homedir();
    const installed = JSON.parse(
      readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'),
    );
    const entries = installed && installed.plugins && installed.plugins[PLUGIN];
    if (Array.isArray(entries)) {
      fulfilled = entries.some(
        (e) =>
          e &&
          (e.scope === 'user' ||
            (e.scope === 'project' && e.projectPath && samePath(e.projectPath, projectDir))),
      );
    }
  } catch { fulfilled = false; }

  // 3. Declared but not fulfilled → the silent-degradation state. Banner it.
  //    SessionStart hook stdout is injected into the session's context.
  if (!fulfilled) {
    process.stdout.write(
      'vfkb INACTIVE — this project declares the vfkb plugin (vfkb@vfkb) but it is ' +
        'not installed for this session. No resume digest, no brain-write gate, and no ' +
        'decision capture are running; knowledge recorded now may be lost. Fix: run ' +
        '`claude plugin install vfkb@vfkb` (or, in an interactive session, approve the ' +
        "plugin's MCP server + hooks when prompted), then restart the session. " +
        '(vfkb-guard / ADR-0059 — this line is from the repo-side guard, not the plugin.)\n',
    );
  }
  process.exit(0);
} catch {
  process.exit(0); // fail open, unconditionally
}
