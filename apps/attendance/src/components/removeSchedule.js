import { confirmDialog } from '@ui/components/ui/notify';
import { dateWords } from '@ui/utils/dates';

/**
 * Removing a schedule asks first, naming who, which shift and from when
 * ("Remove Asha Rao from Night shift from 9 Dec 2026?"), because the days it
 * covered go back to whatever schedule applies next.
 */
export const confirmRemoveSchedule = ({ name, shift, from, message }) =>
  confirmDialog({
    title: `Remove ${name} from ${shift || 'this shift'}${from ? ` from ${dateWords(from)}` : ''}?`,
    message: message || 'Those days go back to the next schedule that applies: a rotation, the department’s shift or the company default.',
    confirmLabel: 'Remove schedule',
  });

export default confirmRemoveSchedule;
