import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { PageHeader } from '../components/ui/Primitives';
import { SETTINGS_ACTIONS_SLOT_ID, SettingsFrameContext } from './settingsFrame';

/**
 * A settings screen's header, printed once wherever the screen is standing.
 *
 * `SettingsWorkspace` prints the title and description of every screen it
 * frames — it reads both from the settings registry, so the breadcrumb, the
 * local navigation and the heading always agree. Ten screens printed a
 * `PageHeader` underneath it as well, so each showed its title twice and put
 * two `<h1>` elements on one page: a visible duplicate for everyone, and for a
 * screen reader two competing answers to "what is this page?".
 *
 * Simply deleting those headers was wrong twice over. It would have deleted the
 * controls that travelled with them — Save, Back, "Unsaved changes", the
 * saved-just-now pill — and not every settings screen is framed: a key the
 * registry does not list (document numbering is one) renders on its own, where
 * that header was the only heading it had.
 *
 * So the screen keeps saying what it is, and this decides what to draw:
 * unframed, the whole header, exactly as before; framed, the title gives way to
 * the frame's and the actions are hoisted into the slot beside it, landing
 * where the old header put them.
 *
 * Framed-ness comes from context, not from looking for the slot, because on the
 * first render the frame and the screen mount in the same commit and the slot is
 * not in the document yet: asking the DOM would say "unframed" for one frame and
 * paint a second heading before removing it. The portal target is a node this
 * component creates once, so it exists on the very first render and never has to
 * be discovered.
 */

export default function SettingsScreenHeader({ title, description = '', actions = null, entity = '' }) {
  const framed = useContext(SettingsFrameContext);
  /* Created once, so there is never a pass where the portal has nowhere to go.
     `display: contents` keeps the buttons direct participants in the heading
     row's flex layout, so they wrap and space as they did inside the header. */
  const [holder] = useState(() => {
    if (typeof document === 'undefined') return null;
    const el = document.createElement('div');
    el.style.display = 'contents';
    return el;
  });

  useEffect(() => {
    if (!framed || !holder) return undefined;
    /* Everything in this commit is in the document by the time effects run,
       so the slot is here — it is an ancestor of this component. */
    document.getElementById(SETTINGS_ACTIONS_SLOT_ID)?.appendChild(holder);
    return () => holder.remove();
  }, [framed, holder]);

  if (!framed) {
    return <PageHeader title={title} description={description} actions={actions} entity={entity} />;
  }
  if (!actions) return null;
  return holder ? createPortal(actions, holder) : null;
}
