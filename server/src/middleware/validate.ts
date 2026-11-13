import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

/**
 * Schemas at the edge of a route (platform audit, 11 Nov 2026: route files that read req.body, req.query and
 * req.params as they came). `check({ body, query, params })` goes in front of a handler:
 *
 *   router.post('/thing/:id', check({ params: idParams, body: z.object({ note: text(500).nullish() }) }), handler)
 *
 * What it does, and no more:
 *  - refuses a value of the wrong kind, too long, out of range or not in the form asked for, with a 400 and a
 *    plain sentence, before the handler runs;
 *  - drops keys the schema does not name (z.object strips), so an older phone app that sends more keeps working;
 *  - hands the handler the parsed body and query (trimmed strings, numbers as numbers).
 *
 * What it leaves alone: whether a field is required, and every message a handler already gives. Fields are
 * optional here unless the handler never checked them; "Say what you are asking for." still comes from the
 * handler. Where a handler already has its own words for a malformed value ("date must be YYYY-MM-DD."), the
 * schema is given the same words, and they are sent as they are. Any other refusal reads
 * `Validation error: "field" …`, the same opening as a ZodError through middleware/errors.ts.
 *
 * A body that goes whole into a service with its own schema (leave, attendance requests, a tax declaration) is
 * checked here only for being an object (`anyBody`): the service's schema names its fields and has its messages.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A trimmed string of at most `max` characters. */
export const text = (max: number) => z.string().trim().max(max);
/** As it was typed (a password is never trimmed), at most `max` characters. */
export const rawText = (max: number) => z.string().max(max);
/** A record's id, or a short code that names one: not empty, at most 80 characters. */
export const id = z.string().trim().min(1).max(80);
/** A code a person types (company code, employee code): a number is taken as its digits. */
export const code = (max = 80) => z.union([z.string(), z.number()]).transform((v) => String(v)).pipe(z.string().trim().max(max));
/** A calendar day, YYYY-MM-DD. `words` are the handler's own for a day that is not one. */
export const ymd = (words?: string) => z.string().trim().regex(YMD, words);
/** A month, YYYY-MM. */
export const ym = (words?: string) => z.string().trim().regex(YM, words);
/** A time of day, HH:MM. */
export const hm = (words?: string) => z.string().trim().regex(HM, words);
/** A number between two bounds. */
export const num = (min: number, max: number) => z.number().min(min).max(max);
export const int = (min: number, max: number) => z.number().int().min(min).max(max);
export const flag = z.boolean();
/** A list of at most `max` entries. */
export const list = <T extends z.ZodType>(of: T, max: number) => z.array(of).max(max);
/** A list of ids. */
export const ids = (max = 500) => list(id, max);

/** An empty answer in a query string or a form ("?month=", `kind: ""`) is no answer. */
const blank = (v: unknown) => (v === '' ? undefined : v);
/** For a query string: "" is left out, and the rest must match. */
export const q = <T extends z.ZodType>(schema: T) => z.preprocess(blank, schema.optional());
/** A whole number in a query string ("?year=2026"). */
export const qInt = (min: number, max: number) => q(z.coerce.number().int().min(min).max(max));
/** A switch in a query string: 1, true, yes, 0, false, no. */
export const qFlag = q(z.enum(['1', '0', 'true', 'false', 'yes', 'no']));
/** An optional choice where "" and null mean "not said". */
export const choice = <const T extends readonly [string, ...string[]]>(values: T, words?: string) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(values, words).optional());

/** `/:id` */
export const idParams = z.object({ id });
/** A body that a service's own schema reads: an object, whatever is in it. */
export const anyBody = z.looseObject({});
/** A route that takes nothing in its body. */
export const noBody = z.object({});
/** Free-form JSON a handler stores as it is (a form's answers): an object of at most `max` keys. */
export const jsonObject = (max = 200) => z.record(z.string().max(200), z.unknown()).refine((o) => Object.keys(o).length <= max);

const GENERIC = '\u0000';

/** A plain sentence for an issue no schema gave its own words to. */
function words(issue: z.core.$ZodIssue): string {
  const field = issue.path.length ? `"${issue.path.join('.')}" ` : 'The request ';
  const origin = (issue as any).origin as string | undefined;
  switch (issue.code) {
    case 'invalid_type':
      return `${field}is not the kind of value expected${(issue as any).expected ? ` (${(issue as any).expected})` : ''}.`;
    case 'too_big':
      return `${field}${origin === 'string' ? 'is too long' : origin === 'array' || origin === 'set' ? 'has too many entries' : 'is too large'}.`;
    case 'too_small':
      return `${field}${origin === 'string' ? 'is empty or too short' : origin === 'array' || origin === 'set' ? 'has too few entries' : 'is too small'}.`;
    case 'invalid_format':
      return `${field}is not in the form expected.`;
    case 'invalid_value':
      return `${field}is not one of the choices.`;
    default:
      return `${field}is not valid.`;
  }
}

/** The 400 a failed check answers with: the schema's own words, or `Validation error: …`. */
export function refusal(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Validation error';
  return first.message.startsWith(GENERIC) ? `Validation error: ${words(first)}` : first.message;
}

/** Parse one value; `{ ok: false, error }` carries the sentence for the 400. */
export function parseEdge<T extends z.ZodType>(schema: T, value: unknown): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const parsed = schema.safeParse(value, { error: () => GENERIC });
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: refusal(parsed.error) };
}

type Shape = { body?: z.ZodType; query?: z.ZodType; params?: z.ZodType };

export function check(shape: Shape) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (shape.params) {
      const p = parseEdge(shape.params, req.params);
      if (!p.ok) return res.status(400).json({ error: p.error });
    }
    if (shape.query) {
      const p = parseEdge(shape.query, req.query);
      if (!p.ok) return res.status(400).json({ error: p.error });
      req.query = p.data as any;
    }
    if (shape.body) {
      /* No body at all (a POST that only names a record) reads as an empty one. */
      const p = parseEdge(shape.body, req.body === undefined || req.body === null ? {} : req.body);
      if (!p.ok) return res.status(400).json({ error: p.error });
      req.body = p.data;
    }
    next();
  };
}
