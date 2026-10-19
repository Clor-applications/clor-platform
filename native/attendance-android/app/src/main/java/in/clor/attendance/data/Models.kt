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
data class TodayPunch(val time: String = "", val kind: String? = null, val phone: Boolean = false, val site: String? = null)

@Serializable
data class Phone(val allowed: Boolean = false, val next: String? = null, val why: String? = null, val sites: List<Site> = emptyList())

@Serializable
data class Site(val id: String = "", val name: String = "", val radiusMeters: Int = 0)

@Serializable
data class PrivacyState(val version: String = "", val read: Boolean = false)

@Serializable
data class PunchResult(val kind: String = "", val time: String = "", val site: String? = null, val distance: Int? = null)

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
    val reason: String? = null,
    val status: String = "",
)

@Serializable
data class Approvals(val approver: Boolean = false, val leaves: List<Ask> = emptyList(), val corrections: List<Ask> = emptyList())

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
