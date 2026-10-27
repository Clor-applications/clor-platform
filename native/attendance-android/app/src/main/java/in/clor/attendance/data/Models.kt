package `in`.clor.attendance.data

import kotlinx.serialization.Serializable

/*
 * What the employee portal API (server/src/routes/portal.ts) answers, as far
 * as this app reads it. Unknown fields are ignored and everything optional
 * has a default, so a newer server never breaks an older app.
 */

@Serializable
data class SignedIn(val token: String, val employee: Person = Person(), val company: Company = Company())

@Serializable
data class Person(val name: String = "", val code: String? = null, val department: String? = null, val designation: String? = null)

@Serializable
data class Company(val name: String = "", val code: String? = null)

@Serializable
data class Me(
    val employee: Person = Person(),
    val company: Company = Company(),
    val today: String = "",
    val shift: Shift = Shift(),
    val record: DayRecord? = null,
    val punches: List<TodayPunch> = emptyList(),
    val phone: Phone = Phone(),
    val approver: Boolean = false,
    val privacy: PrivacyState? = null,
)

@Serializable
data class Shift(val name: String = "", val startTime: String = "", val endTime: String = "", val off: Boolean = false, val holiday: String? = null)

@Serializable
data class DayRecord(
    val status: String = "",
    val checkInTime: String? = null,
    val checkOutTime: String? = null,
    val workedMinutes: Int? = null,
    val lateMinutes: Int? = null,
)

@Serializable
data class TodayPunch(val time: String = "", val kind: String? = null, val phone: Boolean = false, val site: String? = null, val outside: Boolean = false, val review: String? = null)

@Serializable
data class Phone(val allowed: Boolean = false, val next: String? = null, val why: String? = null, val mode: String = "SITE", val selfieRequired: Boolean = false, val sites: List<Site> = emptyList())

@Serializable
data class Site(val id: String = "", val name: String = "", val radiusMeters: Int = 0)

@Serializable
data class PrivacyState(val version: String = "", val read: Boolean = false)

@Serializable
data class PunchResult(val kind: String = "", val time: String = "", val site: String? = null, val distance: Int? = null, val outside: Boolean = false, val address: String? = null, val review: String? = null)

@Serializable
data class Month(
    val month: String = "",
    val days: List<Day> = emptyList(),
    val totals: Totals = Totals(),
    val corrections: List<Correction> = emptyList(),
)

@Serializable
data class Day(
    val date: String = "",
    val status: String = "",
    val checkIn: String? = null,
    val checkOut: String? = null,
    val workedMinutes: Int? = null,
    val lateMinutes: Int? = null,
)

@Serializable
data class Totals(val present: Int = 0, val halfDay: Int = 0, val absent: Int = 0, val leave: Int = 0, val late: Int = 0)

@Serializable
data class Correction(
    val id: String = "",
    val date: String = "",
    val checkIn: String? = null,
    val checkOut: String? = null,
    val reason: String? = null,
    val status: String = "",
    val note: String? = null,
)

@Serializable
data class Explained(
    val date: String = "",
    val shift: ShiftRule = ShiftRule(),
    val holiday: String? = null,
    val punches: List<ExplainedPunch> = emptyList(),
    val steps: List<Step> = emptyList(),
    val monthClosed: Boolean = false,
)

@Serializable
data class ShiftRule(val name: String = "", val startTime: String = "", val endTime: String = "")

@Serializable
data class ExplainedPunch(val time: String = "", val kind: String? = null, val where: String = "")

@Serializable
data class Step(val kind: String = "", val text: String = "")

@Serializable
data class Leave(val year: Int = 0, val today: String = "", val types: List<LeaveType> = emptyList(), val requests: List<LeaveRequest> = emptyList())

@Serializable
data class LeaveType(
    val id: String = "",
    val name: String = "",
    val isPaid: Boolean = true,
    val allocated: Double? = null,
    val used: Double = 0.0,
    val pending: Double = 0.0,
    val available: Double? = null,
)

@Serializable
data class LeaveRequest(
    val id: String = "",
    val leaveTypeName: String? = null,
    val fromDate: String = "",
    val toDate: String = "",
    val days: Double = 0.0,
    val halfDay: String? = null,
    val reason: String? = null,
    val status: String = "",
    val note: String? = null,
    /** The parts of one leave split at the leave-year end share a group. */
    val groupId: String? = null,
    val leaveTypeId: String? = null,
)

@Serializable
data class Approvals(val approver: Boolean = false, val leaves: List<Ask> = emptyList(), val corrections: List<Ask> = emptyList(), val punches: List<Ask> = emptyList(), val overtime: List<Ask> = emptyList())

