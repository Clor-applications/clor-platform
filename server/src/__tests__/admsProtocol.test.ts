import { describe, it, expect } from 'vitest';

import {
  admsField,
  instantOf,
  pairDay,
  parseAttlogLine,
  parseCommandResults,
  parseInfo,
  parseUserLine,
  pinKey,
  punchKind,
  shiftDayOf,
  userInfoCommand,
} from '../services/attendance/adms.js';

/** The ADMS rules, ported from ClorTime (server/services/adms.js and friends). */

describe('reading what a reader sends', () => {
  it('reads tab and space separated punch lines', () => {
    expect(parseAttlogLine('104\t2026-10-14 09:02:11\t0\t15\t0\t0')).toEqual({ pin: '104', localTime: '2026-10-14 09:02:11', state: '0', verifyMode: 15 });
    expect(parseAttlogLine('104  2026-10-14 18:30:00  1  1  0')).toMatchObject({ pin: '104', localTime: '2026-10-14 18:30:00', state: '1' });
    expect(parseAttlogLine('garbage')).toBeNull();
    expect(parseAttlogLine('104\tnot a time\t0\t1')).toBeNull();
  });

  it('treats the reader clock as IST', () => {
    expect(instantOf('2026-10-14 09:00:00')!.toISOString()).toBe('2026-10-14T03:30:00.000Z');
  });

  it('reads model, firmware and only a real IP from INFO', () => {
    expect(parseInfo('ZAM70-NF24HA-Ver3.3.12,1,1,0,192.168.1.201,10,40')).toEqual({ model: 'ZAM70-NF24HA', firmware: '3.3.12', ip: '192.168.1.201' });
    expect(parseInfo('X-Ver1,1,1,0,;rm -rf /').ip).toBeNull();
  });

  it('reads command results, several to a body', () => {
    expect(parseCommandResults('ID=7&Return=0&CMD=DATA\nID=8&Return=-1004&CMD=DATA')).toEqual([
      { id: 7, returnCode: 0 },
      { id: 8, returnCode: -1004 },
    ]);
  });

  it('reads users', () => {
    expect(parseUserLine('USER PIN=104\tName=Ravi Kumar\tPri=0\tPasswd=\tCard=')).toEqual({ pin: '104', name: 'Ravi Kumar' });
  });
});

describe('direction', () => {
  it('a reader set to in or out decides; otherwise the state; 0/255 alone says nothing', () => {
    expect(punchKind('1', 'in')).toBe('IN');
    expect(punchKind('0', 'out')).toBe('OUT');
    for (const s of ['1', '2', '5', '9']) expect(punchKind(s, 'both')).toBe('OUT');
    for (const s of ['3', '4', '8']) expect(punchKind(s, 'both')).toBe('IN');
    expect(punchKind('0', 'both')).toBeNull();
    expect(punchKind('255', 'both')).toBeNull();
  });
});

describe('the day from its punches', () => {
  const at = (t: string) => instantOf(`2026-10-14 ${t}`)!;

  it('first punch in, last real exit out — a forgotten badge-out is not hidden', () => {
    const day = pairDay([
      { at: at('10:30:00'), kind: 'IN' },
      { at: at('13:49:00'), kind: 'OUT' },
      { at: at('14:45:00'), kind: 'IN' },
    ])!;
    expect(day.checkIn).toEqual(at('10:30:00'));
    expect(day.checkOut).toEqual(at('13:49:00'));
    expect(day.endsOnEntry).toBe(true);
  });

  it('with no direction at all, first and last', () => {
    const day = pairDay([
      { at: at('18:00:00'), kind: null },
      { at: at('09:00:00'), kind: null },
    ])!;
    expect([day.checkIn, day.checkOut]).toEqual([at('09:00:00'), at('18:00:00')]);
    expect(pairDay([{ at: at('09:00:00'), kind: null }])!.checkOut).toBeNull();
  });

  it('a night shift’s morning punches belong to the evening before (noon boundary)', () => {
    expect(shiftDayOf('2026-10-15 06:02:00', true)).toBe('2026-10-14');
    expect(shiftDayOf('2026-10-15 13:00:00', true)).toBe('2026-10-15');
    expect(shiftDayOf('2026-10-15 06:02:00', false)).toBe('2026-10-15');
    expect(shiftDayOf('2026-03-01 05:00:00', true)).toBe('2026-02-28');
  });
});

describe('commands', () => {
  it('a tab in a name cannot add a field to a reader command', () => {
    const cmd = userInfoCommand('104', 'Ravi\tPri=14');
    const fields = cmd.split('\t');
    expect(fields.filter((f) => f.startsWith('Pri='))).toEqual(['Pri=0']);
    expect(admsField('a\nb\tc')).toBe('a b c');
  });

  it('pins compare without leading zeros', () => {
    expect(pinKey('050')).toBe(pinKey('50'));
    expect(pinKey('omnt-27')).toBe('OMNT-27');
  });
});
