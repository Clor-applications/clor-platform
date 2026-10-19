package `in`.clor.attendance.data

import `in`.clor.attendance.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
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

val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
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
        val response = try {
            http.newCall(builder.build()).execute()
        } catch (e: IOException) {
            throw ApiError("No connection to CLOR. Check the internet and try again.", "OFFLINE")
        }
        response.use { r ->
            val text = r.body?.string().orEmpty()
            if (r.isSuccessful) return@withContext text
            val err = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
            val message = err?.get("error")?.jsonPrimitive?.content ?: "Something went wrong (${r.code})."
            val code = err?.get("code")?.jsonPrimitive?.content
            if (r.code == 401 && code == "PORTAL_SIGNIN") {
                session.clear()
                throw SignedOut(message)
            }
            throw ApiError(message, code, r.code)
        }
    }

    private suspend inline fun <reified T> get(path: String): T = json.decodeFromString(call("GET", path))
    private suspend inline fun <reified T> post(path: String, body: JsonObject = JsonObject(emptyMap())): T = json.decodeFromString(call("POST", path, body))

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

    suspend fun askCorrection(date: String, checkIn: String, checkOut: String?, reason: String) {
        call("POST", "/corrections", buildJsonObject {
            put("date", date); put("checkIn", checkIn); checkOut?.let { put("checkOut", it) }; put("reason", reason)
        })
    }

    suspend fun leave(year: Int? = null): Leave = get(if (year != null) "/leave?year=$year" else "/leave")
    suspend fun askLeave(leaveTypeId: String, fromDate: String, toDate: String, reason: String) {
        call("POST", "/leave", buildJsonObject { put("leaveTypeId", leaveTypeId); put("fromDate", fromDate); put("toDate", toDate); put("reason", reason) })
    }
    suspend fun cancelLeave(id: String) { call("POST", "/leave/$id/cancel") }

    suspend fun approvals(): Approvals = get("/approvals")
    suspend fun decide(type: String, id: String, approve: Boolean, note: String?) {
        call("POST", "/approvals/$type/$id", buildJsonObject { put("decision", if (approve) "approve" else "reject"); note?.let { put("note", it) } })
    }

    suspend fun notice(): NoticeAnswer = get("/privacy-notice")
    suspend fun readNotice(version: String) { call("POST", "/privacy-notice/read", buildJsonObject { put("version", version) }) }

    suspend fun documents(): Documents = get("/documents")
    suspend fun document(id: String): DocumentFile = get("/documents/$id")
    /** Everything held about me, as the JSON file the server prepares. */
    suspend fun myData(): String = call("GET", "/my-data")

    suspend fun changePassword(current: String, next: String) {
        val text = call("POST", "/password", buildJsonObject { put("current", current); put("next", next) })
        runCatching { json.parseToJsonElement(text).jsonObject["token"]?.jsonPrimitive?.content }.getOrNull()?.let { session.save(it) }
    }
}
