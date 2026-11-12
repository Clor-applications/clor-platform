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

import { duo as duoIcon } from './duoIcon';
import { useIconSet } from './iconSet';

/**
 * The brand two-tone twin of a line icon a screen draws as content (a figure's mark, a quick link), for an app in
 * the two-tone set (iconSet 'duo': every app but Accounting): the same Phosphor two-tone mark the menus use, so a
 * figure or a quick link matches the rail beside it. Keyed by the Lucide icon's displayName, so a screen passes the
 * icon it already imports and nothing else changes. Buttons keep their line icons: an action is not content.
 * BarChart3 is an alias in Lucide 1 whose displayName is ChartColumn, and Building2's is BuildingComplex, so those
 * are the keys that match.
 */
const duo = (Icon, name) => duoIcon(Icon, name, 20);
const DUO = {
  ChartColumn: duo(PChartBar, 'ChartColumn'),
  BuildingComplex: duo(PBuildings, 'BuildingComplex'),
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

/** The Lucide names that have a two-tone twin; a test checks each is still a Lucide displayName, so a rename fails loudly. */
export const TWIN_NAMES = Object.keys(DUO);

/** A content icon in the open app's set: its two-tone twin in the two-tone set, the line icon otherwise or when it has none. */
export function useContentIcon() {
  const set = useIconSet();
  return (Icon) => (Icon && set === 'duo' && DUO[Icon.displayName]) || Icon;
}