/** A leave or correction waiting on me, as an approver. */
@Serializable
data class Ask(
    val id: String = "",
    val type: String = "",
    val employeeName: String = "",
    val employeeCode: String? = null,
    val leaveTypeName: String? = null,
    val fromDate: String? = null,
    val toDate: String? = null,
    val days: Double? = null,
    val date: String? = null,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val reason: String? = null,
    val kind: String? = null,
    val halfDay: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val accuracy: Int? = null,
    val photo: Boolean = false,
    val minutes: Int? = null,
)

@Serializable
data class NoticeAnswer(val notice: Notice = Notice(), val read: Boolean = false)

@Serializable
data class Notice(val version: String = "", val company: String = "", val sections: List<NoticeSection> = emptyList())

@Serializable
data class NoticeSection(val id: String = "", val title: String = "", val items: List<String> = emptyList())

@Serializable
data class Documents(val documents: List<DocumentInfo> = emptyList())

@Serializable
data class DocumentInfo(val id: String = "", val title: String = "", val mime: String = "", val size: Int = 0, val expiresOn: String? = null)

@Serializable
data class DocumentFile(val document: DocumentData = DocumentData())

@Serializable
data class DocumentData(val id: String = "", val title: String = "", val mime: String = "", val dataUrl: String = "")

/** The home screen in one answer (GET /portal/home). */
@Serializable
data class Home(
    val employee: Person = Person(),
    val company: Company = Company(),
    val site: String? = null,
    val today: String = "",
    val shift: Shift = Shift(),
    val record: DayRecord? = null,
    val punches: List<TodayPunch> = emptyList(),
    val phone: Phone = Phone(),
    val month: MonthFigures = MonthFigures(),
    val week: List<WeekDay> = emptyList(),
    val attention: List<Attention> = emptyList(),
    val attentionCount: Int = 0,
    /** The company runs payroll in CLOR: payslips are in the app. */
    val payroll: Boolean = false,
    val leave: LeaveSummary = LeaveSummary(),
    val corrections: Pending = Pending(),
    val holidays: List<Holiday> = emptyList(),
    val approvals: TeamSummary = TeamSummary(),
    val privacy: PrivacyState? = null,
)

@Serializable
data class MonthFigures(
    val month: String = "",
    val workingDays: Int = 0,
    val present: Double = 0.0,
    val absent: Int = 0,
    val leave: Int = 0,
    val late: Int = 0,
    val lateMinutes: Int = 0,
    val workedMinutes: Int = 0,
    val rate: Int? = null,
)

@Serializable
data class WeekDay(val date: String = "", val workedMinutes: Int = 0, val status: String = "")

@Serializable
data class Attention(val date: String = "", val why: String = "")

@Serializable
data class LeaveSummary(val balances: List<Balance> = emptyList(), val pending: Int = 0)

@Serializable
data class Balance(val id: String = "", val name: String = "", val available: Double? = null, val used: Double = 0.0, val pending: Double = 0.0)

@Serializable
data class Pending(val pending: Int = 0)

@Serializable
data class Holiday(val date: String = "", val name: String = "")

@Serializable
data class TeamSummary(val approver: Boolean = false, val team: Int = 0, val waiting: Int = 0, val awayToday: List<String> = emptyList())

/**
 * One of my requests (GET /portal/requests). `kind` is "correction" (a missed
 * punch), "request" (work from home, on duty, permission: see `requestKind`),
 * "leave", "overtime", "compoff" or "data".
 */
@Serializable
data class MyRequest(
    val id: String = "",
    val kind: String = "",
    /** MISSED_PUNCH, WFH, ON_DUTY or PERMISSION, for attendance requests. */
    val requestKind: String? = null,
    val kindName: String? = null,
    val place: String? = null,
    /** May be withdrawn (or, approved WFH / on duty before its day, cancelled). Attendance requests only; others use canChange. */
    val canCancel: Boolean = false,
    val reasonCode: String? = null,
    val type: String? = null,
    val date: String? = null,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val leaveTypeName: String? = null,
    val fromDate: String? = null,
    val toDate: String? = null,
    val days: Double? = null,
    val halfDay: String? = null,
    val reason: String? = null,
    val status: String = "",
    val note: String? = null,
    val createdAt: String = "",
    val dueAt: String? = null,
    val canChange: Boolean = false,
    val minutes: Int? = null,
    val withHr: Boolean = false,
    /** Sent, the manager, HR, decided: what is done and who acts next. */
    val steps: List<TimelineStep> = emptyList(),
    val next: String? = null,
)

@Serializable
data class TimelineStep(val label: String = "", val state: String = "LATER", val at: String? = null, val who: String? = null)

@Serializable
data class MyRequests(val requests: List<MyRequest> = emptyList(), val reasons: List<String> = emptyList())

@Serializable
data class Said(val ok: Boolean = true, val message: String = "")

/** What changed for me (GET /portal/updates), for notifications. */
@Serializable
data class Updates(val decided: List<Decided> = emptyList(), val waitingForMe: Int = 0)

