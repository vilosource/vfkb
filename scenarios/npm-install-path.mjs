#!/usr/bin/env node
// ============================================================================
// vfkb NPM INSTALL-PATH proof (ADR-0057 step 2 / RFC-029)
// ----------------------------------------------------------------------------
// Proves the npm delivery channel's install path end-to-end, in a clean
// container, BEFORE anything is ever published to a registry — the pack-based
// proof ADR-0057 requires to gate release PRs pre-publish.
//
// This is an e2e CONTAINER proof, not an LLM L4 (ADR-0029 "proof fits the
// capability" — no agent judgment is involved in installing a package). It
// needs no registry: `npm pack` builds the real publishable tarball from this
// checkout, a clean `node:20` container installs it globally with no repo
// mount and no network dependency on npm's registry, and every assertion is a
// CONTENT assertion on captured output (ADR-0051 — exit codes and "looks
// successful" are not evidence; a broken bin wiring can report `npm i -g`
// as a clean success while leaving `vfkb` uninstallable — observed live while
// building this scenario, see the contrast arm below).
//
// FRESH ARM (default): pack -> clean node:20 -> `npm i -g` the tarball -> assert:
//   - `vfkb --version` / `-v` / `version` each equal package.json's version
//   - `vfkb add` + `vfkb list` round-trip a sentinel fact (VFKB_DATA_DIR only,
//     no `vfkb init` / git needed for this content-only assertion)
//   - `vfkb-mcp` completes an MCP `initialize` handshake over stdio: the
//     response contains `"result"` and `serverInfo.name === "vfkb"`
//
// CONTRAST ARM (--contrast, must-fail): same flow, but the tarball is repacked
// with dist/ stripped (unpack -> rm -rf dist -> repack). `npm i -g` reports
// "added N packages" — a QUIET SUCCESS — but does not wire up the `vfkb` /
// `vfkb-mcp` commands at all. The arm is GREEN only when every content
// assertion correctly fails (i.e. the break was detected, not silently
// tolerated). A proof that can't fail proves nothing (ADR-0029 #3).
//
// RED FIRST (today, before `vfkb --version` exists): the fresh arm's version
// checks fail because `--version`/`-v`/`version` fall through to the unknown-
// command branch (prints USAGE, does not equal package.json's version).
//
//   node scenarios/npm-install-path.mjs             # fresh arm
//   node scenarios/npm-install-path.mjs --contrast   # must-fail arm
//   node scenarios/npm-install-path.mjs --keep       # keep the temp workdir (debug)
//
// Needs: docker (uses `node:20`, pulled from Docker Hub — no repo mount, no
// vfkb registry). Does NOT run `npm install` in this repo (node_modules must
// already be present here; `npm pack`'s prepublishOnly builds dist/ + the
// bundles from it).
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';

const REPO = resolve(process.argv[1], '../..');
const CONTRAST = process.argv.includes('--contrast');
const KEEP = process.argv.includes('--keep');
const PKG = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const PKG_VERSION = PKG.version;
const SENTINEL = 'install-proof sentinel IP-7Q4';
const MCP_INIT_REQUEST = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'vfkb-install-proof', version: '1.0.0' },
  },
});

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...opts });
}

// npm pack in THIS checkout (node_modules already present — no `npm install`
// here). --pack-destination keeps the tarball out of the repo tree entirely
// (never modifies the repo). prepublishOnly runs `build` + `build:bundles`.
function buildTarball(workDir) {
  const out = sh('npm', ['pack', '--pack-destination', workDir], { cwd: REPO }).trim();
  const name = out.split('\n').filter(Boolean).pop().trim();
  return join(workDir, name);
}

// The must-fail arm: unpack the real tarball, strip dist/ (the bin targets),
// repack with the same package/ layout npm pack produces. `npm i -g` on this
// still reports success (npm does not validate that `bin` targets exist) —
// the break only shows up as a content failure downstream, which is exactly
// the quiet-success mode ADR-0051 names.
function buildBrokenTarball(goodTgz, workDir) {
  const unpackDir = join(workDir, 'unpack');
  mkdirSync(unpackDir, { recursive: true });
  sh('tar', ['xzf', goodTgz, '-C', unpackDir]);
  rmSync(join(unpackDir, 'package', 'dist'), { recursive: true, force: true });
  const brokenPath = join(workDir, 'broken.tgz');
  sh('tar', ['czf', brokenPath, '-C', unpackDir, 'package']);
  return brokenPath;
}

// The in-container script. `exec 2>&1` up front so stderr (npm notices, the
// MCP server's stderr startup line, node's MODULE_NOT_FOUND on a broken
// install) lands in the same captured stream as stdout — every check below
// is a content search over that combined stream, never an exit code.
function runScript() {
  return `#!/bin/bash
exec 2>&1
set +e
sep() { echo "===VFKB-CHECK-START:$1==="; }
end() { echo "===VFKB-CHECK-END:$1==="; }

sep install
npm i -g /pkg.tgz
end install

sep version-long
vfkb --version
end version-long

sep version-short
vfkb -v
end version-short

sep version-verb
vfkb version
end version-verb

mkdir -p /w
sep roundtrip
VFKB_DATA_DIR=/w/.vfkb vfkb add fact "${SENTINEL}" --role human
VFKB_DATA_DIR=/w/.vfkb vfkb list
end roundtrip

sep mcp
printf '%s\\n' '${MCP_INIT_REQUEST}' | timeout 5 vfkb-mcp
end mcp
`;
}

