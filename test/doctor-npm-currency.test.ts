// ADR-0058 / RFC-030 — `vfkb doctor --check-remote`'s npm currency line: the
// npm-channel sibling of the plugin-currency check (RFC-024 §1). Deterministic
// unit tests with an injected fetcher — no network, per ADR-0023's inner gate.
//
// The axis-(b) wording assertion below is the load-bearing test in this file:
// it is the unit-level regression guard named by ADR-0058 for the meta-lesson
// (operator-verified gotcha, 2026-07-10) that a diagnostic's healthy-branch
// wording once overclaimed what the code actually compared.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkNpmCurrency, type NpmFetch, type NpmFetchResponse } from '../src/doctor.js';

let root: string;
let brainDir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vfkb-npm-currency-'));
  brainDir = join(root, '.vfkb');
  mkdirSync(brainDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function jsonResponse(body: any, status = 200): NpmFetchResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('ADR-0058 — npm currency: current / behind / ahead', () => {
  it('current: installed matches npmjs latest — ok, names both compared things', async () => {
    let calls = 0;
    const fetch: NpmFetch = async () => {
      calls++;
      return jsonResponse({ version: '0.1.0' });
    };
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.1.0', fetch });
    expect(calls).toBe(1);
    expect(r.status).toBe('ok');
    expect(r.detail).toContain('installed 0.1.0');
    expect(r.detail).toContain('npmjs latest dist-tag (0.1.0)');
    expect(r.detail).toMatch(/\(live\)$/);
  });

  it('behind: installed < npmjs latest — warn (non-fatal), names the remedy', async () => {
    const fetch: NpmFetch = async () => jsonResponse({ version: '0.3.0' });
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.1.0', fetch });
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('installed 0.1.0');
    expect(r.detail).toContain('npmjs latest dist-tag is 0.3.0');
    expect(r.detail).toContain('Remedy: npm i -g @vilosource/vfkb@latest');
    expect(r.detail).toMatch(/\(live\)$/);
  });

  it('ahead: installed > npmjs latest — states it plainly, not a WARN', async () => {
    const fetch: NpmFetch = async () => jsonResponse({ version: '0.1.0' });
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.2.0', fetch });
    expect(r.status).toBe('ok');
    expect(r.detail).toContain('installed 0.2.0');
    expect(r.detail).toMatch(/newer than the npmjs latest dist-tag \(0\.1\.0\)/);
    expect(r.detail).toMatch(/normal right after a release/);
  });
});

describe('ADR-0058 — offline-silent paths (never WARN, never nonzero-implying)', () => {
  it('registry unreachable (network error) → skipped note, never warn/fail', async () => {
    const fetch: NpmFetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
    };
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.1.0', fetch });
    expect(r.status).toBe('skip');
    expect(r.detail).toBe('npm currency: skipped (registry unreachable)');
  });

  it('registry times out (abort) → skipped note', async () => {
    const fetch: NpmFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.1.0', fetch, timeoutMs: 20 });
    expect(r.status).toBe('skip');
    expect(r.detail).toBe('npm currency: skipped (registry unreachable)');
  });

  it('package not on npmjs (404) → its own skipped note, distinct from unreachable', async () => {
    const fetch: NpmFetch = async () => jsonResponse({}, 404);
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.1.0', fetch });
    expect(r.status).toBe('skip');
    expect(r.detail).toBe('npm currency: skipped (package not on npmjs)');
  });

  it('malformed registry body (no version field) → skipped, not a crash', async () => {
    const fetch: NpmFetch = async () => jsonResponse({ nonsense: true });
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.1.0', fetch });
    expect(r.status).toBe('skip');
    expect(r.detail).toBe('npm currency: skipped (registry unreachable)');
  });
});

