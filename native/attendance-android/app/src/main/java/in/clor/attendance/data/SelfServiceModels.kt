package `in`.clor.attendance.data

import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * Attendance requests, leave preview and change, restricted holidays and My
 * details: what the portal answers (server/src/routes/portal.ts,
 * peoplePortal.ts) and the words the app makes of it. The words live here,
 * away from the screens, so the tests can read them.
 */

// ---------------------------------------------------------------------------
// Attendance requests (/requests, /request-rules, /requests/usage)
// ---------------------------------------------------------------------------

object Kinds {
    const val MISSED = "MISSED_PUNCH"
    const val WFH = "WFH"
    const val ON_DUTY = "ON_DUTY"
    const val PERMISSION = "PERMISSION"
    /** Work from home and on duty cover days (a span, or half of one day); the others are one day with times. */
    fun spans(kind: String) = kind == WFH || kind == ON_DUTY
    fun timed(kind: String) = kind == MISSED || kind == PERMISSION
    fun name(kind: String) = when (kind) { MISSED -> "Missed punch"; WFH -> "Work from home"; ON_DUTY -> "On duty"; PERMISSION -> "Permission"; else -> kind }
}

@Serializable
data class RequestRule(val on: Boolean = false, val quotaPerMonth: Double? = null, val hoursPerMonth: Double? = null, val maxMinutes: Int = 0, val backDays: Int = 0)

@Serializable
data class RequestKindName(val kind: String = "", val name: String = "")

/** This month's use of one kind: days, requests or hours, used (approved) and waiting, and what is left of the quota (null = no limit). */
@Serializable
data class Usage(val kind: String = "", val month: String = "", val unit: String = "", val used: Double = 0.0, val pending: Double = 0.0, val quota: Double? = null, val left: Double? = null)

@Serializable
data class RequestRules(
    val month: String = "",
    val rules: Map<String, RequestRule> = emptyMap(),
    /** Only the kinds the company has switched on. */
    val kinds: List<RequestKindName> = emptyList(),
    val usage: Map<String, Usage> = emptyMap(),
    val reasons: List<String> = emptyList(),
)

@Serializable
data class UsageAnswer(val month: String = "", val usage: Map<String, Usage> = emptyMap())

/** The body of POST /requests and PUT /requests/:id. Nulls are left out. */
@Serializable
data class AttendanceAsk(
    val kind: String,
    val date: String,
    val reason: String,
    val toDate: String? = null,
    val halfDay: String? = null,
    val place: String? = null,
    val checkIn: String? = null,
    val checkOut: String? = null,
    val reasonCode: String? = null,
)

/**
 * The ask from what is on the form, keeping only what the kind takes (as the
 * web app does): a last day and a half day for WFH / on duty, a place for on
 * duty, times for a missed punch and permission, a reason code for a missed punch.
 */
fun attendanceAsk(kind: String, date: String, toDate: String?, halfDay: String?, place: String?, checkIn: String?, checkOut: String?, reason: String, reasonCode: String?): AttendanceAsk {
    val spans = Kinds.spans(kind)
    val last = toDate?.takeIf { spans && it.isNotBlank() && it != date }
    return AttendanceAsk(
        kind = kind,
        date = date,
        reason = reason.trim(),
        toDate = last,
        halfDay = halfDay?.takeIf { spans && last == null && it.isNotBlank() },
        place = place?.trim()?.takeIf { kind == Kinds.ON_DUTY && it.isNotEmpty() },
        checkIn = checkIn?.takeIf { Kinds.timed(kind) && it.isNotBlank() },
        checkOut = checkOut?.takeIf { Kinds.timed(kind) && it.isNotBlank() },
        reasonCode = reasonCode?.takeIf { kind == Kinds.MISSED && it.isNotBlank() },
    )
}

/** What still stops the ask, in words, or null when it can be sent. The server checks it all again. */
fun attendanceAskProblem(a: AttendanceAsk): String? = when {
    a.kind == Kinds.MISSED && a.checkIn == null -> "Give the in time (24-hour, e.g. 09:10), or tap the clock."
    a.kind == Kinds.PERMISSION && (a.checkIn == null || a.checkOut == null) -> "Give the hours: from and to."
    a.kind == Kinds.PERMISSION && a.checkOut!! <= a.checkIn!! -> "The end is before the start."
    a.kind == Kinds.ON_DUTY && a.place == null -> "Where will you be? Give the place."
    a.toDate != null && a.toDate < a.date -> "The last day is before the first."
    a.reason.length < 3 -> "Say why."
    else -> null
}

