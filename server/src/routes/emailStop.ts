import { Router, urlencoded } from 'express';
import { z } from 'zod';

import { TEMPLATE_BY_KEY } from '../constants/emailTemplates.js';
import { check, text } from '../middleware/validate.js';
import { readEmailStopToken, setEmailStopped } from '../services/emailStop.js';
import { escapeHtml as esc } from '../utils/html.js';

/**
 * The "Stop these emails" link at the foot of an optional email (round 55
 * pick). No sign-in: the signed token names one address and one kind.
 * Opening the link changes nothing (mail scanners open links too): the page
 * names the kind and has a Stop button; only that POST stops them, and the
 * page after offers to start them again.
 */
export const emailStopRouter = Router();

const TOKEN_PARAMS = z.object({ token: text(4000) });
const ACTION = z.object({ action: z.enum(['stop', 'start']).optional() }).strict();

const page = (title: string, body: string, form = '') =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>` +
  `<body style="font-family:Figtree,system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#18181b;background:#fff">` +
  `<h1 style="font-size:1.25rem">${esc(title)}</h1><p style="color:#52525b">${body}</p>${form}</body>`;
const button = (label: string, action: 'stop' | 'start') =>
  `<form method="post"><input type="hidden" name="action" value="${action}"><button type="submit" style="font:inherit;padding:.6rem 1.1rem;border-radius:8px;border:0;background:#18181b;color:#fff;cursor:pointer">${esc(label)}</button></form>`;
/** What the kind is called, in the words Workspace's email settings use. */
const kindName = (key: string) => TEMPLATE_BY_KEY.get(key)?.label || 'these emails';
const BAD = page('This link does not work', 'It may be too old. Ask your company’s administrator, or reply to the email.');

emailStopRouter.get('/public/email/stop/:token', check({ params: TOKEN_PARAMS }), (req, res) => {
  const claims = readEmailStopToken(String(req.params.token || ''));
  if (!claims) return res.status(400).type('html').send(BAD);
  res.type('html').send(page('Stop these emails?', `<strong>${esc(kindName(claims.templateKey))}</strong> will no longer be sent to ${esc(claims.email)}. Other emails still come.`, button('Stop these emails', 'stop')));
});

emailStopRouter.post('/public/email/stop/:token', urlencoded({ extended: false, limit: '1kb' }), check({ params: TOKEN_PARAMS, body: ACTION }), async (req, res) => {
  const claims = readEmailStopToken(String(req.params.token || ''));
  if (!claims) return res.status(400).type('html').send(BAD);
  const start = req.body?.action === 'start';
  await setEmailStopped(claims.email, claims.templateKey, !start);
  if (start) return res.type('html').send(page('Started again', `<strong>${esc(kindName(claims.templateKey))}</strong> will be sent to ${esc(claims.email)} again.`));
  res.type('html').send(page('Stopped', `<strong>${esc(kindName(claims.templateKey))}</strong> will no longer be sent to ${esc(claims.email)}.`, button('Start them again', 'start')));
});
