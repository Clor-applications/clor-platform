import { createElement, useContext } from 'react';
import {
  AlarmClock as LAlarmClock,
  AlertCircle as LAlertCircle,
  AlertTriangle as LAlertTriangle,
  Archive as LArchive,
  ArchiveRestore as LArchiveRestore,
  ArrowDown as LArrowDown,
  ArrowDownUp as LArrowDownUp,
  ArrowLeft as LArrowLeft,
  ArrowRight as LArrowRight,
  ArrowRightLeft as LArrowRightLeft,
  ArrowUp as LArrowUp,
  ArrowUpRight as LArrowUpRight,
  BadgeAlert as LBadgeAlert,
  BadgeCheck as LBadgeCheck,
  BadgePercent as LBadgePercent,
  Ban as LBan,
  Banknote as LBanknote,
  BarChart3 as LBarChart3,
  Bell as LBell,
  BellOff as LBellOff,
  BellRing as LBellRing,
  BookOpen as LBookOpen,
  BookOpenCheck as LBookOpenCheck,
  Bookmark as LBookmark,
  Boxes as LBoxes,
  Briefcase as LBriefcase,
  Building2 as LBuilding2,
  Calculator as LCalculator,
  Calendar as LCalendar,
  CalendarCheck as LCalendarCheck,
  CalendarClock as LCalendarClock,
  CalendarDays as LCalendarDays,
  CalendarMinus as LCalendarMinus,
  CalendarOff as LCalendarOff,
  CalendarPlus as LCalendarPlus,
  CalendarRange as LCalendarRange,
  CalendarX as LCalendarX,
  Camera as LCamera,
  Check as LCheck,
  CheckCheck as LCheckCheck,
  CheckCircle2 as LCheckCircle2,
  CheckSquare as LCheckSquare,
  ChevronDown as LChevronDown,
  ChevronLeft as LChevronLeft,
  ChevronRight as LChevronRight,
  CircleArrowDown as LCircleArrowDown,
  CircleArrowUp as LCircleArrowUp,
  CircleDot as LCircleDot,
  CircleHelp as LCircleHelp,
  ClipboardCheck as LClipboardCheck,
  ClipboardList as LClipboardList,
  Clock as LClock,
  Clock3 as LClock3,
  Columns3 as LColumns3,
  Copy as LCopy,
  CornerDownLeft as LCornerDownLeft,
  Cpu as LCpu,
  CreditCard as LCreditCard,
  Download as LDownload,
  Eraser as LEraser,
  ExternalLink as LExternalLink,
  Eye as LEye,
  EyeOff as LEyeOff,
  FileClock as LFileClock,
  FileDown as LFileDown,
  FileSearch as LFileSearch,
  FileSignature as LFileSignature,
  FileSpreadsheet as LFileSpreadsheet,
  FileText as LFileText,
  FileUp as LFileUp,
  Filter as LFilter,
  Fingerprint as LFingerprint,
  Gavel as LGavel,
  GitBranch as LGitBranch,
  Globe as LGlobe,
  GripVertical as LGripVertical,
  HandCoins as LHandCoins,
  Handshake as LHandshake,
  HardHat as LHardHat,
  Hash as LHash,
  HelpCircle as LHelpCircle,
  History as LHistory,
  Hourglass as LHourglass,
  Inbox as LInbox,
  IndianRupee as LIndianRupee,
  Info as LInfo,
  KeyRound as LKeyRound,
  Keyboard as LKeyboard,
  Landmark as LLandmark,
  Layers as LLayers,
  LayoutGrid as LLayoutGrid,
  LifeBuoy as LLifeBuoy,
  Link2 as LLink2,
  List as LList,
  ListChecks as LListChecks,
  ListTree as LListTree,
  LocateFixed as LLocateFixed,
  Lock as LLock,
  LockOpen as LLockOpen,
  LogIn as LLogIn,
  LogOut as LLogOut,
  Mail as LMail,
  MapPin as LMapPin,
  Maximize2 as LMaximize2,
  Menu as LMenu,
  MessageCircle as LMessageCircle,
  MessageSquare as LMessageSquare,
  MessageSquareWarning as LMessageSquareWarning,
  Minus as LMinus,
  MinusCircle as LMinusCircle,
  Moon as LMoon,
  MoreHorizontal as LMoreHorizontal,
  MoreVertical as LMoreVertical,
  Navigation as LNavigation,
  Network as LNetwork,
  Package as LPackage,
  PartyPopper as LPartyPopper,
  PauseCircle as LPauseCircle,
  PenLine as LPenLine,
  Pencil as LPencil,
  Percent as LPercent,
  Play as LPlay,
  Plug as LPlug,
  PlugZap as LPlugZap,
  Plus as LPlus,
  PlusCircle as LPlusCircle,
  Power as LPower,
  Printer as LPrinter,
  Receipt as LReceipt,
  RefreshCw as LRefreshCw,
  Repeat as LRepeat,
  RotateCcw as LRotateCcw,
  RotateCw as LRotateCw,
  Router as LRouter,
  Save as LSave,
  Scale as LScale,
  ScanFace as LScanFace,
  ScrollText as LScrollText,
  Search as LSearch,
  SearchX as LSearchX,
  Send as LSend,
  Server as LServer,
  Settings as LSettings,
  Settings2 as LSettings2,
  Shield as LShield,
  ShieldAlert as LShieldAlert,
  ShieldCheck as LShieldCheck,
  ShoppingCart as LShoppingCart,
  SkipForward as LSkipForward,
  SlidersHorizontal as LSlidersHorizontal,
  Smartphone as LSmartphone,
  Table2 as LTable2,
  Tags as LTags,
  Timer as LTimer,
  Trash2 as LTrash2,
  TreePalm as LTreePalm,
  TrendingUp as LTrendingUp,
  TriangleAlert as LTriangleAlert,
  Truck as LTruck,
  Undo2 as LUndo2,
  Unlock as LUnlock,
  Upload as LUpload,
  UserCheck as LUserCheck,
  UserCog as LUserCog,
  UserMinus as LUserMinus,
  UserPlus as LUserPlus,
  UserRound as LUserRound,
  UserRoundCheck as LUserRoundCheck,
  UserX as LUserX,
  Users as LUsers,
  Wallet as LWallet,
  WalletCards as LWalletCards,
  Wand2 as LWand2,
  Warehouse as LWarehouse,
  Webhook as LWebhook,
  Wifi as LWifi,
  WifiOff as LWifiOff,
  Workflow as LWorkflow,
  Wrench as LWrench,
  X as LX,
  XCircle as LXCircle,
  Zap as LZap,
} from 'lucide-react';
import {
  AddCircleRegular,
  AddRegular,
  AlertBadgeRegular,
  AlertOffRegular,
  AlertOnRegular,
  AlertRegular,
  ArchiveArrowBackRegular,
  ArchiveRegular,
  ArrowCircleDownRegular,
  ArrowCircleUpRegular,
  ArrowClockwiseRegular,
  ArrowCounterclockwiseRegular,
  ArrowDownRegular,
  ArrowDownloadRegular,
  ArrowEnterLeftRegular,
  ArrowEnterRegular,
  ArrowLeftRegular,
  ArrowRepeatAllRegular,
  ArrowRightRegular,
  ArrowRotateClockwiseRegular,
  ArrowRoutingRegular,
  ArrowSortRegular,
  ArrowSwapRegular,
  ArrowTrendingRegular,
  ArrowUndoRegular,
  ArrowUpRegular,
  ArrowUpRightRegular,
  ArrowUploadRegular,
  BeachRegular,
  BoardRegular,
  BookOpenLightbulbRegular,
  BookOpenRegular,
  BookmarkRegular,
  BoxMultipleRegular,
  BoxRegular,
  BranchForkRegular,
  BriefcaseRegular,
  BuildingBankRegular,
  BuildingRegular,
  BuildingRetailRegular,
  CalculatorRegular,
  CalendarAddRegular,
  CalendarCancelRegular,
  CalendarCheckmarkRegular,
  CalendarClockRegular,
  CalendarDataBarRegular,
  CalendarErrorRegular,
  CalendarLtrRegular,
  CalendarRegular,
  CameraRegular,
  CartRegular,
  ChatRegular,
  ChatWarningRegular,
  CheckboxCheckedRegular,
  CheckmarkCircleRegular,
  CheckmarkRegular,
  CheckmarkSquareRegular,
  CheckmarkStarburstRegular,
  ChevronDownRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  ClipboardBulletListRegular,
  ClipboardTaskRegular,
  ClockAlarmRegular,
  ClockRegular,
  ColumnTripleRegular,
  CommentRegular,
  CopyRegular,
  CurrencyDollarRupeeRegular,
  DataBarVerticalRegular,
  DeleteRegular,
  DismissCircleRegular,
  DismissRegular,
  DocumentArrowDownRegular,
  DocumentArrowUpRegular,
  DocumentBulletListRegular,
  DocumentSearchRegular,
  DocumentSignatureRegular,
  DocumentTableRegular,
  DocumentTextClockRegular,
  DocumentTextRegular,
  EditRegular,
  EraserRegular,
  ErrorCircleRegular,
  EyeOffRegular,
  EyeRegular,
  FilterRegular,
  FingerprintRegular,
  FlashRegular,
  FlowRegular,
  FullScreenMaximizeRegular,
  GavelRegular,
  GlobeRegular,
  GridRegular,
  HandshakeRegular,
  HistoryRegular,
  HourglassHalfRegular,
  InfoRegular,
  KeyRegular,
  KeyboardRegular,
  LayerRegular,
  LinkRegular,
  ListRegular,
  LocationArrowRegular,
  LocationRegular,
  LocationTargetSquareRegular,
  LockClosedRegular,
  LockOpenRegular,
  MailRegular,
  MoneyHandRegular,
  MoneyRegular,
  MoreHorizontalRegular,
  MoreVerticalRegular,
  NavigationRegular,
  NextRegular,
  NumberSymbolRegular,
  OpenRegular,
  OptionsRegular,
  OrganizationRegular,
  PauseCircleRegular,
  PaymentRegular,
  PenRegular,
  PeopleRegular,
  PersonAddRegular,
  PersonAvailableRegular,
  PersonDeleteRegular,
  PersonRegular,
  PersonSettingsRegular,
  PersonSubtractRegular,
  PersonSupportRegular,
  PhoneRegular,
  PlayRegular,
  PlugConnectedRegular,
  PlugDisconnectedRegular,
  PowerRegular,
  PrintRegular,
  ProhibitedRegular,
  QuestionCircleRegular,
  ReOrderDotsVerticalRegular,
  ReceiptRegular,
  RecordRegular,
  RouterRegular,
  SaveRegular,
  ScalesRegular,
  ScanPersonRegular,
  SearchInfoRegular,
  SearchRegular,
  SendRegular,
  ServerRegular,
  SettingsRegular,
  ShieldCheckmarkRegular,
  ShieldErrorRegular,
  ShieldRegular,
  SignOutRegular,
  SparkleRegular,
  SubtractCircleRegular,
  SubtractRegular,
  TableRegular,
  TagMultipleRegular,
  TagPercentRegular,
  TaskListLtrRegular,
  TextBulletListTreeRegular,
  TextPercentRegular,
  TimerRegular,
  VehicleTruckRegular,
  WalletCreditCardRegular,
  WalletRegular,
  WandRegular,
  WarningRegular,
  WeatherMoonRegular,
  Wifi1Regular,
  WifiOffRegular,
  WrenchRegular,
  WrenchScrewdriverRegular,
} from '@fluentui/react-icons';