/** 2.0 → "2", 1.5 → "1.5". */
fun num(n: Double): String = if (n % 1.0 == 0.0) n.toLong().toString() else (Math.round(n * 100) / 100.0).toString()

/** "Work-from-home days this month: 2 of 4 used, 1 waiting, 1 left." — the line under the form, as on the web. */
fun usageLine(u: Usage, kind: String = u.kind): String {
    val what = when {
        u.unit == "hours" -> "Permission hours"
        u.unit == "requests" -> "Missed-punch requests"
        kind == Kinds.WFH -> "Work-from-home days"
        else -> "On-duty days"
    }
    val used = if (u.quota == null) "${num(u.used)} used, no limit" else "${num(u.used)} of ${num(u.quota)} used"
    val waiting = if (u.pending > 0) ", ${num(u.pending)} waiting" else ""
    val left = if (u.quota != null && u.left != null) ", ${num(u.left)} left" else ""
    return "$what this month: $used$waiting$left."
}

private val shortFmt = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH)
private val longFmt = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH)
fun dayWords(iso: String?): String = iso?.let { runCatching { LocalDate.parse(it).format(shortFmt) }.getOrDefault(it) } ?: ""
fun fullDayWords(iso: String?): String = iso?.let { runCatching { LocalDate.parse(it.take(10)).format(longFmt) }.getOrDefault(it) } ?: ""

/** "1 hour 30 min". */
fun hoursWords(minutes: Int?): String {
    val m = maxOf(0, minutes ?: 0)
    val h = m / 60
    return listOfNotNull(if (h > 0) "$h ${if (h == 1) "hour" else "hours"}" else null, if (m % 60 > 0) "${m % 60} min" else null).joinToString(" ")
}

/** What an attendance request says about itself: the days, then the place, the hours, the times or the half. */
fun requestWords(r: MyRequest): String {
    val date = r.date.orEmpty()
    val whenWords = if (r.toDate.isNullOrBlank() || r.toDate == date) dayWords(date) else "${dayWords(date)} – ${dayWords(r.toDate)}"
    val kind = r.requestKind ?: if (r.kind == "correction") Kinds.MISSED else ""
    val extra = when (kind) {
        Kinds.ON_DUTY -> listOfNotNull(r.place, r.halfDay?.let { halfWords(it) }).joinToString(", ")
        Kinds.PERMISSION -> "${r.checkIn.orEmpty()}–${r.checkOut.orEmpty()}, ${hoursWords(r.minutes)}"
        Kinds.MISSED -> "in ${r.checkIn ?: "—"}${r.checkOut?.let { ", out $it" } ?: ""}"
        else -> r.halfDay?.let { halfWords(it) }.orEmpty()
    }
    return if (extra.isBlank()) whenWords else "$whenWords · $extra"
}

fun halfWords(half: String) = if (half == "FIRST") "first half" else "second half"

// ---------------------------------------------------------------------------
// Leave: preview, ask, change, came back early (/leave/*)
// ---------------------------------------------------------------------------

/** The body of /leave/preview, POST /leave and PUT /leave/:id. */
@Serializable
data class LeaveAsk(
    val leaveTypeId: String,
    val fromDate: String,
    val toDate: String,
    val reason: String = "",
    val halfDay: String? = null,
    /** Leave crossing the leave-year end: saved as one linked request per year. */
    val split: Boolean? = null,
    /** Preview only: the request being changed, whose own days are not counted against it. */
    val editing: String? = null,
)

@Serializable
data class PreviewType(val id: String = "", val name: String = "", val isPaid: Boolean = true, val isPrivate: Boolean = false, val allowHalfDay: Boolean = false)

@Serializable
data class PlannedDay(val date: String = "", val counted: Boolean = true, val why: String? = null)

@Serializable
data class PreviewBalance(val before: Double? = null, val after: Double? = null)

/** One leave year's share of a request. */
@Serializable
data class PreviewPart(val year: Int = 0, val label: String = "", val from: String = "", val to: String = "", val days: Double = 0.0, val balance: PreviewBalance = PreviewBalance(), val dates: List<PlannedDay> = emptyList())

