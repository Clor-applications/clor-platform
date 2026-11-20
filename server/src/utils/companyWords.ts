import type { Response } from 'express';

/**
 * The company and session refusals every route shares, in one place (UX copy audit, 20 Nov 2026).
 *
 * They used to read "orgId mismatch", "No access to org", "Missing x-org-id" and "Invalid/expired token":
 * the program's own words. A person sees these when a tab is still on another company, or after their
 * sign-in has lapsed, so each says what happened and what to do.
 */

/** The address names one company and the screen has another open (an old tab, a pasted link). */
export const OTHER_COMPANY_TEXT = 'This is a different company from the one you have open. Switch company and try again.';
/** The person has no place in the company the request names. */
export const NO_COMPANY_ACCESS_TEXT = 'You do not have access to this company. Ask its owner or administrator to add you.';
export const NO_BRANCH_ACCESS_TEXT = 'You do not have access to this branch. Ask an administrator of this company to add you to it.';
export const NO_WAREHOUSE_ACCESS_TEXT = 'You do not have access to this warehouse. Ask an administrator of this company to add you to it.';
/** The request names no company, branch or warehouse: the screen was opened before one was chosen. */
export const CHOOSE_COMPANY_TEXT = 'Choose a company first, then try again.';
export const CHOOSE_BRANCH_TEXT = 'Choose a branch first, then try again.';
export const CHOOSE_WAREHOUSE_TEXT = 'Choose a warehouse first, then try again.';
/** Every flavour of a sign-in that is missing, unreadable, expired or ended. */
export const SIGNED_OUT_TEXT = 'You have been signed out. Sign in again.';
/** The person's own sign-in was switched off. */
export const SIGN_IN_OFF_TEXT = 'Your sign-in has been switched off. Ask an owner or administrator of your account.';

/** 403 for a request whose company is not the one open. */
export const otherCompany = (res: Response) => res.status(403).json({ error: OTHER_COMPANY_TEXT });
/** The person's roles here do not include what the request needs. */
export const ROLE_DOES_NOT_ALLOW_TEXT = 'Your role does not allow this. Ask an administrator of this company to change your role.';
/** The person is in the company but holds no role in it yet. */
export const NO_ROLE_TEXT = 'You have no role in this company yet. Ask an administrator of this company to give you one.';
