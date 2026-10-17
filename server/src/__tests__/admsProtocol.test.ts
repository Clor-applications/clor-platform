import { describe, it, expect } from 'vitest';

import {
  FACE,
  FINGER,
  admsField,
  parseBiodataLine,
  templateCommands,
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
  messageCommand,
  USERPIC,
} from '../services/attendance/adms.js';

/** The ADMS rules, ported from ClorTime (server/services/adms.js and friends). */

describe('reading what a reader sends', () => {
  it('reads tab and space separated punch lines', () => {
    expect(parseAttlogLine('104\t2026-10-14 09:02:11\t0\t15\t0\t0')).toEqual({ pin: '104', localTime: '2026-10-14 09:02:11', state: '0', verifyMode: 15, workCode: null });
    expect(parseAttlogLine('104  2026-10-14 18:30:00  1  1  0')).toMatchObject({ pin: '104', localTime: '2026-10-14 18:30:00', state: '1' });
    expect(parseAttlogLine('garbage')).toBeNull();
    expect(parseAttlogLine('104\tnot a time\t0\t1')).toBeNull();
  });

  it('treats the reader clock as IST', () => {
    expect(instantOf('2026-10-14 09:00:00')!.toISOString()).toBe('2026-10-14T03:30:00.000Z');
  });

  it('reads model, firmware and only a real IP from INFO', () => {
    expect(parseInfo('ZAM70-NF24HA-Ver3.3.12,1,1,0,192.168.1.201,10,40,12')).toMatchObject({
      model: 'ZAM70-NF24HA',
      firmware: '3.3.12',
      ip: '192.168.1.201',
      faceSupported: true,
      fingerSupported: true,
      faceMajorVer: 40,
      faceCount: 12,
    });
    // A real eSSL fingerprint reader (15 Oct 2026): 6 users, 6 fingerprints, 980 punches, no face.
    expect(parseInfo('Ver 8.0.4.3-20240116,6,6,980,10.81.20.225,10,-1,0,0,100,0,0,0')).toEqual({
      model: null,
      firmware: '8.0.4.3',
      ip: '10.81.20.225',
      faceSupported: false,
      fingerSupported: true,
      faceMajorVer: null,
      userCount: 6,
      fingerCount: 6,
      punchCount: 980,
      faceCount: null,
    });
    expect(parseInfo('MB20-Ver6.0,0,1,0,10.0.0.7').faceSupported).toBeNull();
    expect(parseInfo('X-Ver1,1,1,0,;rm -rf /').ip).toBeNull();
  });

  it('reads command results, several to a body', () => {
    expect(parseCommandResults('ID=7&Return=0&CMD=DATA\nID=8&Return=-1004&CMD=DATA')).toMatchObject([
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

describe('templates', () => {
  const b64 = Buffer.from('x'.repeat(200)).toString('base64');

  it('reads fingerprints, faces and BIODATA, keeping base64 whole', () => {
    expect(parseBiodataLine(`FP PIN=104\tFID=6\tSize=1200\tValid=1\tTMP=${b64}`)).toMatchObject({ kind: 'TEMPLATE', template: { pin: '104', type: FINGER, no: 6, data: b64 } });
    expect(parseBiodataLine(`FACE PIN=104\tFID=0\tVALID=1\tTMP=${b64}`)).toMatchObject({ template: { type: FACE } });
    expect(parseBiodataLine(`BIODATA Pin=7\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=58\tMinorVer=12\tFormat=0\tTmp=${b64}`)).toMatchObject({
      template: { pin: '7', type: FACE, majorVer: 58, minorVer: 12 },
    });
    expect(parseBiodataLine(`PIN=9\tFID=1\tTMP=${b64}`, 'FINGERTMP')).toMatchObject({ template: { type: FINGER } });
  });

  it('skips blank and truncated templates', () => {
    expect(parseBiodataLine(`FP PIN=1\tFID=0\tTMP=${'A'.repeat(200)}`)).toBeNull();
    expect(parseBiodataLine('FP PIN=1\tFID=0\tTMP=abc')).toBeNull();
  });

  it('reads a user with card, password and privilege', () => {
    expect(parseBiodataLine('USER PIN=104\tName=Ravi\tPri=14\tPasswd=1234\tCard=998877')).toEqual({
      kind: 'USER',
      pin: '104',
      name: 'Ravi',
      privilege: 14,
      password: '1234',
      card: '998877',
    });
  });

  it('builds FINGERTMP for fingers, delete + BIODATA for faces at the target’s version', () => {
    const t = { pin: '7', no: 0, data: b64, valid: 1, duress: 0, majorVer: 40, minorVer: 1, format: 0, indexNo: 0 };
    const f = templateCommands({ ...t, type: FINGER });
    expect(f).toHaveLength(1);
    expect(f[0].command).toMatch(/^DATA UPDATE FINGERTMP PIN=7\tFID=0\tSize=200\tValid=1\tTMP=/);
    const face = templateCommands({ ...t, type: FACE }, { faceMajorVer: 58, faceMinorVer: 12 });
    expect(face.map((c) => c.command.split('\t')[0])).toEqual(['DATA DELETE FACE PIN=7', 'DATA UPDATE BIODATA Pin=7']);
    expect(face[1].command).toContain('MajorVer=58\tMinorVer=12');
    expect(face[0].seq).toBeLessThan(face[1].seq);
  });
});

describe('command vocabulary', () => {
  it('every DATA command targets an entity the readers accept (ClorTime tests/adms_commands.test.js)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    /* Readers reject anything else with Return=-1004, which looks like a network failure. USERVF, facev7 and
       templatev10 are absent on purpose: ClorTime's readers rejected them every time. "USER" is not "USERINFO". */
    const KNOWN = new Set(['USERINFO', 'FINGERTMP', 'FACE', 'BIODATA', 'ATTLOG', 'USERPIC', 'SMS', 'WORKCODE', 'OPLOG']);
    const found: string[] = [];
    for (const rel of ['services/attendance/adms.ts', 'routes/iclock.ts', 'routes/devices.ts']) {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8');
      for (const m of src.matchAll(/DATA\s+(UPDATE|DELETE|QUERY)\s+([A-Za-z]+)/g)) if (!KNOWN.has(m[2].toUpperCase())) found.push(`${rel}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });
});

describe('work codes, reader messages and photos', () => {
  it('keeps the work code a reader sends, and drops the 0 that means none', () => {
    expect(parseAttlogLine('104\t2026-10-17 09:01:00\t0\t1\t12')!.workCode).toBe('12');
    expect(parseAttlogLine('104\t2026-10-17 09:01:00\t0\t15\t0')!.workCode).toBeNull();
    expect(parseAttlogLine('104\t2026-10-17 09:01:00\t0\t1')!.workCode).toBeNull();
  });
  it('writes a message for everyone or for one person, in the reader’s own clock', () => {
    const at = new Date('2026-10-17T12:00:00Z');
    expect(messageCommand('Office closes at 4', 60, null, at)).toBe('DATA UPDATE SMS MSG=Office closes at 4\tTAG=253\tUID=0\tMIN=60\tStartTime=2026-10-17 17:30:00');
    expect(messageCommand('See HR\tnow\n', 0, '104', at)).toBe('DATA UPDATE SMS MSG=See HR now\tTAG=254\tUID=104\tMIN=60\tStartTime=2026-10-17 17:30:00');
    expect(messageCommand('x'.repeat(300), 99_999, null, at)).toContain(`MSG=${'x'.repeat(200)}\t`);
    expect(messageCommand('x', 99_999, null, at)).toContain('MIN=10080');
  });
  it('reads a USERPIC line as the person’s photo and sends it on as one', () => {
    const jpeg = Buffer.alloc(300, 1).toString('base64');
    const r = parseBiodataLine(`USERPIC PIN=104\tFileName=104.jpg\tSize=300\tContent=${jpeg}`, 'OPERLOG');
    expect(r?.kind).toBe('TEMPLATE');
    if (r?.kind !== 'TEMPLATE') throw new Error('not a template');
    expect(r.template).toMatchObject({ pin: '104', type: USERPIC, no: 0 });
    const cmds = templateCommands(r.template);
    expect(cmds).toHaveLength(1);
    expect(cmds[0].command.startsWith('DATA UPDATE USERPIC PIN=104\tSize=')).toBe(true);
    expect(cmds[0].command).toContain(`Content=${jpeg}`);
    expect(parseBiodataLine('USERPIC PIN=104\tFileName=104.jpg\tSize=0\tContent=', 'OPERLOG')).toBeNull();
  });
});
