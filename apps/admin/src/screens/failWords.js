import { rbacErrorMessage } from '@ui/permissions/rbacErrors';
import { errorWords } from '@ui/utils/errorWords';

/**
 * The sentence for a failed role or user change: the role rules' own next step when the server
 * names one (last administrator, permissions you do not hold…), otherwise errorWords.
 * `what` follows "Could not": "add the user", "save the role".
 */
export function failWords(err, what) {
  if (err?.data?.code) {
    const mapped = rbacErrorMessage(err, '');
    if (mapped && mapped !== String(err?.message || '')) return mapped;
  }
  return errorWords(err, what);
}
