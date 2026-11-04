// vfkb#445: on the pi (docker and host) and host claude arms, a run that THROWS (non-zero
// exit, timeout, spawn failure) used to come back from run() as `__ERROR__ …` text that
// the scenario then scored. A single-arm "nothing stored" predicate (no-secrets) passed on
// it, and a two-arm contrast whose BASELINE errored looked like it held. Now any such run
// forces its trial to a scored miss (RUN-ERROR / TIMEOUT row) and skips the trial's rest.
//
// No real pi/claude/docker and no network: fakes first on PATH, driven through the real
// scenarios/l4-purpose.mjs entry point.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(__dirname, '..');
const ANSWER = 'db-prod-9c814.internal.example';

// One fake, installed as `pi`, `claude` and `docker`. FAKE_MODE:
//   ok        answer the prompt (the vfkb arm's right answer)
//   fail      exit 1 with an auth error on stderr (every run)
//   baseline  fail only the naive-baseline run (pi: --append-system-prompt; claude: a
//             settings file whose hook is the naive dump), answer the vfkb run
//   hang      never answer (the caller's timeout kills it)
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: require('path').basename(process.argv[1]), argv: a }) + '\\n');
if (a[0] === '--version') { console.log('9.9.9 (fake)'); process.exit(0); }
if (a[0] === 'image') { console.log('sha256:fake'); process.exit(0); }
const cat = a.indexOf('cat');
if (cat > 0) {
  const [host, cont] = a[a.indexOf('-v') + 1].split(':');
  process.stdout.write(fs.readFileSync(a[cat + 1].replace(cont, host), 'utf8'));
  process.exit(0);
}
const mode = process.env.FAKE_MODE || 'ok';
const naive = a.includes('--append-system-prompt') ||
  a.some((x, i) => a[i - 1] === '--settings' && /naive/.test(fs.existsSync(x) ? fs.readFileSync(x, 'utf8') : ''));
if (mode === 'hang') setTimeout(() => {}, 600000);
else if (mode === 'fail' || (mode === 'baseline' && naive)) { console.error('Error: 401 Unauthorized (fake)'); process.exit(1); }
else console.log('${ANSWER}');
`;

let dir: string;
let log: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vfkb-445-'));
  log = join(dir, 'calls.log');
  for (const bin of ['pi', 'claude', 'docker']) {
    writeFileSync(join(dir, bin), FAKE);
    chmodSync(join(dir, bin), 0o755);
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Arm = 'pi-host' | 'pi-docker' | 'claude-host';
const ARM_ENV: Record<Arm, Record<string, string>> = {
  'pi-host': { VFKB_L4_HARNESS: 'pi', VFKB_L4_PI_MODE: 'host', VFKB_L4_PROVIDER: 'deepseek', VFKB_L4_MODEL: 'fake-model' },
  'pi-docker': { VFKB_L4_HARNESS: 'pi', VFKB_L4_PI_MODE: 'docker', VFKB_L4_PROVIDER: 'deepseek', VFKB_L4_MODEL: 'fake-model', DEEPSEEK_TOKEN: 'fake-deepseek' },
  'claude-host': { VFKB_L4_HARNESS: 'claude', VFKB_L4_CLAUDE_MODE: 'host', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-FAKEfakeFAKEfake0123456789' },
};
const runL4 = (arm: Arm, id: string, extra: Record<string, string> = {}) => {
  writeFileSync(log, '');
  return spawnSync(process.execPath, [join(REPO, 'scenarios/l4-purpose.mjs'), id, '--no-record'], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_LOG: log, VFKB_L4_TRIALS: '1', ...ARM_ENV[arm], ...extra },
  });
};
const agentRuns = () =>
  readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((c) => c.argv[0] !== '--version' && c.argv[0] !== 'image' && !c.argv.includes('cat'));

describe.each(['pi-host', 'pi-docker', 'claude-host'] as Arm[])('%s arm: an erroring run is a scored miss (vfkb#445)', (arm) => {
  it('a failing run cannot pass the single-arm "nothing stored" scenario', () => {
    const r = runL4(arm, 'no-secrets', { FAKE_MODE: 'fail' });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain('RUN-ERROR');
    expect(r.stdout).toContain('401 Unauthorized');
    expect(r.stdout).toContain('INCONCLUSIVE');
    expect(r.stdout).not.toMatch(/-> DEMONSTRATED/);
  });

  it('an erroring BASELINE does not count as the contrast holding, and ends the trial', () => {
    const r = runL4(arm, 'stale-supersession', { FAKE_MODE: 'baseline' });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain('RUN-ERROR');
    expect(r.stdout).toContain('INCONCLUSIVE');
    expect(agentRuns().length).toBe(2); // vfkb arm, then the baseline that failed
  });

  it('a healthy run still scores normally (the can-pass arm)', () => {
    const r = runL4(arm, 'no-secrets', { FAKE_MODE: 'ok' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toContain('RUN-ERROR');
    expect(r.stdout).toMatch(/-> DEMONSTRATED/);
  });
});

describe('pi-docker arm: a timeout is a scored miss (vfkb#445)', () => {
  it('a hung run forces the trial to a miss and is counted as a timeout', () => {
    const r = runL4('pi-docker', 'stale-supersession', { FAKE_MODE: 'hang', VFKB_L4_DOCKER_TIMEOUT: '1500' });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain('TIMEOUT');
    expect(r.stdout).toContain('ETIMEDOUT');
    expect(agentRuns().length).toBe(1); // the second run of the trial is skipped
  });
});
