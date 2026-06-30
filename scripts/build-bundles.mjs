// FR-2 (ADR-0030) — build the portable, single-file engine bundles.
//
// Emits two self-contained ESM bundles that a CONSUMER repo runs via the
// `$VFKB_HOME` indirection (no relative `dist/` path, no `node_modules` on the
// consumer side):
//   dist/bundles/vfkb.mjs      — the CLI + Claude-Code hooks (from src/cli.ts)
//   dist/bundles/vfkb-mcp.mjs  — the MCP server (from src/mcp-server.ts), with
//                                @modelcontextprotocol/sdk + zod inlined.
//
// The engine itself stays zero-dep (ADR-0013); the SDK/zod are bundled IN so the
// MCP face is "truly drops into any node container, zero runtime deps" (RFC-010
// FR-2; spike fact 8c547ae0). Node built-ins stay external automatically.
//
// Usage: node scripts/build-bundles.mjs [outdir]   (default: dist/bundles)

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Engine identity stamped into the bundles (FR-4 / src/version.ts). Best-effort:
// version from package.json, commit from git (falls back if not a checkout).
function engineIdentity() {
  let version = '0.0.0';
  try {
    version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version ?? version;
  } catch {}
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {}
  return { version, commit };
}

export async function buildBundles(outdir = join(repoRoot, 'dist', 'bundles')) {
  mkdirSync(outdir, { recursive: true });
  const id = engineIdentity();
  // No shebang banner: both entry files (src/cli.ts, src/mcp-server.ts) already
  // start with `#!/usr/bin/env node`, which esbuild preserves at line 1. Adding a
  // banner would emit a second shebang on line 2 (a syntax error).
  const common = {
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
    absWorkingDir: repoRoot,
    define: {
      __VFKB_VERSION__: JSON.stringify(id.version),
      __VFKB_COMMIT__: JSON.stringify(id.commit),
    },
  };
  const cli = join(outdir, 'vfkb.mjs');
  const mcp = join(outdir, 'vfkb-mcp.mjs');
  await build({ ...common, entryPoints: [join(repoRoot, 'src/cli.ts')], outfile: cli });
  await build({ ...common, entryPoints: [join(repoRoot, 'src/mcp-server.ts')], outfile: mcp });
  return { cli, mcp };
}

// Run as a script (not when imported by the test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outdir = process.argv[2] ? resolve(process.argv[2]) : undefined;
  buildBundles(outdir)
    .then((o) => console.log(`built bundles:\n  ${o.cli}\n  ${o.mcp}`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
