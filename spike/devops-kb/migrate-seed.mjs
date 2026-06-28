// devops-kb seed builder — bulk-migrate the chosen mykb infra areas into a fresh
// vfkb brain (the devops-kb store). Lossless 1:1 for facts/decisions/gotchas/patterns.
//
// Run on the HOST (the brain is just a directory; the container only matters at runtime):
//   VFKB_DIR=~/.devops-kb/brain node spike/devops-kb/migrate-seed.mjs [--force]
//
// Mapping (mykb -> vfkb):
//   area            -> a tag (vfkb has no areas; one flat brain per project)
//   tags[]          -> merged tags
//   role            -> 'human' (authoritative; YOUR curated knowledge -> operator trust)
//   provenance.status -> preserved (an unverified mykb fact stays unverified)
//   zone 'archive'  -> 'archive'; everything else -> 'established'
//   decisions       -> status 'accepted' (settled history, not open RFCs)
//   gotcha failed/resolution -> folded into the text
// Each entry passes the no-secrets lint; rejects are skipped and reported (kind only).
import { addEntry } from '../../dist/engine.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MYKB = process.env.MYKB_DIR || join(process.env.HOME, '.mykb');
const BRAIN = process.env.VFKB_DIR;
if (!BRAIN) { console.error('set VFKB_DIR to the devops-kb brain dir'); process.exit(1); }

// Default = the Optiscan infra spine (og-devops bootstrap). Override per-instance with
// VFKB_SEED_AREAS="area1,area2,..." (e.g. the viloforge ecosystem for vf-devops).
const DEFAULT_AREAS = [
  // core spine
  'azure-tenant', 'networking', 'identity', 'vault', 'backup',
  'disaster-recovery', 'iac', 'cloud-management',
  // platform services
  'docker-swarm', 'traefik', 'gitlab', 'gitlab-runners', 'harbor', 'nexus',
  'sonarqube', 'mediawiki', 'observability', 'ssl-automation',
  'event-grid', 'event-router',
];
const AREAS = process.env.VFKB_SEED_AREAS
  ? process.env.VFKB_SEED_AREAS.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_AREAS;
const FILE_TYPE = { 'facts.jsonl': 'fact', 'decisions.jsonl': 'decision', 'gotchas.jsonl': 'gotcha', 'patterns.jsonl': 'pattern' };
const PROV_OK = new Set(['verified', 'unverified', 'stale', 'expired']);

// Guard: don't double-append into a non-empty brain.
const entriesFile = join(BRAIN, 'entries.jsonl');
if (existsSync(entriesFile) && readFileSync(entriesFile, 'utf8').trim() && !process.argv.includes('--force')) {
  console.error(`brain at ${BRAIN} is non-empty. wipe it (rm -rf) or pass --force.`);
  process.exit(1);
}

function gotchaText(o) {
  let t = o.text || '';
  if (o.failed) t += `\n\nFailed approach: ${o.failed}`;
  if (o.resolution) t += `\n\nResolution: ${o.resolution}`;
  return t;
}

const totals = { migrated: 0, rejected: 0, errored: 0 };
const perArea = {};
const rejects = [];

for (const area of AREAS) {
  const dir = join(MYKB, 'areas', area);
  if (!existsSync(dir)) { console.error(`  ! area not found: ${area}`); continue; }
  const stat = { migrated: 0, rejected: 0, errored: 0 };
  for (const file of readdirSync(dir)) {
    const type = FILE_TYPE[file];
    if (!type) continue; // skip area.json, links.jsonl, etc.
    const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let o;
      try { o = JSON.parse(line); } catch { stat.errored++; totals.errored++; continue; }
      const text = type === 'gotcha' ? gotchaText(o) : (o.text || '');
      if (!text.trim()) continue;
      const tags = [...new Set([area, ...(Array.isArray(o.tags) ? o.tags : [])])];
      const provStatus = PROV_OK.has(o?.provenance?.status) ? o.provenance.status : 'unverified';
      const zone = o.zone === 'archive' ? 'archive' : 'established';
      try {
        addEntry(type, text, {
          role: 'human',
          tags,
          provStatus,
          zone,
          status: type === 'decision' ? 'accepted' : undefined,
        });
        stat.migrated++; totals.migrated++;
      } catch (err) {
        const msg = String(err.message || err);
        if (/secret/i.test(msg)) { stat.rejected++; totals.rejected++; rejects.push(`${area}/${type} ${o.id || ''}: ${msg}`); }
        else { stat.errored++; totals.errored++; rejects.push(`${area}/${type} ${o.id || ''} ERROR: ${msg}`); }
      }
    }
  }
  perArea[area] = stat;
  console.log(`  ${area.padEnd(20)} migrated ${String(stat.migrated).padStart(4)}  rejected ${stat.rejected}  errored ${stat.errored}`);
}

console.log('\n=== TOTALS ===');
console.log(`migrated ${totals.migrated}   rejected(secrets) ${totals.rejected}   errored ${totals.errored}`);
if (rejects.length) { console.log('\n--- rejected / errored (kind only, no secret text) ---'); for (const r of rejects) console.log('  ' + r); }
