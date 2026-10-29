#!/usr/bin/env node
// The #411 probe's UserPromptSubmit rewrite step (decide step: a wrapper over the real hook).
// Reads the real engine's hook stdout on stdin and prints the variant's stdout. Touches only
// hookSpecificOutput.additionalContext (scenarios/lib/ups-wording.mjs applyVariant). A
// transform miss prints NOTHING and appends `void: transform-miss` to the side log, so the
// trial scores VOID, never a silent V0.
//   usage: <engine hook> | node ups-variant.mjs <V0|V1|V2> <side-log>
import { appendFileSync, readFileSync } from 'node:fs';
import { applyVariant } from '../../../../scenarios/lib/ups-wording.mjs';

const [variant, sideLog] = process.argv.slice(2);
let input = '';
try { input = readFileSync(0, 'utf8'); } catch { input = ''; }
const { out, miss } = applyVariant(variant, input);
if (miss && sideLog) appendFileSync(sideLog, `void: transform-miss ${variant}\n`);
process.stdout.write(out);