describe('ADR-0058 — 24h cache', () => {
  it('cache hit within 24h → no fetch call observed, discloses cache age', async () => {
    const cacheFile = join(brainDir, 'npm-currency-cache.json');
    const fetchedAt = new Date(Date.now() - 3 * 3600_000).toISOString(); // 3h old
    writeFileSync(cacheFile, JSON.stringify({ version: '0.2.0', fetchedAt }));
    let calls = 0;
    const fetch: NpmFetch = async () => {
      calls++;
      return jsonResponse({ version: '9.9.9' }); // would prove a call happened if hit
    };
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.2.0', fetch, cacheFile });
    expect(calls).toBe(0); // the injected fetcher must NOT have been called
    expect(r.status).toBe('ok');
    expect(r.detail).toContain('0.2.0'); // compared against the CACHED version, not 9.9.9
    expect(r.detail).toMatch(/\(cached 3h\)$/);
  });

  it('expired cache (>=24h old) → falls through to a live fetch', async () => {
    const cacheFile = join(brainDir, 'npm-currency-cache.json');
    const fetchedAt = new Date(Date.now() - 25 * 3600_000).toISOString(); // 25h old
    writeFileSync(cacheFile, JSON.stringify({ version: '0.2.0', fetchedAt }));
    let calls = 0;
    const fetch: NpmFetch = async () => {
      calls++;
      return jsonResponse({ version: '0.4.0' });
    };
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.1.0', fetch, cacheFile });
    expect(calls).toBe(1);
    expect(r.detail).toContain('0.4.0'); // compared against the freshly-fetched version
    expect(r.detail).toMatch(/\(live\)$/);
  });

  it('a successful live fetch writes the cache for next time', async () => {
    const cacheFile = join(brainDir, 'npm-currency-cache.json');
    const fetch: NpmFetch = async () => jsonResponse({ version: '0.5.0' });
    await checkNpmCurrency({ brainDir, installedVersion: '0.5.0', fetch, cacheFile });
    expect(existsSync(cacheFile)).toBe(true);
    const written = JSON.parse(readFileSync(cacheFile, 'utf8'));
    expect(written.version).toBe('0.5.0');
    expect(typeof written.fetchedAt).toBe('string');
  });

  it('corrupt cache file → treated as absent, falls through to a live fetch silently', async () => {
    const cacheFile = join(brainDir, 'npm-currency-cache.json');
    writeFileSync(cacheFile, '{ not valid json');
    let calls = 0;
    const fetch: NpmFetch = async () => {
      calls++;
      return jsonResponse({ version: '0.6.0' });
    };
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.6.0', fetch, cacheFile });
    expect(calls).toBe(1);
    expect(r.status).toBe('ok');
  });

  it('cache missing a required field → treated as absent, falls through to a live fetch', async () => {
    const cacheFile = join(brainDir, 'npm-currency-cache.json');
    writeFileSync(cacheFile, JSON.stringify({ version: '0.2.0' })); // no fetchedAt
    let calls = 0;
    const fetch: NpmFetch = async () => {
      calls++;
      return jsonResponse({ version: '0.7.0' });
    };
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.7.0', fetch, cacheFile });
    expect(calls).toBe(1);
    expect(r.detail).toContain('0.7.0');
  });
});

// The axis-(b) regression guard (ADR-0058's binding proof shape). The healthy
// line must name exactly the two things compared, and must never drift toward
// a broader claim like "you are up to date" — the wording class that survived
// an L4 and a unit test once before (RFC-024 §1's fix/doctor-currency-line
// precedent, operator-verified 2026-07-10).
describe('ADR-0058 — axis-(b) wording discipline (the regression guard)', () => {
  it('the healthy line names the installed version AND the npmjs latest dist-tag, nothing more', async () => {
    const fetch: NpmFetch = async () => jsonResponse({ version: '1.2.3' });
    const r = await checkNpmCurrency({ brainDir, installedVersion: '1.2.3', fetch });
    expect(r.status).toBe('ok');
    // Positive: pins the exact comparison claim (both compared values named).
    expect(r.detail).toMatch(/installed 1\.2\.3 matches the npmjs latest dist-tag \(1\.2\.3\)/);
    // Negative: forbidden overclaim phrases must NEVER appear on the healthy line.
    expect(r.detail).not.toMatch(/up to date|newest|current version|latest version available/i);
  });

  it('the behind line also avoids the forbidden overclaim phrases', async () => {
    const fetch: NpmFetch = async () => jsonResponse({ version: '2.0.0' });
    const r = await checkNpmCurrency({ brainDir, installedVersion: '1.0.0', fetch });
    expect(r.detail).not.toMatch(/up to date|newest|current version|latest version available/i);
  });

  it('the behind line never flips doctor to a failing/blocking state on its own', async () => {
    const fetch: NpmFetch = async () => jsonResponse({ version: '9.0.0' });
    const r = await checkNpmCurrency({ brainDir, installedVersion: '0.1.0', fetch });
    expect(r.status).toBe('warn'); // never 'fail' — currency is information, not breakage
  });
});
