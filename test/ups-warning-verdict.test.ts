// scenarios/lib/ups-warning-verdict.mjs (vfkb#395): every predicate can fail.
import { describe, it, expect } from 'vitest';
import {
  WARNING_LEADIN,
  ARMS,
  warningChannels,
  screenCount,
  observedLabel,
  rawBeforeExit,
  voidReason,
  trialPass,
  armVerdict,
  runVerdict,
} from '../scenarios/lib/ups-warning-verdict.mjs';
import { NO_AUTOCOMMIT_LEADIN, renderNoAutocommitMessage } from '../src/session-end.js';

const MSG = renderNoAutocommitMessage('default', 'main', 1);
const ok = { pluginInstalled: true, reachedPrompt: true, replies: 3, prompts: 3, hookControl: true, relayedByModel: false };

describe('ups-warning verdict', () => {
  it('the lead-in is the engine constant', () => {
    expect(WARNING_LEADIN).toBe(NO_AUTOCOMMIT_LEADIN);
  });
  it('arms: one present, two absent', () => {
    expect(Object.entries(ARMS).map(([k, v]) => `${k}:${v.expect}`)).toEqual([
      'treatment-main:present',
      'contrast-topic:absent',
      'contrast-clean:absent',
    ]);
  });
  it('warningChannels sees the screen, a wrapped screen and the ANSI-coloured raw log; and nothing else', () => {
    expect(warningChannels({ screen: `  UserPromptSubmit says: ${MSG}\n`, raw: '' })).toEqual(['screen', 'screenJoined']);
    const wrapped = `x says: vfkb will not auto-\ncommit the 1 new brain entry`;
    expect(warningChannels({ screen: wrapped })).toEqual(['screenJoined']);
    expect(warningChannels({ raw: `\x1b[2mvfkb will not \x1b[0mauto-commit`.replace('\x1b[0m', '') })).toEqual(['raw']);
    expect(warningChannels({ screen: 'vfkb handoff status: x', raw: 'nothing' })).toEqual([]);
  });
  it('the raw channel stops at /exit: SessionEnd\'s same-lead-in message after it cannot pass treatment-main', () => {
    const before = 'prompt 1 reply\nprompt 2 reply\n';
    const log = Buffer.from(before + `/exit\n${MSG}\n`, 'utf8');
    const mark = Buffer.byteLength(before, 'utf8');
    expect(warningChannels({ screen: '', raw: log.toString('utf8') })).toEqual(['raw']); // the hole
    expect(rawBeforeExit(log, mark)).toBe(before);
    expect(warningChannels({ screen: '', raw: rawBeforeExit(log, mark) })).toEqual([]);
    expect(trialPass('present', { ...ok, screen: '', raw: rawBeforeExit(log, mark) })).toBe(false);
    expect(trialPass('present', { ...ok, screen: '', raw: rawBeforeExit(Buffer.from(MSG + '\n/exit'), MSG.length) })).toBe(true);
    expect(rawBeforeExit(log, 0)).toBe(''); // no mark (prompt never reached) → nothing
    expect(rawBeforeExit(log, undefined)).toBe('');
  });
  it('observedLabel reads the text before the lead-in on its line', () => {
    expect(observedLabel(`  ⎿  UserPromptSubmit says: ${MSG}`)).toBe('UserPromptSubmit says:');
    expect(observedLabel('no warning here')).toBeNull();
  });
  it('screenCount counts occurrences', () => {
    expect(screenCount(`${MSG}\n${MSG}`)).toBe(2);
    expect(screenCount('')).toBe(0);
  });
  it('VOID: plugin missing, no prompt, short turns, no hook control', () => {
    expect(voidReason(ok)).toBeNull();
    expect(voidReason({ ...ok, pluginInstalled: false })).toMatch(/plugin/);
    expect(voidReason({ ...ok, reachedPrompt: false })).toMatch(/input prompt/);
    expect(voidReason({ ...ok, replies: 2 })).toMatch(/2\/3/);
    expect(voidReason({ ...ok, hookControl: false })).toMatch(/control/);
  });
  it('trialPass: present needs the screen hit and no model relay; absent needs no hit; VOID is null', () => {
    expect(trialPass('present', { ...ok, screen: MSG })).toBe(true);
    expect(trialPass('present', { ...ok, screen: '' })).toBe(false);
    expect(trialPass('present', { ...ok, screen: MSG, relayedByModel: true })).toBe(false);
    expect(trialPass('absent', { ...ok, screen: '' })).toBe(true);
    expect(trialPass('absent', { ...ok, screen: MSG })).toBe(false);
    expect(trialPass('absent', { ...ok, reachedPrompt: false })).toBeNull();
  });
  it('armVerdict: >= 2/3 of 3 valid; VOIDs do not count; short of valid trials is INCOMPLETE', () => {
    expect(armVerdict([true, true, false]).verdict).toBe('DEMONSTRATED');
    expect(armVerdict([true, false, false]).verdict).toBe('NOT-DEMONSTRATED');
    expect(armVerdict([true, null, true]).verdict).toBe('INCOMPLETE');
    expect(armVerdict([null, true, true, true]).verdict).toBe('DEMONSTRATED');
  });
  it('runVerdict: every arm', () => {
    expect(runVerdict({ a: { verdict: 'DEMONSTRATED' }, b: { verdict: 'DEMONSTRATED' } })).toBe('DEMONSTRATED');
    expect(runVerdict({ a: { verdict: 'DEMONSTRATED' }, b: { verdict: 'NOT-DEMONSTRATED' } })).toBe('NOT-DEMONSTRATED');
    expect(runVerdict({ a: { verdict: 'INCOMPLETE' } })).toBe('INCOMPLETE');
    expect(runVerdict({})).toBe('INCOMPLETE');
  });
});
