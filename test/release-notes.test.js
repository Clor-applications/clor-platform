// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { entryFor, prTitles, previousTag, withEntry } from '../scripts/release-notes.mjs';

/**
 * The release record (scripts/release.sh, scripts/release-notes.mjs): each
 * release adds a section to CHANGELOG.md listing the pull requests merged
 * since the release before, so "what is live" has an answer in the repo.
 */
const rec = (subject, body = '') => `${subject}\x1f${body}\x1e`;

describe('pull-request titles from the log', () => {
  it('reads a merge commit’s title from its body and a squash merge’s from its subject', () => {
    const log =
      rec('Merge pull request #221 from Clor-applications/claude/trial-and-approvals', 'Audit stage 1: trial emails, approval emails\n\nMore words.') +
      '\n' +
      rec('Ops: nightly database copy to Delhi (#216)', 'Co-Authored-By: someone') +
      '\n' +
      rec('Fix a typo pushed straight to main') +
      '\n' +
      rec('Merge pull request #218 from Clor-applications/claude/audit-stage0', '\n\nAudit stage 0: timed jobs');
    expect(prTitles(log)).toEqual([
      { number: 221, title: 'Audit stage 1: trial emails, approval emails' },
      { number: 216, title: 'Ops: nightly database copy to Delhi' },
      { number: 218, title: 'Audit stage 0: timed jobs' },
    ]);
  });

  it('lists a pull request once, and copes with an empty log and a merge with no body', () => {
    expect(prTitles('')).toEqual([]);
    expect(prTitles(rec('Merge pull request #7 from x/y') + rec('Again (#7)'))).toEqual([{ number: 7, title: 'Merge pull request #7 from x/y' }]);
  });
});

describe('the changelog entry', () => {
  const pulls = [{ number: 221, title: 'Audit stage 1' }, { number: 218, title: 'Audit stage 0' }];

  it('names the release, the revision and where to roll back to, then the pull requests', () => {
    expect(entryFor({ tag: 'rel-3722b5f', date: '2026-11-12', previous: 'rel-1ef7878', revision: 'clor-api-00122-fw2', pulls })).toBe(
      '## rel-3722b5f - 2026-11-12\n\nAPI revision `clor-api-00122-fw2`. Previous release `rel-1ef7878` (roll back there).\n\n- #221 Audit stage 1\n- #218 Audit stage 0\n',
    );
  });

  it('says so when there was no earlier release to count from, and when nothing was merged', () => {
    const first = entryFor({ tag: 'rel-aaaaaaa', date: '2026-11-12', previous: null, pulls, counted: false });
    expect(first).toMatch(/First recorded release\./);
    expect(first).toMatch(/No earlier `rel-` tag to count from/);
    expect(entryFor({ tag: 'rel-bbbbbbb', date: '2026-11-13', previous: 'rel-aaaaaaa', pulls: [] })).toMatch(/- No pull requests merged since the previous release\./);
  });

  it('goes above the newest section, keeps what was there, and replaces itself if the release is run again', () => {
    const before = '# Changelog\n\nAll notable changes.\n\n## [0.0.1] - 2026-11-06\n\n### Changed\n- Brand\n';
    const one = withEntry(before, entryFor({ tag: 'rel-aaaaaaa', date: '2026-11-12', previous: null, pulls }), 'rel-aaaaaaa');
    expect(one.indexOf('## rel-aaaaaaa')).toBeLessThan(one.indexOf('## [0.0.1]'));
    expect(one.startsWith('# Changelog\n\nAll notable changes.\n\n## rel-aaaaaaa - 2026-11-12\n')).toBe(true);
    expect(one.endsWith('## [0.0.1] - 2026-11-06\n\n### Changed\n- Brand\n')).toBe(true);

    const two = withEntry(one, entryFor({ tag: 'rel-bbbbbbb', date: '2026-11-13', previous: 'rel-aaaaaaa', pulls: [] }), 'rel-bbbbbbb');
    expect(two.indexOf('## rel-bbbbbbb')).toBeLessThan(two.indexOf('## rel-aaaaaaa'));

    const again = withEntry(two, entryFor({ tag: 'rel-bbbbbbb', date: '2026-11-13', previous: 'rel-aaaaaaa', revision: 'clor-api-00123-abc', pulls: [] }), 'rel-bbbbbbb');
    expect(again.match(/## rel-bbbbbbb/g)).toHaveLength(1);
    expect(again).toMatch(/clor-api-00123-abc/);
    expect(again.match(/## rel-aaaaaaa/g)).toHaveLength(1);
    expect(again).toMatch(/## \[0\.0\.1\]/);
  });

  it('starts a changelog when there is none', () => {
    expect(withEntry('', '## rel-aaaaaaa - 2026-11-12\n', 'rel-aaaaaaa')).toBe('# Changelog\n\n## rel-aaaaaaa - 2026-11-12\n');
  });
});

describe('the release before', () => {
  it('is the newest rel- tag behind HEAD that is not this release’s own', () => {
    const tags = () => 'rel-ccccccc\nrel-bbbbbbb\nrel-aaaaaaa\n';
    expect(previousTag('rel-ccccccc', tags)).toBe('rel-bbbbbbb');
    expect(previousTag('rel-ddddddd', tags)).toBe('rel-ccccccc');
    expect(previousTag('rel-ddddddd', () => '')).toBeNull();
  });
});

describe('scripts/release.sh', () => {
  const sh = readFileSync(new URL('../scripts/release.sh', import.meta.url), 'utf8');

  it('does nothing but print unless told to: every command that changes anything goes through run()', () => {
    /* A gcloud, wrangler, npm, curl or git-tag call outside run()/read() would execute in a dry run. */
    const bare = sh
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^(gcloud|npx|npm|curl|wrangler|git (tag|push|commit))\b/.test(l));
    expect(bare).toEqual([]);
    expect(sh).toMatch(/MODE=dry/);
  });

  it('uses the commands in use today, and never sends traffic before the ready check', () => {
    expect(sh).toContain('sql backups create --instance "$SQL_INSTANCE" --project "$PROJECT"');
    expect(sh).toContain('--config cloudbuild.cloudrun.yaml');
    expect(sh).toContain('--no-traffic --quiet');
    expect(sh).toContain('pages deploy dist --project-name clor-app --branch main');
    expect(sh).toContain('pages deploy dist --project-name clor --branch main');
    expect(sh.indexOf('/ready')).toBeGreaterThan(-1);
    expect(sh.indexOf('--to-tags')).toBeGreaterThan(sh.indexOf('ready_check'));
  });
});
