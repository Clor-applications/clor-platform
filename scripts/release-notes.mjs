#!/usr/bin/env node
/**
 * The release record: what went out in a release, written into CHANGELOG.md.
 *
 * scripts/release.sh calls this at the end of a release. It reads git only
 * (no cloud, no network): the pull requests merged into main since the
 * previous `rel-` tag, by title.
 *
 *   node scripts/release-notes.mjs --tag rel-3722b5f                  # print the entry
 *   node scripts/release-notes.mjs --tag rel-3722b5f --write          # put it in CHANGELOG.md
 *     [--previous rel-1ef7878]   the release before (default: the newest rel- tag behind HEAD)
 *     [--revision clor-api-00122-fw2] [--web <url>] [--site <url>] [--date 2026-11-12]
 *
 * With no earlier rel- tag and no --previous there is nothing to count from,
 * so the entry lists the last 20 merged pull requests and says so.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Pull-request titles from `git log --first-parent --pretty=%s%x1f%b%x1e`,
 * newest first. A merge commit carries the title as the first line of its
 * body; a squash merge carries it as the subject with "(#123)" at the end.
 * Commits pushed straight to main with neither are left out: this is a list
 * of pull requests.
 */
export function prTitles(log) {
  const out = [];
  for (const record of String(log || '').split('\x1e')) {
    const [subjectRaw, bodyRaw = ''] = record.split('\x1f');
    const subject = String(subjectRaw || '').trim();
    if (!subject) continue;
    const merge = /^Merge pull request #(\d+)\b/.exec(subject);
    if (merge) {
      const title = bodyRaw.split('\n').map((l) => l.trim()).find(Boolean);
      out.push({ number: Number(merge[1]), title: title || subject });
      continue;
    }
    const squash = /^(.*\S)\s+\(#(\d+)\)$/.exec(subject);
    if (squash) out.push({ number: Number(squash[2]), title: squash[1] });
  }
  /* One line per pull request, however it shows up in the log. */
  return out.filter((p, i) => out.findIndex((q) => q.number === p.number) === i);
}

/** One release as a CHANGELOG section. */
export function entryFor({ tag, date, previous, revision, web, site, pulls, counted = true }) {
  const lines = [`## ${tag} - ${date}`, ''];
  const facts = [
    revision ? `API revision \`${revision}\`.` : null,
    previous ? `Previous release \`${previous}\` (roll back there).` : 'First recorded release.',
    web ? `Web app ${web}.` : null,
    site ? `Website ${site}.` : null,
  ].filter(Boolean);
  lines.push(facts.join(' '), '');
  if (!counted) lines.push('No earlier `rel-` tag to count from: these are the last pull requests merged before this release.', '');
  if (pulls.length) for (const p of pulls) lines.push(`- #${p.number} ${p.title}`);
  else lines.push('- No pull requests merged since the previous release.');
  return `${lines.join('\n')}\n`;
}

/**
 * The changelog with the entry added: newest first, so it goes above the
 * first existing section and below the file's opening lines. An entry for
 * the same tag replaces the one already there (a release run a second time
 * after it stopped part-way does not leave two).
 */
export function withEntry(changelog, entry, tag) {
  let text = String(changelog || '# Changelog\n');
  const heading = `## ${tag} - `;
  const from = text.indexOf(heading);
  if (from !== -1) {
    const next = text.indexOf('\n## ', from + heading.length);
    text = text.slice(0, from) + (next === -1 ? '' : text.slice(next + 1));
  }
  const first = text.search(/^## /m);
  if (first === -1) return `${text.replace(/\s*$/, '')}\n\n${entry}`;
  return `${text.slice(0, first)}${entry}\n${text.slice(first)}`;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** The newest rel- tag reachable from HEAD, other than this release's own. */
export function previousTag(tag, run = git) {
  const tags = run('tag', '--list', 'rel-*', '--merged', 'HEAD', '--sort=-creatordate').split('\n').map((t) => t.trim()).filter(Boolean);
  return tags.find((t) => t !== tag) || null;
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? null : argv[i + 1] || null;
  };
  const tag = arg('tag');
  if (!tag || !/^rel-[0-9a-f]{7,40}$/.test(tag)) {
    console.error('Give the release tag: --tag rel-<sha7>');
    process.exit(2);
  }
  const previous = arg('previous') || previousTag(tag);
  const format = '--pretty=%s%x1f%b%x1e';
  const log = previous ? git('log', '--first-parent', format, `${previous}..HEAD`) : git('log', '--first-parent', '-n', '60', format, 'HEAD');
  const pulls = previous ? prTitles(log) : prTitles(log).slice(0, 20);
  const date = arg('date') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const entry = entryFor({ tag, date, previous, revision: arg('revision'), web: arg('web'), site: arg('site'), pulls, counted: Boolean(previous) });
  if (!argv.includes('--write')) {
    process.stdout.write(entry);
    return;
  }
  const file = new URL('../CHANGELOG.md', import.meta.url);
  let before = '';
  try {
    before = readFileSync(file, 'utf8');
  } catch {
    before = '';
  }
  writeFileSync(file, withEntry(before, entry, tag));
  console.log(`CHANGELOG.md: ${tag}, ${pulls.length} pull request${pulls.length === 1 ? '' : 's'}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