@Serializable
data class Problem(val code: String = "", val message: String = "")

/** What a request would charge, before it is sent (POST /leave/preview). */
@Serializable
data class LeavePreview(
    val ok: Boolean = false,
    val type: PreviewType? = null,
    val total: Double = 0.0,
    val split: Boolean = false,
    val parts: List<PreviewPart> = emptyList(),
    val problems: List<Problem> = emptyList(),
    val reasonNeeded: Boolean = true,
)

/** What a leave save answers: the request, and every part when it was split at the year end. */
@Serializable
data class LeaveSent(val request: LeaveRequest = LeaveRequest(), val requests: List<LeaveRequest> = emptyList()) {
    val all: List<LeaveRequest> get() = requests.ifEmpty { listOf(request) }
}

fun daysText(n: Double): String = when (n) { 0.5 -> "half a day"; 1.0 -> "1 day"; else -> "${num(n)} days" }
private val NUMBER_WORD = listOf("", "one", "two", "three", "four")
fun countWord(n: Int) = NUMBER_WORD.getOrNull(n)?.takeIf { it.isNotEmpty() } ?: n.toString()

/** The preview as lines to show: the total, the split, each date not counted and why, the balance after. Problems are shown apart. */
fun previewLines(p: LeavePreview): List<String> = buildList {
    val saved = p.parts.filter { it.days > 0 }
    if (p.total > 0) add(daysText(p.total).replaceFirstChar { it.uppercase() } + " of leave.")
    if (p.split && saved.size > 1) {
        add("This crosses the end of the leave year, so it is saved as ${countWord(saved.size)} requests, one per leave year:")
        saved.forEach { add("${it.label}: ${spanWords(it.from, it.to)}, ${daysText(it.days)}") }
    }
    p.parts.flatMap { it.dates }.filter { !it.why.isNullOrBlank() }.forEach { add("${dayWords(it.date)} not counted: ${it.why}") }
    saved.filter { it.balance.after != null }.forEach { add("${if (saved.size > 1) "${it.label}: " else ""}${num(it.balance.after!!)} left after this") }
}

fun spanWords(from: String, to: String) = if (from == to) dayWords(from) else "${dayWords(from)} – ${dayWords(to)}"

/** "Asked for 3 days of Casual, as two requests: 2026: 30 Mar – 31 Mar, 2 days; 2027: 1 Apr, 1 day." */
fun sentWords(sent: LeaveSent, changed: Boolean = false): String {
    val all = sent.all
    val total = all.sumOf { it.days }
    val name = sent.request.leaveTypeName ?: "leave"
    val head = if (changed) "Changed: ${daysText(total)} of $name. It waits for a decision again" else "Asked for ${daysText(total)} of $name"
    if (all.size < 2) return "$head${if (all.size == 1 && all[0].status == "APPROVED") ", approved by the leave rule" else ""}."
    return "$head, as ${countWord(all.size)} requests, one per leave year: " + all.joinToString("; ") { "${spanWords(it.fromDate, it.toDate)}, ${daysText(it.days)}" } + "."
}

/** Approved leave that has started and has a later day still to come, and is not a half day: it can end early. */
fun canShorten(r: LeaveRequest, today: String) = r.status == "APPROVED" && r.halfDay == null && r.fromDate <= today && r.toDate > today
fun canCancelLeave(r: LeaveRequest, today: String) = r.status == "PENDING" || (r.status == "APPROVED" && r.fromDate > today)
fun dayBefore(iso: String): String = LocalDate.parse(iso).minusDays(1).toString()

// ---------------------------------------------------------------------------
// Restricted holidays (/holidays/restricted)
// ---------------------------------------------------------------------------

@Serializable
data class RestrictedHoliday(val id: String = "", val date: String = "", val name: String = "", val picked: Boolean = false, val past: Boolean = false)

@Serializable
data class RestrictedHolidays(val year: Int = 0, val quota: Int = 0, val picked: Int = 0, val left: Int = 0, val holidays: List<RestrictedHoliday> = emptyList())

// ---------------------------------------------------------------------------
// My details (/people/me/details, /people/me/change-request)
// ---------------------------------------------------------------------------

