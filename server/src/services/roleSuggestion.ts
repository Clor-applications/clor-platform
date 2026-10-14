/**
 * Suggesting a role for somebody from what they do.
 *
 * An administrator inviting a person types a job title and a line about the
 * work; TypeSafe's System One model (Jev) picks the closest of the roles the
 * administrator may hand out, or says none fits. It is one Choice question:
 * the role descriptions are the criteria, and the answer is a typed pick with
 * a probability for every role, not generated text.
 *
 * What leaves the server: the title and duties the administrator typed, and
 * the names and descriptions of the candidate roles. No company data, no
 * documents, no figures.
 *
 * What it may not do: assign anything. The answer pre-fills a dropdown the
 * administrator still confirms, and assignment goes through the same grant
 * checks as any other. Off unless TYPESAFE_API_KEY is set.
 *
 * API contract: https://docs.typesafe.ai/api.md
 */

const ENDPOINT = process.env.TYPESAFE_API_URL || 'https://api.typesafe.ai/v1/systemone';
const MODEL = process.env.TYPESAFE_MODEL || 'jev-latest';
const TIMEOUT_MS = Number(process.env.TYPESAFE_TIMEOUT_MS || 6000);

/** The option meaning "none of these roles fits". Not a role id, so it cannot collide. */
export const NO_FIT = '__none__';

export const roleSuggestionEnabled = () => Boolean(String(process.env.TYPESAFE_API_KEY || '').trim());

export type Candidate = { id: string; name: string; description: string | null };

export type Suggestion = {
  /** A role id, or NO_FIT. */
  choice: string;
  /** How concentrated the model's probability is on that answer, 0..1. */
  confidence: number;
  /** Highest-probability roles first, NO_FIT excluded. */
  ranked: Array<{ id: string; probability: number }>;
};

export class SuggestionError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function suggestRole(input: { jobTitle: string; duties: string }, candidates: Candidate[]): Promise<Suggestion> {
  if (!roleSuggestionEnabled()) throw new SuggestionError('Role suggestions are not switched on', 503);
  if (!candidates.length) throw new SuggestionError('There are no roles you may hand out', 409);

  const criteria: Record<string, string> = {};
  for (const c of candidates) {
    criteria[c.id] = c.description ? `${c.name}: ${c.description}` : c.name;
  }
  criteria[NO_FIT] = 'None of these roles fits this person; the administrator should build a custom role.';

  const body = {
    model: MODEL,
    state: { job_title: input.jobTitle, what_they_do: input.duties || '' },
    questions: {
      role: {
        type: 'choice',
        instructions:
          'An administrator of an Indian GST accounting product is giving access to a new person, described by `job_title` and `what_they_do`. ' +
          'Which one of these roles gives that person the access their work needs, without giving them much more than it needs?',
        criteria,
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new SuggestionError('The suggestion service did not answer. Pick a role yourself.', 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 401: bad key; 429/529: busy. None of it is the administrator's problem to decode.
    throw new SuggestionError('The suggestion service is unavailable right now. Pick a role yourself.', 502);
  }

  const data: any = await res.json().catch(() => null);
  const answer = data?.answers?.role;
  const choice = String(answer?.choice || '');
  if (!choice || !(choice in criteria)) {
    throw new SuggestionError('The suggestion service gave an answer that is not one of your roles.', 502);
  }

  const probabilities: Record<string, number> = answer?.probabilities || {};
  const ranked = Object.entries(probabilities)
    .filter(([id]) => id !== NO_FIT && id in criteria)
    .map(([id, probability]) => ({ id, probability: Number(probability) || 0 }))
    .sort((a, b) => b.probability - a.probability);

  return { choice, confidence: Number(answer?.confidence) || 0, ranked };
}
