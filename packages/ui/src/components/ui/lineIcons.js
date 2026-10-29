import { createElement, useContext } from 'react';
import {
  AlertCircle as LAlertCircle,
  AlertTriangle as LAlertTriangle,
  Archive as LArchive,
  ArrowDown as LArrowDown,
  ArrowLeft as LArrowLeft,
  ArrowRight as LArrowRight,
  ArrowRightLeft as LArrowRightLeft,
  ArrowUp as LArrowUp,
  ArrowUpRight as LArrowUpRight,
  BadgeCheck as LBadgeCheck,
  BadgePercent as LBadgePercent,
  Banknote as LBanknote,
  BarChart3 as LBarChart3,
  Bell as LBell,
  BellOff as LBellOff,
  BookOpen as LBookOpen,
  BookOpenCheck as LBookOpenCheck,
  Bookmark as LBookmark,
  Boxes as LBoxes,
  Briefcase as LBriefcase,
  Building2 as LBuilding2,
  Calendar as LCalendar,
  CalendarCheck as LCalendarCheck,
  CalendarClock as LCalendarClock,
  CalendarDays as LCalendarDays,
  CalendarOff as LCalendarOff,
  CalendarRange as LCalendarRange,
  Camera as LCamera,
  Check as LCheck,
  CheckCheck as LCheckCheck,
  CheckCircle2 as LCheckCircle2,
  ChevronDown as LChevronDown,
  ChevronLeft as LChevronLeft,
  ChevronRight as LChevronRight,
  CircleArrowDown as LCircleArrowDown,
  CircleArrowUp as LCircleArrowUp,
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
  ExternalLink as LExternalLink,
  Eye as LEye,
  EyeOff as LEyeOff,
  FileDown as LFileDown,
  FileSignature as LFileSignature,
  FileText as LFileText,
  FileUp as LFileUp,
  Filter as LFilter,
  Fingerprint as LFingerprint,
  Gavel as LGavel,
  GitBranch as LGitBranch,
  HandCoins as LHandCoins,
  Handshake as LHandshake,
  Hash as LHash,
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
  List as LList,
  ListChecks as LListChecks,
  ListTree as LListTree,
  Lock as LLock,
  LogIn as LLogIn,
  LogOut as LLogOut,
  Mail as LMail,
  MapPin as LMapPin,
  Maximize2 as LMaximize2,
  Menu as LMenu,
  MessageCircle as LMessageCircle,
  MessageSquare as LMessageSquare,
  Minus as LMinus,
  MoreHorizontal as LMoreHorizontal,
  MoreVertical as LMoreVertical,
  Network as LNetwork,
  Package as LPackage,
  PartyPopper as LPartyPopper,
  Pencil as LPencil,
  Percent as LPercent,
  PlugZap as LPlugZap,
  Plus as LPlus,
  Printer as LPrinter,
  Receipt as LReceipt,
  RefreshCw as LRefreshCw,
  RotateCcw as LRotateCcw,
  Save as LSave,
  Scale as LScale,
  Search as LSearch,
  SearchX as LSearchX,
  Settings as LSettings,
  Settings2 as LSettings2,
  ShieldAlert as LShieldAlert,
  ShieldCheck as LShieldCheck,
  ShoppingCart as LShoppingCart,
  SlidersHorizontal as LSlidersHorizontal,
  Table2 as LTable2,
  Tags as LTags,
  Timer as LTimer,
  Trash2 as LTrash2,
  TreePalm as LTreePalm,
  TrendingUp as LTrendingUp,
  TriangleAlert as LTriangleAlert,
  Truck as LTruck,
  Undo2 as LUndo2,
  Upload as LUpload,
  UserCheck as LUserCheck,
  UserMinus as LUserMinus,
  UserPlus as LUserPlus,
  UserRound as LUserRound,
  UserRoundCheck as LUserRoundCheck,
  UserX as LUserX,
  Users as LUsers,
  Wallet as LWallet,
  WalletCards as LWalletCards,
  Warehouse as LWarehouse,
  WifiOff as LWifiOff,
  Workflow as LWorkflow,
  X as LX,
  XCircle as LXCircle,
  Zap as LZap,
} from 'lucide-react';
import {
  AddRegular,
  AlertRegular,
  AlertOffRegular,
  ArchiveRegular,
  ArrowCircleDownRegular,
  ArrowCircleUpRegular,
  ArrowClockwiseRegular,
  ArrowCounterclockwiseRegular,
  ArrowDownRegular,
  ArrowDownloadRegular,
  ArrowEnterRegular,
  ArrowEnterLeftRegular,
  ArrowLeftRegular,
  ArrowRightRegular,
  ArrowSwapRegular,
  ArrowTrendingRegular,
  ArrowUndoRegular,
  ArrowUpRegular,
  ArrowUpRightRegular,
  ArrowUploadRegular,
  BeachRegular,
  BoardRegular,
  BookOpenRegular,
  BookOpenLightbulbRegular,
  BookmarkRegular,
  BoxRegular,
  BoxMultipleRegular,
  BranchForkRegular,
  BriefcaseRegular,
  BuildingRegular,
  BuildingBankRegular,
  BuildingRetailRegular,
  CalendarRegular,
  CalendarCancelRegular,
  CalendarCheckmarkRegular,
  CalendarClockRegular,
  CalendarDataBarRegular,
  CalendarLtrRegular,
  CameraRegular,
  CartRegular,
  ChatRegular,
  CheckmarkRegular,
  CheckmarkCircleRegular,
  CheckmarkSquareRegular,
  CheckmarkStarburstRegular,
  ChevronDownRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  ClipboardBulletListRegular,
  ClipboardTaskRegular,
  ClockRegular,
  ColumnTripleRegular,
  CommentRegular,
  CopyRegular,
  CurrencyDollarRupeeRegular,
  DataBarVerticalRegular,
  DeleteRegular,
  DismissRegular,
  DismissCircleRegular,
  DocumentArrowDownRegular,
  DocumentArrowUpRegular,
  DocumentSignatureRegular,
  DocumentTextRegular,
  EditRegular,
  ErrorCircleRegular,
  EyeRegular,
  EyeOffRegular,
  FilterRegular,
  FingerprintRegular,
  FlashRegular,
  FlowRegular,
  FullScreenMaximizeRegular,
  GavelRegular,
  GridRegular,
  HandshakeRegular,
  HourglassHalfRegular,
  InfoRegular,
  KeyRegular,
  KeyboardRegular,
  LayerRegular,
  ListRegular,
  LocationRegular,
  LockClosedRegular,
  MailRegular,
  MoneyRegular,
  MoneyHandRegular,
  MoreHorizontalRegular,
  MoreVerticalRegular,
  NavigationRegular,
  NumberSymbolRegular,
  OpenRegular,
  OptionsRegular,
  OrganizationRegular,
  PaymentRegular,
  PeopleRegular,
  PersonRegular,
  PersonAddRegular,
  PersonAvailableRegular,
  PersonDeleteRegular,
  PersonSubtractRegular,
  PersonSupportRegular,
  PlugConnectedRegular,
  PrintRegular,
  QuestionCircleRegular,
  ReceiptRegular,
  SaveRegular,
  ScalesRegular,
  SearchRegular,
  SearchInfoRegular,
  SettingsRegular,
  ShieldCheckmarkRegular,
  ShieldErrorRegular,
  SignOutRegular,
  SparkleRegular,
  SubtractRegular,
  TableRegular,
  TagMultipleRegular,
  TagPercentRegular,
  TaskListLtrRegular,
  TextBulletListTreeRegular,
  TextPercentRegular,
  TimerRegular,
  VehicleTruckRegular,
  WalletRegular,
  WalletCreditCardRegular,
  WarningRegular,
  WifiOffRegular,
} from '@fluentui/react-icons';

