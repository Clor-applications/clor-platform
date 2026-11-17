import React, { useState } from 'react';
import { BookOpen, CircleHelp, Cpu, Keyboard, ListChecks, Mail, MessageCircle } from '@ui/components/ui/lineIcons';
import { requestOpenHelp } from '@platform/context';

import { Menu, MenuItem, MenuLink, MenuPanel, MenuSeparator, MenuTrigger } from '@ui/components/ui/Menu';
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
  const [open, setOpen] = useState(false);
  const whatsapp = digits(operator.supportWhatsapp);
  const email = operator.contactEmail;
  return (
    <Menu open={open} onOpenChange={setOpen}>
      {variant === 'rail' ? (
        <MenuTrigger className="ui-split-mod" aria-label="Help and support" title="Help and support">
          {Icon ? <Icon size={20} aria-hidden="true" /> : <CircleHelp size={20} aria-hidden="true" />}
          <span>Help</span>
        </MenuTrigger>
      ) : (
        <MenuTrigger className="ui-icon-btn" aria-label="Help and contact" title="Help and contact">
          <CircleHelp size={16} aria-hidden="true" />
        </MenuTrigger>
      )}
      {/* From the rail's foot it opens beside the rail, not over it; from the bar it hangs under its button. */}
      <MenuPanel aria-label="Help and contact" minWidth={248} zIndex="var(--z-platform-menu)" side={variant === 'rail' ? 'right' : 'bottom'} align="end">
        <MenuItem onClick={() => requestOpenHelp('welcome')}>
          <BookOpen size={16} aria-hidden="true" /> Help centre
        </MenuItem>
        <MenuItem onClick={() => requestOpenHelp('setup')}>
          <ListChecks size={16} aria-hidden="true" /> Set up your workspace
        </MenuItem>
        <MenuItem onClick={() => requestOpenHelp('readers')}>
          <Cpu size={16} aria-hidden="true" /> Integration guides
        </MenuItem>
        <MenuItem disabled>
          <Keyboard size={16} aria-hidden="true" /> Search anywhere
          <kbd className="ui-menu-kbd ml-auto text-xs">{/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl K'}</kbd>
        </MenuItem>
        {whatsapp || email ? <MenuSeparator /> : null}
        {whatsapp ? (
          <MenuLink href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener">
            <MessageCircle size={16} aria-hidden="true" /> WhatsApp us
          </MenuLink>
        ) : null}
        {email ? (
          <MenuLink href={`mailto:${email}`}>
            <Mail size={16} aria-hidden="true" /> {email}
          </MenuLink>
        ) : null}
      </MenuPanel>
    </Menu>
  );
}
