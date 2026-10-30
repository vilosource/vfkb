// The deterministic inner gate for scenarios/lib/claude-auth.mjs (vfkb#422): every
// host-run `claude` child carries an env token and a no-op `security` shim, and the
// harness never reads the macOS Keychain from a non-Aqua session.
//
// No network, no real Keychain, no real token. A fake `security` sits first on THIS
// process's PATH for the whole file, so even the vendored upstream's own Keychain
// read (Aqua path) lands in a log instead of the operator's login keychain.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LIB = '../scenarios/lib/claude-auth.mjs';
const VENDORED = resolve(__dirname, '../scenarios/lib/vendor/plugin-auth.mjs');
const FAKE = 'sk-ant-oat01-FAKEfakeFAKEfake0123456789';

process.setMaxListeners(100); // one exit listener per fresh module load below
const saved = { ...process.env };
let root: string;
let fakeLog: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'claude-auth-test-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  fakeLog = join(root, 'host-security.log');
  writeFileSync(join(bin, 'security'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${fakeLog}'\nexit 44\n`);
  chmodSync(join(bin, 'security'), 0o755);
  // The vendored upstream asks launchctl itself (not injectable through assertAuthReady);
  // answer "Aqua" so its own guard does not mask the token checks under test. The
  // wrapper's guard is driven by the explicit probe in every test below.
  writeFileSync(join(bin, 'launchctl'), '#!/bin/sh\necho Aqua\n');
  chmodSync(join(bin, 'launchctl'), 0o755);
  // A fake `claude` that reports what a real child would see: its token, which
  // `security` it resolves, and whether a Keychain write gets through.
  writeFileSync(join(bin, 'claude'), [
    '#!/bin/sh',
    'echo "token=$CLAUDE_CODE_OAUTH_TOKEN"',
    'echo "security=$(command -v security)"',
    'security add-generic-password -U -a a -s svc-child -w S >/dev/null 2>&1; echo "write-exit=$?"',
    '[ "$1" = "--fail" ] && { echo "boom $CLAUDE_CODE_OAUTH_TOKEN" >&2; exit 3; }',
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'claude'), 0o755);
  process.env.PATH = `${bin}:${saved.PATH}`;
  // Every shim dir the seam builds lands under root (os.tmpdir() reads TMPDIR per call),
  // so afterAll removes them even though a vitest worker may never fire 'exit'.
  mkdirSync(join(root, 'tmp'));
  process.env.TMPDIR = join(root, 'tmp');
});
afterAll(() => {
  process.env = { ...saved };
  rmSync(root, { recursive: true, force: true });
});

const hostSecurityCalls = () => (existsSync(fakeLog) ? readFileSync(fakeLog, 'utf8').split('\n').filter(Boolean) : []);

// A fresh module per test: the vendored seam caches the token at module scope.
async function load(env: Record<string, string | undefined>) {
  for (const k of ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'VFKB_L4_AUTH', 'VFKB_L4_MIN_TOKEN_MINUTES']) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  return import(LIB);
}

function storeDir(minutesLeft: number | null, token = 'store-token-ABCDEFGH12345678') {
  const cfg = mkdtempSync(join(root, 'cfg-'));
  if (minutesLeft !== null) {
    writeFileSync(join(cfg, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: token, refreshToken: 'never-staged', expiresAt: Date.now() + minutesLeft * 60000 },
    }));
  }
  return cfg;
}

const LINUX = { platform: 'linux' };
const BACKGROUND = { platform: 'darwin', manager: 'Background' };

beforeEach(() => {
  if (existsSync(fakeLog)) rmSync(fakeLog);
});

describe('vendored upstream', () => {
  it('is byte-identical to vfkb-claude-plugin scenarios/auth.mjs @ 36552e76 (git blob pin)', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    const body = readFileSync(VENDORED);
    const blob = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
    expect(blob).toBe(lib.UPSTREAM.blob);
    expect(lib.UPSTREAM.commit.startsWith('36552e76')).toBe(true);
  });
});

describe('child env', () => {
  it('carries the token, keeps the caller env, and puts the shim first on PATH', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    const env = lib.claudeEnv({ PATH: '/usr/bin:/bin', KEEP: '1' }, BACKGROUND);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(FAKE);
    expect(env.KEEP).toBe('1');
    const shim = env.PATH.split(':')[0];
    expect(readdirSync(shim)).toContain('security');
    expect(env.PATH.endsWith(':/usr/bin:/bin')).toBe(true);
    expect(hostSecurityCalls()).toEqual([]);
  });

  it('never stages a credentials file into a sandbox config dir', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    const cfg = mkdtempSync(join(root, 'sandbox-cfg-'));
    lib.claudeEnv({ PATH: '/usr/bin', CLAUDE_CONFIG_DIR: cfg }, LINUX);
    expect(readdirSync(cfg)).toEqual([]);
  });
});