import { LineSetContext } from './iconSet';

/**
 * The platform's line icons under their Lucide names, drawn in Fluent's line set (Fluent Regular) for an app
 * that asks for it with `lineIcons: 'fluent'` (People, owner 28 Oct 2026: one icon family with its Fluent
 * Color marks), and as Lucide everywhere else, so Accounting and Payroll look exactly as before. A screen
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

export const AlertCircle = twin(LAlertCircle, ErrorCircleRegular);
export const AlertTriangle = twin(LAlertTriangle, WarningRegular);
export const Archive = twin(LArchive, ArchiveRegular);
export const ArrowDown = twin(LArrowDown, ArrowDownRegular);
export const ArrowLeft = twin(LArrowLeft, ArrowLeftRegular);
export const ArrowRight = twin(LArrowRight, ArrowRightRegular);
export const ArrowRightLeft = twin(LArrowRightLeft, ArrowSwapRegular);
export const ArrowUp = twin(LArrowUp, ArrowUpRegular);
export const ArrowUpRight = twin(LArrowUpRight, ArrowUpRightRegular);
export const BadgeCheck = twin(LBadgeCheck, CheckmarkStarburstRegular);
export const BadgePercent = twin(LBadgePercent, TagPercentRegular);
export const Banknote = twin(LBanknote, MoneyRegular);
export const BarChart3 = twin(LBarChart3, DataBarVerticalRegular);
export const Bell = twin(LBell, AlertRegular);
export const BellOff = twin(LBellOff, AlertOffRegular);
export const BookOpen = twin(LBookOpen, BookOpenRegular);
export const BookOpenCheck = twin(LBookOpenCheck, BookOpenLightbulbRegular);
export const Bookmark = twin(LBookmark, BookmarkRegular);
export const Boxes = twin(LBoxes, BoxMultipleRegular);
export const Briefcase = twin(LBriefcase, BriefcaseRegular);
export const Building2 = twin(LBuilding2, BuildingRegular);
export const Calendar = twin(LCalendar, CalendarRegular);
export const CalendarCheck = twin(LCalendarCheck, CalendarCheckmarkRegular);
export const CalendarClock = twin(LCalendarClock, CalendarClockRegular);
export const CalendarDays = twin(LCalendarDays, CalendarLtrRegular);
export const CalendarOff = twin(LCalendarOff, CalendarCancelRegular);
export const CalendarRange = twin(LCalendarRange, CalendarDataBarRegular);
export const Camera = twin(LCamera, CameraRegular);
export const Check = twin(LCheck, CheckmarkRegular);
export const CheckCheck = twin(LCheckCheck, CheckmarkSquareRegular);
export const CheckCircle2 = twin(LCheckCircle2, CheckmarkCircleRegular);
export const ChevronDown = twin(LChevronDown, ChevronDownRegular);
export const ChevronLeft = twin(LChevronLeft, ChevronLeftRegular);
export const ChevronRight = twin(LChevronRight, ChevronRightRegular);
export const CircleArrowDown = twin(LCircleArrowDown, ArrowCircleDownRegular);
export const CircleArrowUp = twin(LCircleArrowUp, ArrowCircleUpRegular);
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
export const ExternalLink = twin(LExternalLink, OpenRegular);
export const Eye = twin(LEye, EyeRegular);
export const EyeOff = twin(LEyeOff, EyeOffRegular);
export const FileDown = twin(LFileDown, DocumentArrowDownRegular);
export const FileSignature = twin(LFileSignature, DocumentSignatureRegular);
export const FileText = twin(LFileText, DocumentTextRegular);
export const FileUp = twin(LFileUp, DocumentArrowUpRegular);
export const Filter = twin(LFilter, FilterRegular);
export const Fingerprint = twin(LFingerprint, FingerprintRegular);
export const Gavel = twin(LGavel, GavelRegular);
export const GitBranch = twin(LGitBranch, BranchForkRegular);
export const HandCoins = twin(LHandCoins, MoneyHandRegular);
export const Handshake = twin(LHandshake, HandshakeRegular);
export const Hash = twin(LHash, NumberSymbolRegular);
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
export const List = twin(LList, ListRegular);
export const ListChecks = twin(LListChecks, TaskListLtrRegular);
export const ListTree = twin(LListTree, TextBulletListTreeRegular);
export const Lock = twin(LLock, LockClosedRegular);
export const LogIn = twin(LLogIn, ArrowEnterRegular);
export const LogOut = twin(LLogOut, SignOutRegular);
export const Mail = twin(LMail, MailRegular);
export const MapPin = twin(LMapPin, LocationRegular);
export const Maximize2 = twin(LMaximize2, FullScreenMaximizeRegular);
export const Menu = twin(LMenu, NavigationRegular);
export const MessageCircle = twin(LMessageCircle, ChatRegular);
export const MessageSquare = twin(LMessageSquare, CommentRegular);
export const Minus = twin(LMinus, SubtractRegular);
export const MoreHorizontal = twin(LMoreHorizontal, MoreHorizontalRegular);
export const MoreVertical = twin(LMoreVertical, MoreVerticalRegular);
export const Network = twin(LNetwork, OrganizationRegular);
export const Package = twin(LPackage, BoxRegular);
export const PartyPopper = twin(LPartyPopper, SparkleRegular);
export const Pencil = twin(LPencil, EditRegular);
export const Percent = twin(LPercent, TextPercentRegular);
export const PlugZap = twin(LPlugZap, PlugConnectedRegular);
export const Plus = twin(LPlus, AddRegular);
export const Printer = twin(LPrinter, PrintRegular);
export const Receipt = twin(LReceipt, ReceiptRegular);
export const RefreshCw = twin(LRefreshCw, ArrowClockwiseRegular);
export const RotateCcw = twin(LRotateCcw, ArrowCounterclockwiseRegular);
export const Save = twin(LSave, SaveRegular);
export const Scale = twin(LScale, ScalesRegular);
export const Search = twin(LSearch, SearchRegular);
export const SearchX = twin(LSearchX, SearchInfoRegular);
export const Settings = twin(LSettings, SettingsRegular);
export const Settings2 = twin(LSettings2, OptionsRegular);
export const ShieldAlert = twin(LShieldAlert, ShieldErrorRegular);
export const ShieldCheck = twin(LShieldCheck, ShieldCheckmarkRegular);
export const ShoppingCart = twin(LShoppingCart, CartRegular);
export const SlidersHorizontal = twin(LSlidersHorizontal, OptionsRegular);
export const Table2 = twin(LTable2, TableRegular);
export const Tags = twin(LTags, TagMultipleRegular);
export const Timer = twin(LTimer, TimerRegular);
export const Trash2 = twin(LTrash2, DeleteRegular);
export const TreePalm = twin(LTreePalm, BeachRegular);
export const TrendingUp = twin(LTrendingUp, ArrowTrendingRegular);
export const TriangleAlert = twin(LTriangleAlert, WarningRegular);
export const Truck = twin(LTruck, VehicleTruckRegular);
export const Undo2 = twin(LUndo2, ArrowUndoRegular);
export const Upload = twin(LUpload, ArrowUploadRegular);
export const UserCheck = twin(LUserCheck, PersonAvailableRegular);
export const UserMinus = twin(LUserMinus, PersonSubtractRegular);
export const UserPlus = twin(LUserPlus, PersonAddRegular);
export const UserRound = twin(LUserRound, PersonRegular);
export const UserRoundCheck = twin(LUserRoundCheck, PersonAvailableRegular);
export const UserX = twin(LUserX, PersonDeleteRegular);
export const Users = twin(LUsers, PeopleRegular);
export const Wallet = twin(LWallet, WalletRegular);
export const WalletCards = twin(LWalletCards, WalletCreditCardRegular);
export const Warehouse = twin(LWarehouse, BuildingRetailRegular);
export const WifiOff = twin(LWifiOff, WifiOffRegular);
export const Workflow = twin(LWorkflow, FlowRegular);
export const X = twin(LX, DismissRegular);
export const XCircle = twin(LXCircle, DismissCircleRegular);
export const Zap = twin(LZap, FlashRegular);