@Serializable
data class Decided(val key: String = "", val text: String = "")

@Serializable
data class PhotoAnswer(val photo: String = "")

/** Past days with something missing or waiting (GET /portal/attention). */
@Serializable
data class AttentionList(val items: List<AttentionItem> = emptyList(), val count: Int = 0, val waiting: Int = 0)

@Serializable
data class AttentionItem(val date: String = "", val kind: String = "", val text: String = "", val action: String = "NONE", val checkIn: String? = null)

/** A month to check and confirm (GET /portal/month-review). */
@Serializable
data class MonthReview(
    val month: String = "",
    val summary: ReviewSummary = ReviewSummary(),
    val unresolved: List<AttentionItem> = emptyList(),
    val pendingOvertime: Int = 0,
    val cutoff: String = "",
    val canConfirm: Boolean = false,
    val why: String? = null,
    val confirmation: Confirmation? = null,
)

@Serializable
data class ReviewSummary(
    val present: Double = 0.0,
    val halfDays: Double = 0.0,
    val absent: Double = 0.0,
    val leave: Double = 0.0,
    val holidays: Double = 0.0,
    val weeklyOffs: Double = 0.0,
    val late: Double = 0.0,
    val latePenaltyDays: Double = 0.0,
    val lossOfPayDays: Double = 0.0,
    val payableDays: Double = 0.0,
    val notYet: Double = 0.0,
    val workedMinutes: Double = 0.0,
    val overtimeMinutes: Double = 0.0,
    val approvedOvertimeMinutes: Double = 0.0,
)

@Serializable
data class Confirmation(val status: String = "", val note: String? = null, val unresolved: Int = 0, val at: String? = null)

/** The days coming up (GET /portal/schedule?from=&days=). */
@Serializable
data class Upcoming(val from: String = "", val days: List<ShiftDay> = emptyList())

@Serializable
data class ShiftDay(
    val date: String = "",
    val kind: String = "WORK",
    val shift: String = "",
    val startTime: String = "",
    val endTime: String = "",
    val crossesMidnight: Boolean = false,
    val holiday: String? = null,
    val halfDay: String? = null,
    val source: String = "",
    val changed: Boolean = false,
    val sourceText: String = "",
)

/** Overtime and comp-off for a month (GET /portal/overtime). */
@Serializable
data class OvertimeView(
    val month: String = "",
    val recordedMinutes: Int = 0,
    val approvedMinutes: Int = 0,
    val pendingMinutes: Int = 0,
    val policy: OvertimePolicy = OvertimePolicy(),
    val days: List<OvertimeDay> = emptyList(),
)

@Serializable
data class OvertimePolicy(val overtimeRequests: Boolean = true, val compOff: Boolean = false)

@Serializable
data class OvertimeDay(
    val date: String = "",
    val workedMinutes: Int = 0,
    val overtimeMinutes: Int = 0,
    val overtimeApproved: Boolean = false,
    val restDay: Boolean = false,
    val compOffDays: Double = 0.0,
    val overtimeRequest: OvertimeAsk? = null,
    val compOffRequest: OvertimeAsk? = null,
    val canAskOvertime: Boolean = false,
    val canAskCompOff: Boolean = false,
)

@Serializable
data class OvertimeAsk(val id: String = "", val status: String = "", val days: Double? = null, val note: String? = null)

/* Payslips (portal /payslips): only from a final payroll; PAN and account arrive masked. */
@Serializable
data class Payslips(val available: Boolean = false, val slips: List<PayslipRow> = emptyList())

@Serializable
data class PayslipRow(val id: String, val number: String = "", val period: String = "", val payrollDate: String = "", val gross: Double = 0.0, val deductions: Double = 0.0, val net: Double = 0.0, val paid: Boolean = false)

@Serializable
data class PayslipAnswer(val slip: Payslip)

@Serializable
data class Payslip(
    val id: String,
    val number: String = "",
    val company: String = "",
    val period: String = "",
    val from: String? = null,
    val to: String? = null,
    val payrollDate: String = "",
    val employee: PayslipPerson = PayslipPerson(),
    val days: PayslipDays = PayslipDays(),
    val earnings: List<PayLine> = emptyList(),
    val deductions: List<PayLine> = emptyList(),
    val gross: Double = 0.0,
    val totalDeductions: Double = 0.0,
    val net: Double = 0.0,
    val paid: Boolean = false,
)

@Serializable
data class PayslipPerson(val name: String = "", val code: String = "", val designation: String = "", val department: String = "", val pan: String = "", val uan: String = "", val bank: String = "", val account: String = "")

@Serializable
data class PayslipDays(val working: Double = 0.0, val payable: Double = 0.0, val lossOfPay: Double = 0.0)

@Serializable
data class PayLine(val name: String = "", val amount: Double = 0.0)
