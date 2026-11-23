import { describe, expect, it } from 'vitest';
import { awsCloud, sign } from '../src/aws.js';
import { readConfig } from '../src/config.js';

const config = readConfig({ CONSOLE_CLOUD: 'aws', CONSOLE_AWS_STATE_DIR: '/state' } as NodeJS.ProcessEnv);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Stands in for the server's metadata service, ECR and RDS. Records what was asked. */
function fakeAws(over: Record<string, () => Response> = {}) {
  const asked: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetcher = (async (input: any, init: any = {}) => {
    const url = String(input);
    asked.push({ url, headers: init.headers || {} });
    for (const [part, answer] of Object.entries(over)) if (url.includes(part)) return answer();
    if (url.endsWith('/api/token')) return new Response('tok');
    if (url.endsWith('/security-credentials/')) return new Response('clor-ApiRole');
    if (url.includes('/security-credentials/clor-ApiRole')) return json({ AccessKeyId: 'AKIDEXAMPLE', SecretAccessKey: 'secret', Token: 'session', Expiration: new Date(Date.now() + 3600_000).toISOString() });
    if (url.includes('api.ecr.')) return json({ imageDetails: [{ imageTags: ['ad81ab7'], imagePushedAt: 1795400000 }, { imageTags: ['f0c108b'], imagePushedAt: 1795450000 }, { imagePushedAt: 1795460000 }] });
    if (url.includes('rds.')) return new Response(`<r><LatestRestorableTime>${new Date(Date.now() - 4 * 60_000).toISOString()}</LatestRestorableTime></r>`);
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetcher, asked };
}
const files = (f: Record<string, string>) => async (file: string) => {
  const name = file.split('/').pop()!;
  if (!(name in f)) throw new Error('ENOENT');
  return f[name];
};

describe('the Console on AWS', () => {
  // protects=releases are read from the image store, newest first, and the serving one from the server's own record
  it('lists the releases in the image store and names the one serving', async () => {
    const { fetcher, asked } = fakeAws();
    const cloud = awsCloud(config, fetcher, files({ 'serving.json': JSON.stringify({ tag: 'f0c108b' }) }));
    const s = await cloud.service('clor-api');
    expect(s.revisions.map((r) => r.name)).toEqual(['f0c108b', 'ad81ab7']); // the untagged image is not a release
    expect(s.revisions[0].tags).toEqual(['rel-f0c108b']);
    expect(s.serving).toEqual([{ revision: 'f0c108b', percent: 100 }]);
    const ecr = asked.find((a) => a.url.includes('api.ecr.ap-south-1'))!;
    expect(ecr.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ap-south-1\/ecr\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
    expect(ecr.headers['x-amz-security-token']).toBe('session');
    expect(ecr.headers).not.toHaveProperty('host');
  });

  // protects=a server that has released nothing through the script yet says "nothing serving", not an error
  it('says nothing is serving, and no migration is known, before the first release', async () => {
    const cloud = awsCloud(config, fakeAws().fetcher, files({}));
    expect((await cloud.service('clor-api')).serving).toEqual([]);
    expect(await cloud.lastMigration()).toBeNull();
  });

  it('reads the last migration from the server record', async () => {
    const cloud = awsCloud(config, fakeAws().fetcher, files({ 'migration.json': JSON.stringify({ ok: false, endedAt: '2026-11-24T10:00:00Z' }) }));
    expect(await cloud.lastMigration()).toEqual({ ok: false, endedAt: '2026-11-24T10:00:00Z' });
  });

  // protects=backups that stopped arriving are not shown as "Backed up"
  it('calls the backup good only while the database can be restored to within the last hour', async () => {
    expect((await awsCloud(config, fakeAws().fetcher, files({})).lastBackup())?.status).toBe('SUCCESSFUL');
    const old = fakeAws({ 'rds.': () => new Response('<r><LatestRestorableTime>2026-11-01T00:00:00Z</LatestRestorableTime></r>') });
    expect((await awsCloud(config, old.fetcher, files({})).lastBackup())?.status).toBe('STALE');
  });

  it('fails loudly when AWS refuses, so the Console says "Could not check"', async () => {
    const down = fakeAws({ 'api.ecr.': () => new Response('denied', { status: 403 }) });
    await expect(awsCloud(config, down.fetcher, files({})).service('clor-api')).rejects.toThrow('AWS answered 403');
  });

  // protects=the signature AWS checks: this is AWS's own published example (GET iam ListUsers, 20150830)
  it('signs a request the way AWS documents', () => {
    const h = sign({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      service: 'iam',
      region: 'us-east-1',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: '',
      keys: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', token: '' },
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  });
});
