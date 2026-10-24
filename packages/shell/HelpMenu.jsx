import React, { useRef, useState } from 'react';
import { BookOpen, CircleHelp, Cpu, Keyboard, ListChecks, Mail, MessageCircle } from 'lucide-react';
import { requestOpenHelp } from '@platform/context';

import Popover from '@ui/components/ui/Popover';
import { operator } from '@platform/operator';

/**
 * Help and contact, from the bar every app shares.
 *
 * Until now the product had no way to reach anyone: a pilot company stuck on
 * a reader at 9 a.m. had nowhere to click. The guides are always here; the
 * email and WhatsApp rows appear once the operator has set them
 * (VITE_CONTACT_EMAIL, VITE_SUPPORT_WHATSAPP), so nothing is shown that
 * nobody answers.
 */
const digits = (s) => String(s || '').replace(/\D/g, '');

/**
 * `variant="rail"` draws it as a rail item (icon over a label) at the foot of
 * a split rail; `icon` lets the app give it its own icon set.
 */
export default function HelpMenu({ variant = 'bar', icon: Icon = null }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const whatsapp = digits(operator.supportWhatsapp);
  const email = operator.contactEmail;
  const row = 'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm ui-hover-sunken';
  return (
    <>
      {variant === 'rail' ? (
        <button type="button" ref={ref} className="ui-split-mod" aria-label="Help and support" title="Help and support" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {Icon ? <Icon size={20} aria-hidden="true" /> : <CircleHelp size={20} aria-hidden="true" />}
          <span>Help</span>
        </button>
      ) : (
        <button type="button" ref={ref} className="ui-icon-btn" aria-label="Help and contact" title="Help and contact" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <CircleHelp size={16} aria-hidden="true" />
        </button>
      )}
      {open ? (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} minWidth={248}>
          <div className="py-1" role="menu" aria-label="Help and contact">
            <button type="button" role="menuitem" className={row} onClick={() => { setOpen(false); requestOpenHelp('welcome'); }}>
              <BookOpen size={16} aria-hidden="true" /> Help centre
            </button>
            <button type="button" role="menuitem" className={row} onClick={() => { setOpen(false); requestOpenHelp('setup'); }}>
              <ListChecks size={16} aria-hidden="true" /> Set up your workspace
            </button>
            <button type="button" role="menuitem" className={row} onClick={() => { setOpen(false); requestOpenHelp('readers'); }}>
              <Cpu size={16} aria-hidden="true" /> Integration guides
            </button>
            <div role="menuitem" aria-disabled="true" className={`${row} ui-muted`} style={{ cursor: 'default' }}>
              <Keyboard size={16} aria-hidden="true" /> Search anywhere
              <kbd className="ml-auto text-xs">{/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K'}</kbd>
            </div>
            {whatsapp || email ? <div className="my-1" style={{ borderTop: '1px solid rgb(var(--border))' }} /> : null}
            {whatsapp ? (
              <a role="menuitem" className={row} href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener">
                <MessageCircle size={16} aria-hidden="true" /> WhatsApp us
              </a>
            ) : null}
            {email ? (
              <a role="menuitem" className={row} href={`mailto:${email}`}>
                <Mail size={16} aria-hidden="true" /> {email}
              </a>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </>
  );
}