describe('the security shim', () => {
  it('refuses add-generic-password, the `security -i` stdin path and reads; logs no secret', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    const env = lib.claudeEnv({ PATH: '/usr/bin:/bin' }, LINUX);
    const sec = join(env.PATH.split(':')[0], 'security');
    const run = (args: string[], input?: string) => spawnSync(sec, args, { env, input, encoding: 'utf8' });

    expect(run(['add-generic-password', '-U', '-a', 'acct', '-s', 'svc-A', '-w', 'SECRET-VALUE-1']).status).toBe(44);
    expect(run(['-i'], 'add-generic-password -U -a acct -s svc-B -X 00ffSTDINPAYLOAD\n').status).toBe(44);
    expect(run(['find-generic-password', '-s', 'svc-C', '-w']).status).toBe(44);

    const r = lib.keychainShimReport();
    expect(r).toEqual({ built: true, calls: 3, refusedWrites: 2 });
    const log = readFileSync(join(env.PATH.split(':')[0], 'attempts.log'), 'utf8');
    expect(log).toContain('add-generic-password|svc-A');
    expect(log).toContain('find-generic-password|svc-C');
    expect(log).not.toContain('SECRET-VALUE-1');
    expect(log).not.toContain('STDINPAYLOAD');
    expect(log).not.toContain('svc-B');
    expect(hostSecurityCalls()).toEqual([]);
  });
});

