import { describe, expect, it } from 'vitest';

import { sampleRun } from '../src/fakes.js';
import { world } from './helpers.js';

const HEAD7 = 'c5fbc8e';

describe('releases', () => {
  // protects=Stage starts the release workflow for the commit that was tested, in stage mode; fails_when=another mode, another commit or no dispatch; no_claim=the workflow itself is not run here, GitHub is canned
  it('stages the tested commit and logs it once', async () => {
    const w = await world();
    const eng = await w.as('ENGINEER');
    expect((await w.post(eng.agent, '/releases/stage')).status).toBe(202);
    expect(w.github.calls).toEqual([{ what: 'dispatch', args: ['release.yml', { mode: 'stage', sha: w.github.state.head }] }]);
    const log = w.store.audit.filter((e) => e.action.startsWith('RELEASE'));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'RELEASE_STAGED', target: HEAD7, actor: 'dev-engineer' });
  });

  // protects=nothing is staged on a commit whose full tests have not passed; fails_when=a dispatch goes out with tests missing, running or red; no_claim=none beyond protects
  it('will not stage until the full tests are green on main', async () => {
    const w = await world();
    const eng = await w.as('ENGINEER');
    for (const ci of [[], [sampleRun({ status: 'in_progress', conclusion: null })], [sampleRun({ conclusion: 'failure' })], [sampleRun({ event: 'push' })], [sampleRun({ headSha: 'f'.repeat(40) })]]) {
      w.github.state.ci = ci;
      w.clock.at += 60_000;
      await w.post(eng.agent, '/step-up', { code: eng.code() });
      expect((await w.post(eng.agent, '/releases/stage')).status).toBe(409);
    }
    expect(w.github.calls).toEqual([]);
  });

  // protects=Release is offered only for a commit already staged; fails_when=go is dispatched with no staged revision; no_claim=does not prove the staged revision answered /ready, the workflow checks that
  it('will not release a commit that is not staged, and releases one that is', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    expect((await w.post(owner.agent, '/releases/go', { reason: 'Weekly release' })).status).toBe(409);
    w.cloud.state.service.revisions.unshift({ name: 'clor-api-00132-new', createdAt: new Date(w.clock.at).toISOString(), image: `api:${HEAD7}`, tags: [`rel-${HEAD7}`] });
    w.clock.at += 60_000;
    await w.post(owner.agent, '/step-up', { code: owner.code() });
    expect((await owner.agent.get('/api/releases')).body.next).toBe('RELEASE');
    expect((await w.post(owner.agent, '/releases/go', { reason: 'Weekly release' })).status).toBe(202);
    expect(w.github.calls).toEqual([{ what: 'dispatch', args: ['release.yml', { mode: 'go', sha: w.github.state.head }] }]);
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'RELEASE_STARTED', reason: 'Weekly release' });
  });

  // protects=two releases never run at once; fails_when=a second dispatch goes out while one is unfinished; no_claim=none beyond protects
  it('will not start a release while another is running', async () => {
    const w = await world();
    const eng = await w.as('ENGINEER');
    w.github.state.release.unshift(sampleRun({ id: 8001, workflow: 'release.yml', status: 'in_progress', conclusion: null }));
    expect((await w.post(eng.agent, '/releases/stage')).status).toBe(409);
    expect(w.github.calls).toEqual([]);
  });

  // protects=a rollback goes to a revision that exists and is not the one serving, with a reason; fails_when=an unknown or current revision is dispatched, or none is given a reason; no_claim=traffic is not moved here; the workflow does that
  it('rolls back to a named earlier revision only', async () => {
    const w = await world();
    const eng = await w.as('ENGINEER');
    expect((await w.post(eng.agent, '/releases/rollback', { revision: 'clor-api-00999-nope', reason: 'Errors after release' })).status).toBe(404);
    expect((await w.post(eng.agent, '/releases/rollback', { revision: 'clor-api-00131-abc', reason: 'Errors after release' })).status).toBe(409);
    expect((await w.post(eng.agent, '/releases/rollback', { revision: 'clor-api-00127-622' })).status).toBe(400);
    expect((await w.post(eng.agent, '/releases/rollback', { revision: 'clor-api-00127-622; rm -rf /', reason: 'Errors after release' })).status).toBe(400);
    expect(w.github.calls).toEqual([]);
    expect((await w.post(eng.agent, '/releases/rollback', { revision: 'clor-api-00127-622', reason: 'Errors after release' })).status).toBe(202);
    expect(w.github.calls).toEqual([{ what: 'dispatch', args: ['rollback.yml', { revision: 'clor-api-00127-622', reason: 'Errors after release' }] }]);
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'ROLLED_BACK', target: 'clor-api-00127-622', detail: { from: 'clor-api-00131-abc' } });
  });

  // protects=the owner approves only what GitHub says is waiting for them, on a release run; fails_when=an approval is sent for another run or with nothing pending; no_claim=GitHub's own reviewer rule is canned
  it('approves a waiting release run and nothing else', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    expect((await w.post(owner.agent, '/releases/runs/8000/approve')).status).toBe(409);
    expect((await w.post(owner.agent, '/releases/runs/4242/approve')).status).toBe(404);
    w.github.state.pending[8000] = [{ environmentId: 55, environment: 'production', canApprove: true }];
    expect((await w.post(owner.agent, '/releases/runs/8000/approve')).status).toBe(200);
    expect(w.github.calls).toEqual([{ what: 'approveRun', args: [8000, [55], 'Approved in the Console by suresh-3333.'] }]);
  });

  // protects=when GitHub is down nothing is started and the page is told so; fails_when=a write answers as if it worked, or a read invents a next step; no_claim=none beyond protects
  it('starts nothing and offers nothing when GitHub cannot be reached', async () => {
    const w = await world();
    const eng = await w.as('ENGINEER');
    w.github.state.down = true;
    w.clock.at += 120_000;
    await w.post(eng.agent, '/step-up', { code: eng.code() });
    expect((await w.post(eng.agent, '/releases/stage')).status).toBe(503);
    const read = await eng.agent.get('/api/releases');
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ reachable: false, next: 'UNKNOWN' });
  });

  // protects=a change that GitHub refuses is logged as failed and reported as failed; fails_when=the page is told ok or the log shows only the attempt; no_claim=none beyond protects
  it('logs a failed change as failed', async () => {
    const w = await world();
    const eng = await w.as('ENGINEER');
    w.github.state.failWrites = true;
    expect((await w.post(eng.agent, '/releases/stage')).status).toBe(502);
    expect(w.store.audit.slice(-2).map((e) => e.action)).toEqual(['RELEASE_STAGED', 'RELEASE_STAGED_FAILED']);
  });
});

