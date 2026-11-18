import React from 'react';
import { MessageCircle, Phone } from 'lucide-react';
import { formatPhone } from '../../utils/phone';

/**
 * Call and WhatsApp a colleague in one tap (owner's round 30 pick: buttons on
 * their card). Only an Indian ten-digit mobile gets a WhatsApp button, since
 * wa.me needs the full number with the country code; any other number still
 * gets Call.
 */
export function phoneLinks(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 6) return null;
  let mobile = null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) mobile = `91${digits}`;
  else if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) mobile = digits;
  return {
    tel: `tel:${mobile ? `+${mobile}` : raw.replace(/[^\d+]/g, '')}`,
    wa: mobile ? `https://wa.me/${mobile}` : null,
  };
}

export default function CallButtons({ phone, name = '' }) {
  const links = phoneLinks(phone);
  if (!links) return null;
  const who = name ? ` ${name}` : '';
  return (
    <span className="ui-call-buttons">
      <span className="tabular-nums">{formatPhone(phone)}</span>
      <a className="ui-btn ui-btn-secondary ui-btn-sm" href={links.tel} aria-label={`Call${who}`}>
        <Phone size={14} aria-hidden="true" /> Call
      </a>
      {links.wa ? (
        <a className="ui-btn ui-btn-secondary ui-btn-sm" href={links.wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp${who}`}>
          <MessageCircle size={14} aria-hidden="true" /> WhatsApp
        </a>
      ) : null}
    </span>
  );
}