describe('mode and precondition hardening (review F2/F3)', () => {
  it('VFKB_L4_AUTH=deepseek-env is refused: it would strip the token and drop the shim', async () => {
    const lib = await load({ VFKB_L4_AUTH: 'deepseek-env', DEEPSEEK_TOKEN: 'sk-deepseekdeepseek1234', CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    expect(() => lib.claudeEnv({ PATH: '/usr/bin' }, LINUX)).toThrow(/VFKB_L4_AUTH=deepseek-env is not supported/);
    expect(() => lib.assertClaudeAuthReady(LINUX)).toThrow(/VFKB_L4_AUTH=deepseek-env/);
    delete process.env.DEEPSEEK_TOKEN;
  });

  it('claudeEnv runs the token checks itself: a scenario that skips assertClaudeAuthReady still cannot spawn on a 59-min token', async () => {
    const lib = await load({ CLAUDE_CONFIG_DIR: storeDir(59) });
    expect(() => lib.claudeEnv({ PATH: '/usr/bin' }, LINUX)).toThrow(/expires in 59 min/);
  });
});

describe('shim placement is verified, not assumed (round-2 F2)', () => {
  it('claudeEnv refuses when the vendored authEnv returns a PATH whose first entry is not the shim', async () => {
    await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    vi.doMock('../scenarios/lib/vendor/plugin-auth.mjs', async (orig) => {
      const real: any = await orig();
      return { ...real, authEnv: (base: any) => ({ ...real.authEnv(base), PATH: '/usr/bin:/bin' }) };
    });
    try {
      vi.resetModules();
      const lib = await import(LIB);
      expect(() => lib.claudeEnv({ PATH: '/usr/bin' }, LINUX)).toThrow(/not first on the child PATH/);
    } finally {
      vi.doUnmock('../scenarios/lib/vendor/plugin-auth.mjs');
    }
  });
});

describe('claudeSync (the spawn seam)', () => {
  it('the child resolves the shim, its Keychain write is refused, and the token never comes back out', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    const out: string = lib.claudeSync(['-p', 'x'], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(out).toMatch(/security=.*vfkb-l4-nokeychain-[^/]+\/security/);
    expect(out).toContain(join(root, 'tmp'));
    expect(out).toContain('write-exit=44');
    expect(out).toContain('token=***REDACTED***');
    expect(out).not.toContain(FAKE);
    expect(lib.keychainShimReport()).toEqual({ built: true, calls: 1, refusedWrites: 1 });
    expect(hostSecurityCalls()).toEqual([]);
  });

  it('a failing child: stdout, stderr and message on the thrown error are redacted', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    let err: any;
    try { lib.claudeSync(['--fail'], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { err = e; }
    expect(err?.status).toBe(3);
    expect(String(err.stderr)).toContain('boom ***REDACTED***');
    expect(`${err.stdout}${err.stderr}${err.message}`).not.toContain(FAKE);
  });

  it('encoding buffer and e.output are redacted too (review F5)', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    const buf = lib.claudeSync(['-p', 'x'], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toContain('token=***REDACTED***');
    expect(buf.toString()).not.toContain(FAKE);
    let err: any;
    try { lib.claudeSync(['--fail'], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { err = e; }
    expect(err.output.map(String).join('')).toContain('***REDACTED***');
    expect(err.output.map(String).join('')).not.toContain(FAKE);
  });

  it('claudeVersion goes through the same seam', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    expect(lib.claudeVersion()).toContain('write-exit=44');
  });
});

describe('token rules', () => {
  it('an exported env token wins over the store', async () => {
    const cfg = storeDir(600);
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE, CLAUDE_CONFIG_DIR: cfg });
    expect(() => lib.assertClaudeAuthReady(LINUX)).not.toThrow();
    expect(lib.claudeEnv({ PATH: '/usr/bin' }, LINUX).CLAUDE_CODE_OAUTH_TOKEN).toBe(FAKE);
  });

  it('a stored token with 59 min left is refused; 61 min is allowed and is what the child gets', async () => {
    let lib = await load({ CLAUDE_CONFIG_DIR: storeDir(59) });
    expect(() => lib.assertClaudeAuthReady(LINUX)).toThrow(/expires in 59 min .*VFKB_L4_MIN_TOKEN_MINUTES=60/);

    lib = await load({ CLAUDE_CONFIG_DIR: storeDir(61, 'store-token-61MIN-abcdefgh') });
    expect(() => lib.assertClaudeAuthReady(LINUX)).not.toThrow();
    const env = lib.claudeEnv({ PATH: '/usr/bin' }, LINUX);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('store-token-61MIN-abcdefgh');
    expect(JSON.stringify(env)).not.toContain('never-staged'); // the refresh token never reaches a child
  });

  it('an expired stored token is refused with its ISO expiry', async () => {
    const lib = await load({ CLAUDE_CONFIG_DIR: storeDir(-5) });
    expect(() => lib.assertClaudeAuthReady(LINUX)).toThrow(/EXPIRED at \d{4}-\d\d-\d\dT/);
  });

  it('a miss names every place it looked', async () => {
    const cfg = storeDir(null);
    const lib = await load({ CLAUDE_CONFIG_DIR: cfg });
    expect(() => lib.assertClaudeAuthReady(LINUX)).toThrow(new RegExp(`looked in: ${cfg}/\\.credentials\\.json`));
  });

  // Not skipped on Linux (a skipped test reads as tamper): the Keychain branch only exists
  // on darwin, so each platform asserts what its lookup actually tried.
  it('Aqua path: the Keychain service is keyed by sha256(config dir)[:8] (darwin), file-only elsewhere', async () => {
    const cfg = '/Users/jasonviloria/.claude-cldp-not-a-real-dir';
    const lib = await load({ CLAUDE_CONFIG_DIR: cfg });
    const svc = `Claude Code-credentials-${createHash('sha256').update(cfg).digest('hex').slice(0, 8)}`;
    if (process.platform === 'darwin') {
      expect(() => lib.assertClaudeAuthReady({ platform: 'darwin', manager: 'Aqua' })).toThrow(svc);
      // Read-only lookup, and it reached the fake on this process's PATH, never the real Keychain.
      expect(hostSecurityCalls().some((l) => l.startsWith('find-generic-password') && l.includes(svc))).toBe(true);
      expect(hostSecurityCalls().every((l) => l.startsWith('find-generic-password'))).toBe(true);
    } else {
      expect(() => lib.assertClaudeAuthReady(LINUX)).toThrow(`looked in: ${cfg}/.credentials.json`);
      expect(hostSecurityCalls()).toEqual([]);
    }
    // The machine fixture, as a computed expectation only: ~/.claude-cldp -> 7993e3dd.
    expect(createHash('sha256').update('/Users/jasonviloria/.claude-cldp').digest('hex').slice(0, 8)).toBe('7993e3dd');
  });
});

describe('session guard (no Keychain access outside Aqua)', () => {
  it('darwin + Background + no env token: refuses, and never touches security', async () => {
    const lib = await load({ CLAUDE_CONFIG_DIR: storeDir(600) });
    expect(() => lib.assertNoKeychainDialogs({}, BACKGROUND)).toThrow(/"Background", not "Aqua"/);
    expect(() => lib.assertClaudeAuthReady(BACKGROUND)).toThrow(/not "Aqua"/);
    expect(() => lib.claudeEnv({ PATH: '/usr/bin' }, BACKGROUND)).toThrow(/not "Aqua"/);
    // Even with a readable stored token: the guard runs before any credential read.
    expect(hostSecurityCalls()).toEqual([]);
  });

  it('darwin + Background + no env token + NO credentials file: the check comes before any read (no security call at all)', async () => {
    // No file to serve a read from: if anything read credentials before the session
    // check, the read would fall through to `security` and land in hostSecurityCalls().
    const lib = await load({ CLAUDE_CONFIG_DIR: storeDir(null) });
    expect(() => lib.assertClaudeAuthReady(BACKGROUND)).toThrow(/not "Aqua"/);
    expect(() => lib.claudeEnv({ PATH: '/usr/bin' }, BACKGROUND)).toThrow(/not "Aqua"/);
    expect(hostSecurityCalls()).toEqual([]);
  });

  it('the vendored upstream reads the credential BEFORE checking the session (the divergence this guards)', async () => {
    await load({});
    const up = await import('../scenarios/lib/vendor/plugin-auth.mjs');
    const readToken = vi.fn(() => 'stored');
    up.assertNoKeychainDialogs({}, { platform: 'darwin', manager: 'Background', readToken });
    expect(readToken).toHaveBeenCalled();
  });

  it('Background + env token: allowed', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    expect(() => lib.assertNoKeychainDialogs({ CLAUDE_CODE_OAUTH_TOKEN: 'x' }, BACKGROUND)).not.toThrow();
    expect(() => lib.claudeEnv({ PATH: '/usr/bin' }, BACKGROUND)).not.toThrow();
  });

  it('Background + only an API key: refused (the vendored OAuth lookup would still read the Keychain)', async () => {
    const lib = await load({ ANTHROPIC_API_KEY: 'k' });
    expect(() => lib.assertNoKeychainDialogs({ ANTHROPIC_API_KEY: 'k' }, BACKGROUND)).toThrow();
  });

  it('Aqua + no env token: allowed', async () => {
    const lib = await load({});
    expect(() => lib.assertNoKeychainDialogs({}, { platform: 'darwin', manager: 'Aqua' })).not.toThrow();
  });

  it('linux: allowed', async () => {
    const lib = await load({});
    expect(() => lib.assertNoKeychainDialogs({}, { platform: 'linux', manager: 'Background' })).not.toThrow();
  });
});

describe('redaction', () => {
  it('removes the env token, the cached store token and sk- shaped strings; leaves other text alone', async () => {
    let lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    expect(lib.redactSecrets(`401 for ${FAKE}`)).not.toContain(FAKE);
    expect(lib.redactSecrets('tok sk-ant-oat01-abcdefghijklmnopqrstuv')).not.toContain('abcdefghijklmnop');
    const rec = JSON.stringify({ err: `Authorization: Bearer ${FAKE}`, out: 'fine' }, null, 2);
    expect(lib.redactSecrets(rec)).not.toContain(FAKE);
    expect(lib.redactSecrets('unrelated text: hit=true sk-short')).toBe('unrelated text: hit=true sk-short');

    lib = await load({ CLAUDE_CONFIG_DIR: storeDir(600, 'store-token-REDACTME-12345') });
    lib.claudeEnv({ PATH: '/usr/bin' }, LINUX);
    expect(lib.redactSecrets('echo store-token-REDACTME-12345')).not.toContain('REDACTME');
  });
});

describe('exit report', () => {
  it('prints an observable 0, a WARNING on refused writes, and says when the shim was never built', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    expect(lib.formatShimReport({ built: true, calls: 2, refusedWrites: 0 })).toBe('claude-auth: keychain shim calls=2 refusedWrites=0');
    expect(lib.formatShimReport({ built: true, calls: 3, refusedWrites: 1 })).toMatch(/^WARNING — .*refusedWrites=1$/);
    expect(lib.formatShimReport(lib.keychainShimReport())).toMatch(/calls=0 refusedWrites=0 \(shim never built/);
  });

  it('a built shim with no calls yet reports calls=0 refusedWrites=0', async () => {
    const lib = await load({ CLAUDE_CODE_OAUTH_TOKEN: FAKE });
    lib.claudeEnv({ PATH: '/usr/bin' }, LINUX);
    expect(lib.keychainShimReport()).toEqual({ built: true, calls: 0, refusedWrites: 0 });
  });
});