describe('overview', () => {
  // protects=a source that cannot be reached is shown as not checked, with the last good answer and its time, never as a fresh green; fails_when=a row keeps tone ok or loses its last answer; no_claim=last good answers live in memory and are lost on restart
  it('says "Could not check" with the last good answer when a source goes down', async () => {
    const w = await world();
    const viewer = await w.as('VIEWER');
    const before = (await viewer.agent.get('/api/overview')).body.rows;
    expect(before.find((r: any) => r.key === 'api')).toMatchObject({ tone: 'ok', state: 'Working', fact: 'rel-8a8ed97 is serving' });
    const seenAt = before.find((r: any) => r.key === 'backup').checkedAt;
    w.cloud.state.down = true;
    w.github.state.down = true;
    w.clock.at += 10 * 60_000;
    const after = (await viewer.agent.get('/api/overview')).body.rows;
    expect(after).toHaveLength(10);
    for (const row of after) expect(row, row.key).toMatchObject({ tone: 'none', state: 'Could not check' });
    expect(after.find((r: any) => r.key === 'backup')).toMatchObject({ checkedAt: seenAt, fact: 'Last good answer: Latest backup' });
  });

  // protects=no secret reaches the page in any read; fails_when=the session secret, a token or a sealed authenticator secret appears in a response; no_claim=covers the reads listed, with canned providers
  it('never sends a secret in a read', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    const sealedTotp = (await w.store.findByGithub('1001'))!.totpSecretEnc!;
    for (const path of ['/me', '/overview', '/releases', '/pulls', '/audit', '/members']) {
      const text = JSON.stringify((await owner.agent.get(`/api${path}`)).body);
      for (const secret of [w.config.sessionSecret, 'token-for-', owner.secret, sealedTotp]) expect(text.includes(secret), `${path} leaks`).toBe(false);
    }
  });
});