import { LineSetContext } from './iconSet';

/**
 * The platform's line icons under their Lucide names, drawn in Fluent's line set (Fluent Regular) for an app
 * that asks for it with `lineIcons: 'fluent'` (People since 28 Oct 2026; every app but Accounting, and the
 * shell's own pages, since 9 Nov 2026), and as Lucide everywhere else, so Accounting looks exactly as before. A screen
 * imports from here instead of 'lucide-react' and changes nothing else. The Lucide name stays the component's
 * displayName, so lookups by name (colorSwap) keep working.
 */
function twin(Line, Fluent) {
  const Icon = ({ size = 24, strokeWidth, className, ...rest }) => (useContext(LineSetContext) === 'fluent'
    ? createElement(Fluent, { fontSize: size, className, ...rest })
    : createElement(Line, { size, strokeWidth, className, ...rest }));
  Icon.displayName = Line.displayName;
  return Icon;
}

export const AlarmClock = twin(LAlarmClock, ClockAlarmRegular);
export const AlertCircle = twin(LAlertCircle, ErrorCircleRegular);
export const AlertTriangle = twin(LAlertTriangle, WarningRegular);
export const Archive = twin(LArchive, ArchiveRegular);
export const ArchiveRestore = twin(LArchiveRestore, ArchiveArrowBackRegular);
export const ArrowDown = twin(LArrowDown, ArrowDownRegular);
export const ArrowDownUp = twin(LArrowDownUp, ArrowSortRegular);
export const ArrowLeft = twin(LArrowLeft, ArrowLeftRegular);
export const ArrowRight = twin(LArrowRight, ArrowRightRegular);
export const ArrowRightLeft = twin(LArrowRightLeft, ArrowSwapRegular);
export const ArrowUp = twin(LArrowUp, ArrowUpRegular);
export const ArrowUpRight = twin(LArrowUpRight, ArrowUpRightRegular);
export const BadgeAlert = twin(LBadgeAlert, AlertBadgeRegular);
export const BadgeCheck = twin(LBadgeCheck, CheckmarkStarburstRegular);
export const BadgePercent = twin(LBadgePercent, TagPercentRegular);
export const Ban = twin(LBan, ProhibitedRegular);
export const Banknote = twin(LBanknote, MoneyRegular);
export const BarChart3 = twin(LBarChart3, DataBarVerticalRegular);
export const Bell = twin(LBell, AlertRegular);
export const BellOff = twin(LBellOff, AlertOffRegular);
export const BellRing = twin(LBellRing, AlertOnRegular);
export const BookOpen = twin(LBookOpen, BookOpenRegular);
export const BookOpenCheck = twin(LBookOpenCheck, BookOpenLightbulbRegular);
export const Bookmark = twin(LBookmark, BookmarkRegular);
export const Boxes = twin(LBoxes, BoxMultipleRegular);
export const Briefcase = twin(LBriefcase, BriefcaseRegular);
export const Building2 = twin(LBuilding2, BuildingRegular);
export const Calculator = twin(LCalculator, CalculatorRegular);
export const Calendar = twin(LCalendar, CalendarRegular);
export const CalendarCheck = twin(LCalendarCheck, CalendarCheckmarkRegular);
export const CalendarClock = twin(LCalendarClock, CalendarClockRegular);
export const CalendarDays = twin(LCalendarDays, CalendarLtrRegular);
export const CalendarMinus = twin(LCalendarMinus, CalendarErrorRegular);
export const CalendarOff = twin(LCalendarOff, CalendarCancelRegular);
export const CalendarPlus = twin(LCalendarPlus, CalendarAddRegular);
export const CalendarRange = twin(LCalendarRange, CalendarDataBarRegular);
export const CalendarX = twin(LCalendarX, CalendarCancelRegular);
export const Camera = twin(LCamera, CameraRegular);
export const Check = twin(LCheck, CheckmarkRegular);
export const CheckCheck = twin(LCheckCheck, CheckmarkSquareRegular);
export const CheckCircle2 = twin(LCheckCircle2, CheckmarkCircleRegular);
export const CheckSquare = twin(LCheckSquare, CheckboxCheckedRegular);
export const ChevronDown = twin(LChevronDown, ChevronDownRegular);
export const ChevronLeft = twin(LChevronLeft, ChevronLeftRegular);
export const ChevronRight = twin(LChevronRight, ChevronRightRegular);
export const CircleArrowDown = twin(LCircleArrowDown, ArrowCircleDownRegular);
export const CircleArrowUp = twin(LCircleArrowUp, ArrowCircleUpRegular);
export const CircleDot = twin(LCircleDot, RecordRegular);
export const CircleHelp = twin(LCircleHelp, QuestionCircleRegular);
export const ClipboardCheck = twin(LClipboardCheck, ClipboardTaskRegular);
export const ClipboardList = twin(LClipboardList, ClipboardBulletListRegular);
export const Clock = twin(LClock, ClockRegular);
export const Clock3 = twin(LClock3, ClockRegular);
export const Columns3 = twin(LColumns3, ColumnTripleRegular);
export const Copy = twin(LCopy, CopyRegular);
export const CornerDownLeft = twin(LCornerDownLeft, ArrowEnterLeftRegular);
export const Cpu = twin(LCpu, BoardRegular);
export const CreditCard = twin(LCreditCard, PaymentRegular);
export const Download = twin(LDownload, ArrowDownloadRegular);
export const Eraser = twin(LEraser, EraserRegular);
export const ExternalLink = twin(LExternalLink, OpenRegular);
export const Eye = twin(LEye, EyeRegular);
export const EyeOff = twin(LEyeOff, EyeOffRegular);
export const FileClock = twin(LFileClock, DocumentTextClockRegular);
export const FileDown = twin(LFileDown, DocumentArrowDownRegular);
export const FileSearch = twin(LFileSearch, DocumentSearchRegular);
export const FileSignature = twin(LFileSignature, DocumentSignatureRegular);
export const FileSpreadsheet = twin(LFileSpreadsheet, DocumentTableRegular);
export const FileText = twin(LFileText, DocumentTextRegular);
export const FileUp = twin(LFileUp, DocumentArrowUpRegular);
export const Filter = twin(LFilter, FilterRegular);
export const Fingerprint = twin(LFingerprint, FingerprintRegular);
export const Gavel = twin(LGavel, GavelRegular);
export const GitBranch = twin(LGitBranch, BranchForkRegular);
export const Globe = twin(LGlobe, GlobeRegular);
export const GripVertical = twin(LGripVertical, ReOrderDotsVerticalRegular);
export const HandCoins = twin(LHandCoins, MoneyHandRegular);
export const Handshake = twin(LHandshake, HandshakeRegular);
export const HardHat = twin(LHardHat, WrenchScrewdriverRegular);
export const Hash = twin(LHash, NumberSymbolRegular);
export const HelpCircle = twin(LHelpCircle, QuestionCircleRegular);
export const History = twin(LHistory, HistoryRegular);
export const Hourglass = twin(LHourglass, HourglassHalfRegular);
export const Inbox = twin(LInbox, MailRegular);
export const IndianRupee = twin(LIndianRupee, CurrencyDollarRupeeRegular);
export const Info = twin(LInfo, InfoRegular);
export const KeyRound = twin(LKeyRound, KeyRegular);
export const Keyboard = twin(LKeyboard, KeyboardRegular);
export const Landmark = twin(LLandmark, BuildingBankRegular);
export const Layers = twin(LLayers, LayerRegular);
export const LayoutGrid = twin(LLayoutGrid, GridRegular);
export const LifeBuoy = twin(LLifeBuoy, PersonSupportRegular);
export const Link2 = twin(LLink2, LinkRegular);
export const List = twin(LList, ListRegular);
export const ListChecks = twin(LListChecks, TaskListLtrRegular);
export const ListTree = twin(LListTree, TextBulletListTreeRegular);
export const LocateFixed = twin(LLocateFixed, LocationTargetSquareRegular);
export const Lock = twin(LLock, LockClosedRegular);
export const LockOpen = twin(LLockOpen, LockOpenRegular);
export const LogIn = twin(LLogIn, ArrowEnterRegular);
export const LogOut = twin(LLogOut, SignOutRegular);
export const Mail = twin(LMail, MailRegular);
export const MapPin = twin(LMapPin, LocationRegular);
export const Maximize2 = twin(LMaximize2, FullScreenMaximizeRegular);
export const Menu = twin(LMenu, NavigationRegular);
export const MessageCircle = twin(LMessageCircle, ChatRegular);
export const MessageSquare = twin(LMessageSquare, CommentRegular);
export const MessageSquareWarning = twin(LMessageSquareWarning, ChatWarningRegular);
export const Minus = twin(LMinus, SubtractRegular);
export const MinusCircle = twin(LMinusCircle, SubtractCircleRegular);
export const Moon = twin(LMoon, WeatherMoonRegular);
export const MoreHorizontal = twin(LMoreHorizontal, MoreHorizontalRegular);
export const MoreVertical = twin(LMoreVertical, MoreVerticalRegular);
export const Navigation = twin(LNavigation, LocationArrowRegular);
export const Network = twin(LNetwork, OrganizationRegular);
export const Package = twin(LPackage, BoxRegular);
export const PartyPopper = twin(LPartyPopper, SparkleRegular);
export const PauseCircle = twin(LPauseCircle, PauseCircleRegular);
export const PenLine = twin(LPenLine, PenRegular);
export const Pencil = twin(LPencil, EditRegular);
export const Percent = twin(LPercent, TextPercentRegular);
export const Play = twin(LPlay, PlayRegular);
export const Plug = twin(LPlug, PlugDisconnectedRegular);
export const PlugZap = twin(LPlugZap, PlugConnectedRegular);
export const Plus = twin(LPlus, AddRegular);
export const PlusCircle = twin(LPlusCircle, AddCircleRegular);
export const Power = twin(LPower, PowerRegular);
export const Printer = twin(LPrinter, PrintRegular);
export const Receipt = twin(LReceipt, ReceiptRegular);
export const RefreshCw = twin(LRefreshCw, ArrowClockwiseRegular);
export const Repeat = twin(LRepeat, ArrowRepeatAllRegular);
export const RotateCcw = twin(LRotateCcw, ArrowCounterclockwiseRegular);
export const RotateCw = twin(LRotateCw, ArrowRotateClockwiseRegular);
export const Router = twin(LRouter, RouterRegular);
export const Save = twin(LSave, SaveRegular);
export const Scale = twin(LScale, ScalesRegular);
export const ScanFace = twin(LScanFace, ScanPersonRegular);
export const ScrollText = twin(LScrollText, DocumentBulletListRegular);
export const Search = twin(LSearch, SearchRegular);
export const SearchX = twin(LSearchX, SearchInfoRegular);
export const Send = twin(LSend, SendRegular);
export const Server = twin(LServer, ServerRegular);
export const Settings = twin(LSettings, SettingsRegular);
export const Settings2 = twin(LSettings2, OptionsRegular);
export const Shield = twin(LShield, ShieldRegular);
export const ShieldAlert = twin(LShieldAlert, ShieldErrorRegular);
export const ShieldCheck = twin(LShieldCheck, ShieldCheckmarkRegular);
export const ShoppingCart = twin(LShoppingCart, CartRegular);
export const SkipForward = twin(LSkipForward, NextRegular);
export const SlidersHorizontal = twin(LSlidersHorizontal, OptionsRegular);
export const Smartphone = twin(LSmartphone, PhoneRegular);
export const Table2 = twin(LTable2, TableRegular);
export const Tags = twin(LTags, TagMultipleRegular);
export const Timer = twin(LTimer, TimerRegular);
export const Trash2 = twin(LTrash2, DeleteRegular);
export const TreePalm = twin(LTreePalm, BeachRegular);
export const TrendingUp = twin(LTrendingUp, ArrowTrendingRegular);
export const TriangleAlert = twin(LTriangleAlert, WarningRegular);
export const Truck = twin(LTruck, VehicleTruckRegular);
export const Undo2 = twin(LUndo2, ArrowUndoRegular);
export const Unlock = twin(LUnlock, LockOpenRegular);
export const Upload = twin(LUpload, ArrowUploadRegular);
export const UserCheck = twin(LUserCheck, PersonAvailableRegular);
export const UserCog = twin(LUserCog, PersonSettingsRegular);
export const UserMinus = twin(LUserMinus, PersonSubtractRegular);
export const UserPlus = twin(LUserPlus, PersonAddRegular);
export const UserRound = twin(LUserRound, PersonRegular);
export const UserRoundCheck = twin(LUserRoundCheck, PersonAvailableRegular);
export const UserX = twin(LUserX, PersonDeleteRegular);
export const Users = twin(LUsers, PeopleRegular);
export const Wallet = twin(LWallet, WalletRegular);
export const WalletCards = twin(LWalletCards, WalletCreditCardRegular);
export const Wand2 = twin(LWand2, WandRegular);
export const Warehouse = twin(LWarehouse, BuildingRetailRegular);
export const Webhook = twin(LWebhook, ArrowRoutingRegular);
export const Wifi = twin(LWifi, Wifi1Regular);
export const WifiOff = twin(LWifiOff, WifiOffRegular);
export const Workflow = twin(LWorkflow, FlowRegular);
export const Wrench = twin(LWrench, WrenchRegular);
export const X = twin(LX, DismissRegular);
export const XCircle = twin(LXCircle, DismissCircleRegular);
export const Zap = twin(LZap, FlashRegular);
