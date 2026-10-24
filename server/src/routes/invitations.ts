import { Router } from 'express';
import type { Response } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { signupLimiter } from '../middleware/rateLimit.js';
import { InvitationError, acceptInvitation, previewInvitation } from '../services/accountInvitations.js';

/**
 * Workspace W-3: the invited person's side of an invitation. Reached from the
 * email link, before they belong to any company of the account, so these are
 * not company-scoped. The token is the only key; its hash is what is stored.
 */
export const invitationsRouter = Router();

const fail = (res: Response, e: unknown) => {
  if (e instanceof InvitationError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

/** Who invited them, to which account and companies, and whether they already have a login. */
invitationsRouter.post('/invitations/preview', async (req, res) => {
  try {
    res.json(await previewInvitation(String(req.body?.token || '')));
  } catch (e) {
    fail(res, e);
  }
});

/** Accept with a new login: no Clor login exists for the invited address yet. */
invitationsRouter.post('/invitations/accept', ...signupLimiter, async (req, res) => {
  try {
    res.json(await acceptInvitation({ token: req.body?.token, fullName: req.body?.fullName, password: req.body?.password, signedInUserId: null }));
  } catch (e) {
    fail(res, e);
  }
});

/** Accept while signed in with the invited address. */
invitationsRouter.post('/invitations/accept-signed-in', requireAuth, async (req, res) => {
  try {
    res.json(await acceptInvitation({ token: req.body?.token, signedInUserId: req.auth!.userId }));
  } catch (e) {
    fail(res, e);
  }
});