describe('pull requests', () => {
  // protects=each pull request is marked by what it touches and who wrote it; fails_when=a migration, release-path or Dependabot pull request is described as ordinary; no_claim=paths come from canned data; GitHub lists at most 100 per pull request
  it('marks what each pull request touches and who wrote it', async () => {
    const w = await world();
    const viewer = await w.as('VIEWER');
    const pulls = (await viewer.agent.get('/api/pulls')).body.pulls;
    const by = (n: number) => pulls.find((p: any) => p.number === n);
    expect(by(301)).toMatchObject({ writtenBy: 'AGENT', marks: [], cannotMerge: null });
    expect(by(302)).toMatchObject({ marks: ['RELEASE'], cannotMerge: 'It changes how releases or sign-in work. Review this one on GitHub.' });
    expect(by(303)).toMatchObject({ writtenBy: 'DEPENDABOT', cannotMerge: 'Its checks are failing.' });
    expect(by(304)).toMatchObject({ marks: ['MIGRATION'], cannotMerge: 'Its checks are still running.' });
  });

  // protects=only a green pull request that does not touch the release path, workflows or access code is merged, at the commit that was checked; fails_when=a red, running, draft, oversized or release-path pull request reaches GitHub's merge; no_claim=GitHub's branch protection is not exercised
  it('merges a green ordinary pull request and refuses the rest', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    w.github.state.pulls.push({ ...w.github.state.pulls[0], number: 305, draft: true }, { ...w.github.state.pulls[0], number: 306, filesTruncated: true }, { ...w.github.state.pulls[0], number: 307, files: ['.github/workflows/ci.yml'] }, { ...w.github.state.pulls[0], number: 308, files: ['console/api/src/app.ts'] }, { ...w.github.state.pulls[0], number: 309, checks: 'NONE' });
    for (const n of [302, 303, 304, 305, 306, 307, 308, 309]) expect((await w.post(owner.agent, `/pulls/${n}/merge`)).status, `#${n}`).toBe(409);
    expect((await w.post(owner.agent, '/pulls/999/merge')).status).toBe(404);
    expect(w.github.calls).toEqual([]);
    expect((await w.post(owner.agent, '/pulls/301/merge')).status).toBe(200);
    expect(w.github.calls).toEqual([{ what: 'merge', args: [301, 'aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1'] }]);
    expect(w.store.audit.at(-1)).toMatchObject({ action: 'PR_MERGED', target: '#301' });
  });

  // protects=an Engineer can ask for the full tests and close with a reason, each logged; fails_when=the label or the comment differs, or a close goes out with no reason; no_claim=none beyond protects
  it('labels for full tests and closes with a reason', async () => {
    const w = await world();
    const eng = await w.as('ENGINEER');
    expect((await w.post(eng.agent, '/pulls/303/full-tests')).status).toBe(200);
    expect((await w.post(eng.agent, '/pulls/303/close', {})).status).toBe(400);
    expect((await w.post(eng.agent, '/pulls/303/close', { reason: 'Superseded by a newer bump' })).status).toBe(200);
    expect(w.github.calls).toEqual([
      { what: 'addLabel', args: [303, 'full-tests'] },
      { what: 'close', args: [303, 'Closed from the Console by dev-engineer: Superseded by a newer bump'] },
    ]);
    expect(w.store.audit.slice(-2).map((e) => [e.action, e.target])).toEqual([['PR_FULL_TESTS', '#303'], ['PR_CLOSED', '#303']]);
  });
});

describe('members', () => {
  // protects=an owner adds a person by their GitHub account, the numeric id is what is stored, and a reset makes them enrol again; fails_when=an unknown username is added, or a reset member still reads; no_claim=none beyond protects
  it('adds, changes and resets a member, logging each', async () => {
    const w = await world();
    const owner = await w.as('OWNER');
    w.github.state.users['new-dev'] = '2001';
    expect((await w.post(owner.agent, '/members', { githubLogin: 'nobody-here', role: 'VIEWER', reason: 'New joiner' })).status).toBe(404);
    const added = await w.post(owner.agent, '/members', { githubLogin: 'new-dev', role: 'ENGINEER', reason: 'New joiner' });
    expect(added.status).toBe(201);
    expect(added.body.member).toMatchObject({ githubLogin: 'new-dev', role: 'ENGINEER', authenticator: false });
    expect((await w.store.findByGithub('2001'))!.id).toBe(added.body.member.id);

    const eng = await w.as('ENGINEER');
    await w.post(owner.agent, '/step-up', { code: owner.code() });
    expect((await w.patch(owner.agent, `/members/${w.ids.engineer}`, { resetAuthenticator: true, reason: 'Lost phone' })).status).toBe(200);
    expect((await eng.agent.get('/api/pulls')).body.code).toBe('ENROL');
    expect(w.store.audit.filter((e) => e.action.startsWith('MEMBER')).map((e) => [e.action, e.target])).toEqual([['MEMBER_ADDED', 'new-dev'], ['MEMBER_CHANGED', 'dev-engineer']]);
  });
});
