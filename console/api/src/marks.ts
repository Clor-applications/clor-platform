/**
 * What a pull request touches, decided by path (docs/console/CONSOLE-SPEC.md,
 * section 6.3). A pull request marked Workflow, Release or Access cannot be
 * merged from the Console: a change to the release path is not approved by
 * the tool that depends on it.
 */
export type Mark = 'MIGRATION' | 'WORKFLOW' | 'RELEASE' | 'ACCESS' | 'BOOKS';

const RULES: Array<[Mark, RegExp]> = [
  ['MIGRATION', /^server\/prisma\/(.+\/)?migrations\//],
  ['MIGRATION', /^console\/api\/migrations\//],
  ['WORKFLOW', /^\.github\//],
  ['RELEASE', /^(scripts\/(release|migrate)\.sh|deploy\/|cloudbuild[^/]*\.yaml$|console\/api\/Dockerfile$)/],
  ['ACCESS', /^(server\/src\/middleware\/|server\/src\/routes\/auth|console\/api\/)/],
  ['BOOKS', /^apps\/accounting\//],
];

export const NO_CONSOLE_MERGE: Mark[] = ['WORKFLOW', 'RELEASE', 'ACCESS'];

export function marksFor(paths: string[]): Mark[] {
  const found = new Set<Mark>();
  for (const path of paths) for (const [mark, rule] of RULES) if (rule.test(path)) found.add(mark);
  return [...found].sort();
}

export const blocksConsoleMerge = (marks: Mark[]) => marks.some((m) => NO_CONSOLE_MERGE.includes(m));

/** Who wrote it, read from the branch and the author: an agent, Dependabot or a person. */
export function writtenBy(branch: string, authorLogin: string, authorIsBot: boolean): 'AGENT' | 'DEPENDABOT' | 'PERSON' {
  if (/^dependabot\//.test(branch) || /^dependabot/i.test(authorLogin)) return 'DEPENDABOT';
  if (/^claude\//.test(branch) || authorIsBot) return 'AGENT';
  return 'PERSON';
}
