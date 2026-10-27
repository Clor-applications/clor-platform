package `in`.clor.attendance.data

import `in`.clor.attendance.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** What went wrong, in the server's own words where it gave them, and its code (NO_LOCATION, OUTSIDE, …). */
class ApiError(message: String, val code: String? = null, val status: Int = 0) : Exception(message)

/** The session is over (switched off, password changed, token expired): back to sign-in. */
class SignedOut(message: String) : Exception(message)

const val OFFLINE_WORDS = "No connection to CLOR. Check the internet and try again."
const val UNREADABLE_WORDS = "CLOR sent an answer this app could not read. Try again, or update the app."

val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

/** An answer the app cannot read (a newer or broken server) is a plain error with a retry, never a crash. */
inline fun <reified T> readAnswer(text: String): T = try {
    json.decodeFromString<T>(text)
} catch (e: SerializationException) {
    throw ApiError(UNREADABLE_WORDS, "BAD_ANSWER")
} catch (e: IllegalArgumentException) {
    throw ApiError(UNREADABLE_WORDS, "BAD_ANSWER")
}

/** A request body from a model: its nulls are left out, as the web app leaves them out. */
inline fun <reified T> bodyOf(value: T): JsonObject = json.encodeToJsonElement(value).jsonObject

/** The server's words for a failed answer: its `error`, or a plain line by the status. */
fun errorWords(status: Int, text: String): Pair<String, String?> {
    val err = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
    val message = runCatching { err?.get("error")?.jsonPrimitive?.content }.getOrNull()?.takeIf { it.isNotBlank() }
        ?: if (status >= 500) "CLOR could not answer just now ($status). Try again in a moment." else "Something went wrong ($status)."
    val code = runCatching { err?.get("code")?.jsonPrimitive?.content }.getOrNull()
    return message to code
}

/**
 * The employee portal API (server/src/routes/portal.ts): the same one the web
 * portal uses, so the server decides everything — the time of a punch, whether
 * it is inside a site, what a day counts as. The phone only asks and shows.
 */
