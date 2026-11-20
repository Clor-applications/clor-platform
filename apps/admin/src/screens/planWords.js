import { subscriptionSentence, subscriptionWord } from '@ui/utils/errorWords';

/* Workspace calls it the plan (owner, 20 Nov 2026), so the shared sentences say "plan" here. */
export const planSentence = (status) => subscriptionSentence(status).replace(/\bsubscription\b/gi, 'plan').replace(/Your CLOR plan/g, 'Your plan');
export const planWord = (status) => subscriptionWord(status);
