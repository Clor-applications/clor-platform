import React, { createContext, useContext } from 'react';
import {
  ArrowSyncColor,
  CalendarCancelColor,
  CalendarCheckmarkColor,
  ClockAlarmColor,
  ClockColor,
  DataBarVerticalAscendingColor,
  DocumentEditColor,
  GiftColor,
  LocationRippleColor,
  PersonColor,
  ScanPersonColor,
  SettingsColor,
  ShieldCheckmarkColor,
  WarningColor,
} from '@fluentui/react-icons';

/**
 * Which icon set an app draws in: 'line' (the platform's Lucide outlines,
 * the default) or 'color' (Microsoft Fluent's full-colour icons).
 *
 * Shared and opt-in, like the palettes: an app names `iconSet: 'color'` in its
 * manifest and the shell provides it here. Shared components that draw a mark
 * of their own (EntityMark, so every PageHeader) ask this context; an app
 * without it renders exactly as before.
 */
export const IconSetContext = createContext('line');
/** Which line icons the open app draws: 'lucide' (the default) or 'fluent' (Fluent Regular, beside Fluent Color). See lineIcons.js. */
export const LineSetContext = createContext('lucide');
export const useIconSet = () => useContext(IconSetContext);

/**
 * A Fluent colour icon as a drop-in for a Lucide one: the same `size` prop
 * (Fluent sizes by font size), and Lucide's strokeWidth dropped. Its colours
 * are its own; it does not take the text colour or the palette's accent.
 */
export function colorIcon(Icon, name = Icon.displayName || 'Icon') {
  // eslint-disable-next-line no-unused-vars -- strokeWidth is taken off so it is not passed to the svg
  const Colored = ({ size = 20, className = '', strokeWidth, ...rest }) => (
    <Icon fontSize={size} className={`ui-color-icon ${className}`.trim()} {...rest} />
  );
  Colored.displayName = `Color(${name})`;
  return Colored;
}

/** Colour marks for entities that already have a line mark (so no screen gains or loses one). */
export const COLOR_ENTITY_ICON = {
  attendance: colorIcon(CalendarCheckmarkColor, 'CalendarCheckmark'),
  employee: colorIcon(PersonColor, 'Person'),
  exception: colorIcon(WarningColor, 'Warning'),
  holiday: colorIcon(GiftColor, 'Gift'),
  leave: colorIcon(CalendarCancelColor, 'CalendarCancel'),
  location: colorIcon(LocationRippleColor, 'LocationRipple'),
  overtime: colorIcon(ClockAlarmColor, 'ClockAlarm'),
  privacy: colorIcon(ShieldCheckmarkColor, 'ShieldCheckmark'),
  reader: colorIcon(ScanPersonColor, 'ScanPerson'),
  report: colorIcon(DataBarVerticalAscendingColor, 'DataBarVerticalAscending'),
  request: colorIcon(DocumentEditColor, 'DocumentEdit'),
  settings: colorIcon(SettingsColor, 'Settings'),
  shift: colorIcon(ClockColor, 'Clock'),
  transfer: colorIcon(ArrowSyncColor, 'ArrowSync'),
};