function runContainer(tgzPath, workDir) {
  const scriptPath = join(workDir, 'run.sh');
  writeFileSync(scriptPath, runScript());
  const args = [
    'run',
    '--rm',
    '-v',
    `${tgzPath}:/pkg.tgz:ro`,
    '-v',
    `${scriptPath}:/run.sh:ro`,
    'node:20',
    'bash',
    '/run.sh',
  ];
  try {
    return sh('docker', args);
  } catch (e) {
    // docker itself (not the in-container script — that always exits 0, see
    // `set +e` above) failed to run at all; surface whatever it captured.
    return `${e.stdout || ''}\n${e.stderr || ''}\n[docker run error: ${e.message}]`;
  }
}

function parseSections(output) {
  const sections = {};
  let current = null;
  let buf = [];
  for (const line of output.split('\n')) {
    const start = line.match(/^===VFKB-CHECK-START:(.+)===$/);
    const stop = line.match(/^===VFKB-CHECK-END:(.+)===$/);
    if (start) {
      current = start[1];
      buf = [];
      continue;
    }
    if (stop) {
      if (current) sections[current] = buf.join('\n');
      current = null;
      continue;
    }
    if (current) buf.push(line);
  }
  return sections;
}

function evaluate(sections) {
  const checks = [];
  const push = (name, ok, observed) => checks.push({ name, ok, observed: observed.trim().slice(0, 400) });

  const versionLong = (sections['version-long'] || '').trim();
  push(`vfkb --version equals package.json version (${PKG_VERSION})`, versionLong === PKG_VERSION, versionLong);

  const versionShort = (sections['version-short'] || '').trim();
  push(`vfkb -v equals package.json version (${PKG_VERSION})`, versionShort === PKG_VERSION, versionShort);

  const versionVerb = (sections['version-verb'] || '').trim();
  push(`vfkb version equals package.json version (${PKG_VERSION})`, versionVerb === PKG_VERSION, versionVerb);

  const roundtrip = sections['roundtrip'] || '';
  push('vfkb add + vfkb list round-trips the sentinel fact', roundtrip.includes(SENTINEL), roundtrip);

  const mcp = sections['mcp'] || '';
  const mcpOk = mcp.includes('"result"') && /"name"\s*:\s*"vfkb"/.test(mcp);
  push('vfkb-mcp completes an MCP initialize handshake (result + serverInfo.name)', mcpOk, mcp);

  return checks;
}

function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'vfkb-install-proof-'));
  let exitCode = 2;
  try {
    const goodTgz = buildTarball(workDir);
    const tgz = CONTRAST ? buildBrokenTarball(goodTgz, workDir) : goodTgz;
    const arm = CONTRAST ? 'contrast' : 'fresh';
    console.log(`vfkb npm-install-path proof — arm=${arm}  tarball=${basename(tgz)}  expected-version=${PKG_VERSION}`);
    console.log(`container: node:20 (no repo mount, no registry)\n`);

    const raw = runContainer(tgz, workDir);
    const sections = parseSections(raw);
    const checks = evaluate(sections);

    for (const c of checks) {
      console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}`);
      if (!c.ok) console.log(`         observed: ${JSON.stringify(c.observed)}`);
    }

    const allPass = checks.every((c) => c.ok);
    const allFail = checks.every((c) => !c.ok);
    let verdict, verdictLine;
    if (!CONTRAST) {
      verdict = allPass ? 'GREEN' : 'RED';
      verdictLine =
        verdict === 'GREEN'
          ? `NPM-INSTALL-PATH: GREEN (fresh)`
          : `NPM-INSTALL-PATH: RED (fresh) / RED-EXPECTED: --version not implemented yet (or a check regressed)`;
    } else {
      // must-fail arm: GREEN means the broken pack was correctly detected —
      // every content assertion failed as it should.
      verdict = allFail ? 'GREEN' : 'RED';
      verdictLine =
        verdict === 'GREEN'
          ? `NPM-INSTALL-PATH: GREEN (contrast) — broken pack correctly detected as broken`
          : `NPM-INSTALL-PATH: RED (contrast) — broken pack NOT detected: some checks unexpectedly passed`;
    }
    console.log('\n' + verdictLine);

    const record = {
      arm,
      expectedVersion: PKG_VERSION,
      checks,
      verdict,
      verdictLine,
      ts: new Date().toISOString(),
    };
    console.log('\n' + JSON.stringify(record));

    exitCode = verdict === 'GREEN' ? 0 : 1;
  } catch (err) {
    console.error('scenario error:', err && err.stack ? err.stack : err);
    exitCode = 2;
  } finally {
    if (!KEEP) rmSync(workDir, { recursive: true, force: true });
    else console.log(`\n[--keep] workdir preserved: ${workDir}`);
  }
  process.exit(exitCode);
}

main();