class Api(private val session: Session, private val base: String = BuildConfig.API_BASE) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json".toMediaType()

    private suspend fun call(method: String, path: String, body: JsonElement? = null): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url("$base$path").header("Accept", "application/json")
        session.token()?.let { builder.header("Authorization", "Bearer $it") }
        val payload = body?.toString()?.toRequestBody(jsonType)
        builder.method(method, if (method == "GET") null else (payload ?: "{}".toRequestBody(jsonType)))
        /* Reading the answer can fail as well as sending it: both are "no connection", in words, never a crash. */
        val (status, ok, text) = try {
            http.newCall(builder.build()).execute().use { r -> Triple(r.code, r.isSuccessful, r.body?.string().orEmpty()) }
        } catch (e: IOException) {
            throw ApiError(OFFLINE_WORDS, "OFFLINE")
        }
        if (ok) return@withContext text
        val (message, code) = errorWords(status, text)
        if (status == 401 && code == "PORTAL_SIGNIN") {
            session.clear()
            throw SignedOut(message)
        }
        throw ApiError(message, code, status)
    }

    private suspend inline fun <reified T> get(path: String): T = readAnswer(call("GET", path))
    private suspend inline fun <reified T> post(path: String, body: JsonObject = JsonObject(emptyMap())): T = readAnswer(call("POST", path, body))
    private suspend inline fun <reified T> put(path: String, body: JsonObject): T = readAnswer(call("PUT", path, body))

    suspend fun signIn(company: String, employeeCode: String, password: String): SignedIn =
        post<SignedIn>("/login", buildJsonObject { put("company", company); put("employeeCode", employeeCode); put("password", password) }).also { session.save(it.token) }

    suspend fun activate(company: String, employeeCode: String, activationCode: String, password: String): SignedIn =
        post<SignedIn>("/activate", buildJsonObject { put("company", company); put("employeeCode", employeeCode); put("activationCode", activationCode); put("password", password) }).also { session.save(it.token) }

    suspend fun me(): Me = get("/me")
    suspend fun home(): Home = get("/home")

    suspend fun punch(latitude: Double, longitude: Double, accuracy: Float, photoJpegBase64: String?): PunchResult =
        post("/punch", buildJsonObject {
            put("latitude", latitude)
            put("longitude", longitude)
            put("accuracy", accuracy.toDouble())
            photoJpegBase64?.let { put("photo", "data:image/jpeg;base64,$it") }
        })

    suspend fun month(month: String): Month = get("/attendance?month=$month")
    suspend fun explain(date: String): Explained = get("/attendance/explain?date=$date")

    suspend fun requests(): MyRequests = get("/requests")

    /*
     * Attendance requests (portal /requests): a missed punch, work from home,
     * on duty (with a place) and permission hours, on one list with one
     * approval and a monthly quota. Change and withdraw go through the same
     * routes for every kind; nothing goes through the old /corrections path.
     */
    suspend fun requestRules(month: String): RequestRules = get("/request-rules?month=$month")
    suspend fun requestUsage(month: String): UsageAnswer = get("/requests/usage?month=$month")
    suspend fun askRequest(ask: AttendanceAsk) { call("POST", "/requests", bodyOf(ask)) }
    suspend fun changeRequest(id: String, ask: AttendanceAsk) { call("PUT", "/requests/$id", bodyOf(ask)) }
    suspend fun cancelRequest(id: String) { call("POST", "/requests/$id/cancel") }

    /*
     * My details (portal /people/me/details): contact details save at once, by
     * the company's setting; the rest becomes a change request HR decides.
     * Not a data-protection request: those are askData below.
     */
    suspend fun myDetails(): MyDetails = get("/people/me/details")
    suspend fun changeDetails(changes: Map<String, String>): DetailsSaved = post("/people/me/change-request", buildJsonObject { changes.forEach { (k, v) -> put(k, v) } })
    suspend fun answerMyRequest(id: String, note: String) { call("POST", "/people/me/requests/$id/reply", buildJsonObject { put("note", note) }) }
    suspend fun withdrawMyRequest(id: String) { call("POST", "/people/me/requests/$id/withdraw") }

    /** A data-protection request, answered within 30 days: CORRECTION, ACCESS, ERASURE, NOMINATE, GRIEVANCE. Never for everyday profile edits. */
    suspend fun askData(type: String, details: String) { call("POST", "/data-requests", buildJsonObject { put("type", type); put("details", details) }) }
    suspend fun askPhonePunch(note: String?): Said = post("/phone-punch/ask", buildJsonObject { note?.let { put("note", it) } })

    suspend fun leave(year: Int? = null): Leave = get(if (year != null) "/leave?year=$year" else "/leave")
    /** What a request would charge, date by date, before it is sent; `editing` leaves that request's own days out. */
    suspend fun previewLeave(ask: LeaveAsk): LeavePreview = post("/leave/preview", bodyOf(ask))
    /** Leave across the leave-year end is sent with split = true and comes back as one request per year. */
    suspend fun askLeave(ask: LeaveAsk): LeaveSent = post("/leave", bodyOf(ask))
    suspend fun editLeave(id: String, ask: LeaveAsk): LeaveSent = put("/leave/$id", bodyOf(ask))
    /** Came back early: approved leave that has started ends on an earlier day. */
    suspend fun shortenLeave(id: String, toDate: String): LeaveSent = post("/leave/$id/shorten", buildJsonObject { put("toDate", toDate) })
    suspend fun cancelLeave(id: String) { call("POST", "/leave/$id/cancel") }
    suspend fun restrictedHolidays(): RestrictedHolidays = get("/holidays/restricted")
    suspend fun pickHoliday(id: String, picked: Boolean) { call("POST", "/holidays/restricted/$id", buildJsonObject { put("picked", picked) }) }

    /** Forgot password: HR is asked for a new activation code. */
    suspend fun forgot(company: String, employeeCode: String): Said = post("/forgot", buildJsonObject { put("company", company); put("employeeCode", employeeCode) })
    suspend fun updates(): Updates = get("/updates")
    suspend fun punchPhoto(id: String): PhotoAnswer = get("/approvals/punch/$id/photo")

    suspend fun attention(): AttentionList = get("/attention")
    suspend fun monthReview(month: String): MonthReview = get("/month-review?month=$month")
    suspend fun confirmMonth(month: String) { call("POST", "/month-review/$month/confirm") }
    suspend fun disputeMonth(month: String, note: String) { call("POST", "/month-review/$month/dispute", buildJsonObject { put("note", note) }) }
    suspend fun upcoming(from: String, days: Int): Upcoming = get("/schedule?from=$from&days=$days")
    suspend fun overtime(month: String): OvertimeView = get("/overtime?month=$month")
    /** kind: OVERTIME (approve the recorded overtime) or COMP_OFF (a day off for a worked rest day). */
    suspend fun askOvertime(date: String, kind: String, reason: String) {
        call("POST", "/overtime", buildJsonObject { put("date", date); put("kind", kind); put("reason", reason) })
    }
    suspend fun cancelOvertime(id: String) { call("POST", "/overtime/$id/cancel") }

    suspend fun approvals(): Approvals = get("/approvals")
    suspend fun decide(type: String, id: String, approve: Boolean, note: String?) {
        call("POST", "/approvals/$type/$id", buildJsonObject { put("decision", if (approve) "approve" else "reject"); note?.let { put("note", it) } })
    }

    suspend fun notice(): NoticeAnswer = get("/privacy-notice")
    suspend fun readNotice(version: String) { call("POST", "/privacy-notice/read", buildJsonObject { put("version", version) }) }

    suspend fun documents(): Documents = get("/documents")
    suspend fun payslips(): Payslips = get("/payslips")
    suspend fun payslip(id: String): PayslipAnswer = get("/payslips/$id")
    suspend fun document(id: String): DocumentFile = get("/documents/$id")
    /** Everything held about me, as the JSON file the server prepares. */
    suspend fun myData(): String = call("GET", "/my-data")

    suspend fun changePassword(current: String, next: String) {
        val text = call("POST", "/password", buildJsonObject { put("current", current); put("next", next) })
        runCatching { json.parseToJsonElement(text).jsonObject["token"]?.jsonPrimitive?.content }.getOrNull()?.let { session.save(it) }
    }
}
