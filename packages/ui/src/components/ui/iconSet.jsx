import React, { createContext, useContext } from 'react';
import {
  ArrowsLeftRight,
  CalendarCheck,
  CalendarSlash,
  ChartBar,
  Clock,
  Confetti,
  Fingerprint,
  GearSix,
  MapPin,
  ShieldCheck,
  ShieldWarning,
  Timer,
  Tray,
  UserCircle,
} from '@phosphor-icons/react';

/**
 * Which icon set an app draws in: 'line' (the platform's Lucide outlines,
 * the default) or 'duotone' (Phosphor duotone, an outline over a soft fill).
 *
 * Shared and opt-in, like the palettes: an app names `iconSet: 'duotone'` in
 * its manifest and the shell provides it here. Shared components that draw a
 * mark of their own (EntityMark, so every PageHeader) ask this context; an
 * app without it renders exactly as before.
 */
export const IconSetContext = createContext('line');
export const useIconSet = () => useContext(IconSetContext);

/**
 * A Phosphor icon as a drop-in for a Lucide one: same `size`, duotone weight,
 * and the `ui-duo` class the stylesheet colours. The fill layer is
 * currentColor at 20% by default; a palette may tint it (Blaze makes it
 * orange). Lucide's strokeWidth has no meaning here and is dropped.
 */
export function duotone(Icon, name = Icon.displayName || 'Icon') {
  // eslint-disable-next-line no-unused-vars -- strokeWidth is taken off so it is not passed to the svg
  const Duo = ({ size = 20, className = '', strokeWidth, ...rest }) => (
    <Icon size={size} weight="duotone" className={`ui-duo ${className}`.trim()} {...rest} />
  );
  Duo.displayName = `Duo(${name})`;
  return Duo;
}

/** Duotone marks for entities that already have a line mark (so no screen gains or loses one). */
export const DUOTONE_ENTITY_ICON = {
  attendance: duotone(CalendarCheck, 'CalendarCheck'),
  employee: duotone(UserCircle, 'UserCircle'),
  exception: duotone(ShieldWarning, 'ShieldWarning'),
  holiday: duotone(Confetti, 'Confetti'),
  leave: duotone(CalendarSlash, 'CalendarSlash'),
  location: duotone(MapPin, 'MapPin'),
  overtime: duotone(Timer, 'Timer'),
  privacy: duotone(ShieldCheck, 'ShieldCheck'),
  reader: duotone(Fingerprint, 'Fingerprint'),
  report: duotone(ChartBar, 'ChartBar'),
  request: duotone(Tray, 'Tray'),
  settings: duotone(GearSix, 'GearSix'),
  shift: duotone(Clock, 'Clock'),
  transfer: duotone(ArrowsLeftRight, 'ArrowsLeftRight'),
};
