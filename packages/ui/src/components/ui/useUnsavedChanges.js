import { useEffect, useId } from 'react';

import { markUnsaved } from '@platform/unsaved';

/**
 * Tell the shell (and the browser) this screen holds edits that are not
 * saved. While `isDirty`, leaving by the sidebar, a link, Back, another app
 * or another company asks first, and closing the tab warns.
 */
export default function useUnsavedChanges(isDirty) {
  const id = useId();
  useEffect(() => {
    markUnsaved(id, Boolean(isDirty));
    if (!isDirty) return () => markUnsaved(id, false);
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      markUnsaved(id, false);
    };
  }, [id, isDirty]);
}
