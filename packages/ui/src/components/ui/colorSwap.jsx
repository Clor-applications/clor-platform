import {
  ApprovalsAppColor,
  BeachColor,
  BuildingColor,
  BuildingMultipleColor,
  CalendarClockColor,
  CalendarColor,
  CalendarDataBarColor,
  ClipboardTaskColor,
  ClipboardTextEditColor,
  ClockAlarmColor,
  ClockColor,
  DataBarVerticalAscendingColor,
  DataPieColor,
  DocumentAddColor,
  DocumentTextColor,
  HeadsetColor,
  LocationRippleColor,
  LockClosedColor,
  OrgColor,
  PeopleColor,
  PersonAvailableColor,
  PersonWarningColor,
  SettingsColor,
  ShieldCheckmarkColor,
  TextBulletListSquareColor,
  ArrowSyncColor,
} from '@fluentui/react-icons';

import {
  Buildings as PBuildings,
  CalendarBlank as PCalendarBlank,
  CalendarDots as PCalendarDots,
  ChartBar as PChartBar,
  ClipboardText as PClipboardText,
  Clock as PClock,
  FileText as PFileText,
  FlowArrow as PFlowArrow,
  GearSix as PGearSix,
  Hourglass as PHourglass,
  Lifebuoy as PLifebuoy,
  ListChecks as PListChecks,
  Lock as PLock,
  MapPin as PMapPin,
  NotePencil as PNotePencil,
  Scales as PScales,
  ShieldCheck as PShieldCheck,
  Timer as PTimer,
  Tray as PTray,
  TreeStructure as PTreeStructure,
  Umbrella as PUmbrella,
  UploadSimple as PUploadSimple,
  UserCheck as PUserCheck,
  UserMinus as PUserMinus,
  UsersThree as PUsersThree,
} from '@phosphor-icons/react';

import { colorIcon, useIconSet } from './iconSet';

/**
 * The colour twin of a line icon a screen draws as content (a figure's mark, a quick link), for an app in the
 * colour set (owner, 28 Oct 2026: "change line icons also"). Keyed by the Lucide icon's name, so a screen passes
 * the icon it already imports and nothing else changes. Buttons keep their line icons: an action is not content.
 */
const TWIN = Object.fromEntries(Object.entries({
  /* BarChart3 is an alias in Lucide 1: its displayName is ChartColumn, so that is the key that matches. */
  ChartColumn: DataBarVerticalAscendingColor,
  Building2: BuildingColor,
  CalendarClock: CalendarClockColor,
  CalendarDays: CalendarColor,
  CalendarRange: CalendarDataBarColor,
  ClipboardCheck: ClipboardTaskColor,
  Clock3: ClockColor,
  FileText: DocumentTextColor,
  GitBranch: OrgColor,
  Gavel: ClipboardTextEditColor,
  Hourglass: ClockAlarmColor,
  Inbox: ApprovalsAppColor,
  LifeBuoy: HeadsetColor,
  ListChecks: TextBulletListSquareColor,
  Lock: LockClosedColor,
  MapPin: LocationRippleColor,
  Network: OrgColor,
  Scale: DataPieColor,
  Settings2: SettingsColor,
  Timer: ClockAlarmColor,
  TreePalm: BeachColor,
  Upload: DocumentAddColor,
  UserCheck: PersonAvailableColor,
  UserMinus: PersonWarningColor,
  UserX: PersonWarningColor,
  Users: PeopleColor,
  Workflow: ArrowSyncColor,
  ShieldCheck: ShieldCheckmarkColor,
  Building: BuildingMultipleColor,
}).map(([name, Icon]) => [name, colorIcon(Icon, name)]));

/* The brand two-tone twin (People, brand D option C): the same Phosphor two-tone mark the menus use, so a figure or a
   quick link matches the rail beside it. */
const duo = (Icon, name) => {
  // eslint-disable-next-line no-unused-vars -- Lucide's strokeWidth is taken off so it is not passed to the svg
  const Duo = ({ size = 20, strokeWidth, className = '', ...rest }) => <Icon size={size} weight="duotone" className={`ui-glyph ${className}`.trim()} {...rest} />;
  Duo.displayName = `Duo(${name})`;
  return Duo;
};
const DUO = {
  ChartColumn: duo(PChartBar, 'ChartColumn'),
  Building2: duo(PBuildings, 'Building2'),
  CalendarClock: duo(PCalendarDots, 'CalendarClock'),
  CalendarDays: duo(PCalendarBlank, 'CalendarDays'),
  CalendarRange: duo(PCalendarDots, 'CalendarRange'),
  ClipboardCheck: duo(PClipboardText, 'ClipboardCheck'),
  Clock3: duo(PClock, 'Clock3'),
  FileText: duo(PFileText, 'FileText'),
  GitBranch: duo(PTreeStructure, 'GitBranch'),
  Gavel: duo(PNotePencil, 'Gavel'),
  Hourglass: duo(PHourglass, 'Hourglass'),
  Inbox: duo(PTray, 'Inbox'),
  LifeBuoy: duo(PLifebuoy, 'LifeBuoy'),
  ListChecks: duo(PListChecks, 'ListChecks'),
  Lock: duo(PLock, 'Lock'),
  MapPin: duo(PMapPin, 'MapPin'),
  Network: duo(PTreeStructure, 'Network'),
  Scale: duo(PScales, 'Scale'),
  Settings2: duo(PGearSix, 'Settings2'),
  Timer: duo(PTimer, 'Timer'),
  TreePalm: duo(PUmbrella, 'TreePalm'),
  Upload: duo(PUploadSimple, 'Upload'),
  UserCheck: duo(PUserCheck, 'UserCheck'),
  UserMinus: duo(PUserMinus, 'UserMinus'),
  UserX: duo(PUserMinus, 'UserX'),
  Users: duo(PUsersThree, 'Users'),
  Workflow: duo(PFlowArrow, 'Workflow'),
  ShieldCheck: duo(PShieldCheck, 'ShieldCheck'),
  Building: duo(PBuildings, 'Building'),
};

/** The Lucide names that have a colour twin; a test checks each is still a Lucide displayName, so a rename fails loudly. */
export const TWIN_NAMES = Object.keys(TWIN);

/** A content icon in the open app's set: its colour twin in the colour set, its two-tone twin in the two-tone set, the line icon otherwise or when it has none. */
export function useContentIcon() {
  const set = useIconSet();
  return (Icon) => (Icon && (set === 'color' ? TWIN : set === 'duo' ? DUO : null)?.[Icon.displayName]) || Icon;
}