object DetailFields {
    /** The order the details are shown and asked in: the same as the web app's My details. */
    val ORDER = listOf("firstName", "lastName", "phone", "personalEmail", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation", "addressLine", "city", "state", "pincode", "country", "dateOfBirth", "gender", "maritalStatus", "guardianName")
    val GENDER = listOf("" to "Not said", "MALE" to "Male", "FEMALE" to "Female", "NON_BINARY" to "Non-binary", "OTHER" to "Other", "PREFER_NOT_TO_SAY" to "Prefer not to say")
    val MARITAL = listOf("" to "Not said", "SINGLE" to "Single", "MARRIED" to "Married", "DIVORCED" to "Divorced", "WIDOWED" to "Widowed")
    fun choices(field: String) = when (field) { "gender" -> GENDER; "maritalStatus" -> MARITAL; else -> null }

    /** A value as people read it: a date in words, a choice by its name, "—" for nothing. */
    fun shown(field: String, value: String?): String = when {
        value.isNullOrBlank() -> "—"
        field == "dateOfBirth" || field == "lastDay" -> fullDayWords(value)
        else -> choices(field)?.firstOrNull { it.first == value }?.second ?: value
    }

    /** Only the fields that changed, as the web app sends them; a cleared field is sent as "". */
    fun changed(original: Map<String, String?>, form: Map<String, String>): Map<String, String> =
        ORDER.mapNotNull { k ->
            val now = form[k]?.trim() ?: return@mapNotNull null
            if (now != (original[k] ?: "")) k to now else null
        }.toMap()
}

@Serializable
data class Terms(
    val designation: String? = null,
    val department: String? = null,
    val employmentType: String? = null,
    val hours: String? = null,
    val workMode: String? = null,
    val worksAt: String? = null,
    val manager: String? = null,
    val departmentHead: String? = null,
    val joinedOn: String? = null,
    val probationEndsOn: String? = null,
    val confirmedOn: String? = null,
    val contractEndsOn: String? = null,
    val lastDay: String? = null,
)

@Serializable
data class Asked(val field: String = "", val label: String = "", val value: String? = null)

@Serializable
data class HrComment(val text: String = "", val by: String = "", val at: String? = null)

@Serializable
data class Reply(val at: String? = null, val note: String = "")

/** A change to my details or a resignation, with HR's answer (E5). */
@Serializable
data class SelfRequest(
    val id: String = "",
    val kind: String = "",
    val title: String = "",
    val status: String = "",
    val statusLabel: String = "",
    val asked: List<Asked> = emptyList(),
    val comment: HrComment? = null,
    val replies: List<Reply> = emptyList(),
    val createdAt: String? = null,
    val canReply: Boolean = false,
    val canWithdraw: Boolean = false,
)

@Serializable
data class MyDetails(
    val fields: Map<String, String?> = emptyMap(),
    val labels: Map<String, String> = emptyMap(),
    val hasPhoto: Boolean = false,
    /** The fields that save at once; the rest go to HR. */
    val savesAtOnce: List<String> = emptyList(),
    val hrDecidesWithinDays: Int = 3,
    val terms: Terms? = null,
    val requests: List<SelfRequest> = emptyList(),
) {
    fun label(field: String) = labels[field] ?: field

    /** What happens to a change, in one line, by the company's setting. */
    fun rule(): String = when {
        savesAtOnce.size >= DetailFields.ORDER.size -> "Your changes save at once."
        savesAtOnce.isNotEmpty() -> "Phone, personal email and emergency contact save at once. Other changes go to HR, who decide within $hrDecidesWithinDays working days."
        else -> "Every change goes to HR, who decide within $hrDecidesWithinDays working days."
    }
}

@Serializable
data class DetailsSaved(val saved: List<String> = emptyList(), val requested: List<String>? = null)

/** "Saved: phone. Sent to HR: city. You will see the answer under My requests." */
fun detailsSavedWords(r: DetailsSaved, d: MyDetails): String {
    val name = { k: String -> if (k == "photoUrl") "photo" else d.label(k).lowercase() }
    val parts = buildList {
        if (r.saved.isNotEmpty()) add("Saved: ${r.saved.joinToString(", ") { name(it) }}.")
        if (!r.requested.isNullOrEmpty()) add("Sent to HR: ${r.requested.joinToString(", ") { name(it) }}. You will see the answer under My requests.")
    }
    return parts.joinToString(" ").ifEmpty { "Nothing changed." }
}
