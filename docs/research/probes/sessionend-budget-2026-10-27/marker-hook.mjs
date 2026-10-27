#!/usr/bin/env node
// SessionEnd calibration hook (vfkb#384 probe). Drains stdin, then writes one empty
// marker file per offset (seconds since THIS process started) into $PROBE_MARK_DIR,
// named "<label>@<offset>". The last marker that exists after the session ends shows
// when the harness stopped the hook. Also writes "<label>@start" and the payload.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.PROBE_MARK_DIR;
const label = process.argv[2] || 'hook';
const offsets = [0.25, 0.5, 1.0, 1.25, 1.4, 1.6, 2.0, 3.0, 4.5];
if (!dir) process.exit(0);
mkdirSync(dir, { recursive: true });
let payload = '';
process.stdin.on('data', (d) => (payload += d));
process.stdin.on('end', () => {
  writeFileSync(join(dir, `${label}@start`), payload);
});
const t0 = performance.now();
for (const s of offsets) {
  setTimeout(() => writeFileSync(join(dir, `${label}@${s}`), String(Math.round(performance.now() - t0))), s * 1000 - performance.now() + t0);
}
