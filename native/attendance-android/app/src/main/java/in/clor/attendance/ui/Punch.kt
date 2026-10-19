package `in`.clor.attendance.ui

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.DayRecord
import `in`.clor.attendance.data.Locator
import `in`.clor.attendance.data.Phone
import `in`.clor.attendance.data.Reminders
import `in`.clor.attendance.data.Shift
import `in`.clor.attendance.data.SignedOut
import `in`.clor.attendance.data.TodayPunch
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The punch card: a live clock, where the day stands, and one button. The
 * phone reads its position once, when the button is pressed; the server
 * stamps the time and checks the site, and its answer is what is shown.
 */
@Composable
fun PunchCard(api: Api, shift: Shift, record: DayRecord?, punches: List<TodayPunch>, phone: Phone, onPunched: () -> Unit, onSignedOut: () -> Unit, onAskPhone: () -> Unit = {}, onFix: () -> Unit = {}, onDuty: () -> Unit = {}) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var withSelfie by remember { mutableStateOf(phone.selfieRequired) }
    val field = phone.mode == "FIELD"
    var now by remember { mutableStateOf(LocalTime.now(ZoneId.of("Asia/Kolkata"))) }
    LaunchedEffect(Unit) {
        while (true) {
            now = LocalTime.now(ZoneId.of("Asia/Kolkata"))
            delay(1_000)
        }
    }
    val last = punches.lastOrNull()
    val state = when {
        shift.holiday != null -> "Holiday · ${shift.holiday}"
        last == null -> if (shift.off) "Weekly off" else "Not punched in yet"
        last.kind == "IN" -> "In since ${last.time}"
        else -> "Out at ${last.time}"
    }

    fun send(photo: String?) {
        busy = true
        message = null
        scope.launch {
            try {
                val where = Locator.current(context)
                if (where == null) {
                    message = "Your location did not come through. Turn on location and try again, outside if you can." to false
                    return@launch
                }
                val r = api.punch(where.latitude, where.longitude, where.accuracy, photo)
                message = when {
                    r.review == "PENDING" -> "${if (r.kind == "IN") "In" else "Out"} at ${r.time}${r.address?.let { " · $it" } ?: ""}. Recorded as a field punch; it counts once your manager or HR approves it." to true
                    r.outside -> "${if (r.kind == "IN") "In" else "Out"} at ${r.time}${r.address?.let { " · $it" } ?: ""}. Recorded as a field punch." to true
                    else -> "${if (r.kind == "IN") "In" else "Out"} at ${r.time}${r.site?.let { " · $it" } ?: ""}. Recorded." to true
                }
                onPunched()
            } catch (e: SignedOut) {
                onSignedOut()
            } catch (e: ApiError) {
                message = (e.message ?: "Not recorded.") to false
            } catch (e: Exception) {
                message = "Not recorded. Try again." to false
            } finally {
                busy = false
            }
        }
    }
    val selfie = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bmp: Bitmap? ->
        if (bmp == null) {
            message = "No photo taken. Punch again, or untick the selfie." to false
        } else {
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
            send(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
        }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) {
            selfie.launch(null)
        } else {
            message = "Camera not allowed. Untick the selfie to punch without one." to false
        }
    }
    fun withPhoto() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) selfie.launch(null) else camera.launch(Manifest.permission.CAMERA)
    }
    val location = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            if (withSelfie) withPhoto() else send(null)
        } else {
            message = "Location is needed to check you are at a work site. Allow precise location in Settings, or punch at a reader." to false
        }
    }

    Section {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text(now.format(DateTimeFormatter.ofPattern("hh:mm:ss a")), fontSize = (30f / androidx.compose.ui.platform.LocalDensity.current.fontScale.coerceAtLeast(1f)).coerceAtLeast(22f).sp * androidx.compose.ui.platform.LocalDensity.current.fontScale.coerceAtMost(1.3f), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface, maxLines = 1)
                Text(state, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            record?.let { val (t, tone) = dayStatus(it.status); StatusPill(t, tone) }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Figure("Shift", if (shift.off || shift.holiday != null) "Off" else "${shift.startTime}–${shift.endTime}")
            Figure("In", record?.checkInTime ?: "—")
            Figure("Out", record?.checkOutTime ?: "—")
            Figure("Worked", if (record?.checkOutTime != null) hm(record.workedMinutes) else "—")
        }
        if ((record?.lateMinutes ?: 0) > 0) Hint("Late by ${record!!.lateMinutes} min today.", Warn)
        if (phone.allowed) {
            Button(
                onClick = {
                    val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    when {
                        !fine -> location.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                        withSelfie -> withPhoto()
                        else -> send(null)
                    }
                },
                enabled = !busy,
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().height(58.dp).padding(top = 4.dp),
            ) { Text(if (busy) "Checking your location…" else if (phone.next == "OUT") "Punch out" else "Punch in", style = MaterialTheme.typography.titleMedium) }
            if (field) {
                Box(Modifier.fillMaxWidth().background(Brand.copy(alpha = 0.08f), RoundedCornerShape(10.dp)).padding(10.dp)) {
                    Text("Field punch: you can punch wherever you are. Your location and its address are recorded${if (phone.selfieRequired) ", with a selfie" else ""}, and your manager or HR may need to approve it.", style = MaterialTheme.typography.bodySmall)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = withSelfie, onCheckedChange = { if (!phone.selfieRequired) withSelfie = it }, enabled = !phone.selfieRequired)
                Text(if (phone.selfieRequired) "Selfie required" else "Add a selfie", style = MaterialTheme.typography.bodyMedium)
                if (phone.sites.isNotEmpty() && !field) {
                    Icon(Icons.Outlined.LocationOn, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 12.dp).size(16.dp))
                    Text(phone.sites.joinToString { it.name }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
            message?.let { (text, ok) -> Text(text, color = if (ok) Pos else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        } else {
            /* No phone punching for this person: say so, and offer what they can do instead. */
            Box(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp)).padding(12.dp)) {
                Text(phone.why ?: "Punch at the reader at work. Punching from your phone is not switched on for you.", style = MaterialTheme.typography.bodyMedium)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onFix, modifier = Modifier.weight(1f)) { Text("Missed a punch") }
                OutlinedButton(onClick = onDuty, modifier = Modifier.weight(1f)) { Text("On duty") }
            }
            if (phone.why == null) Button(onClick = onAskPhone, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth()) { Text("Ask HR for phone punching") }
        }
        if (punches.isNotEmpty()) {
            Text("Today", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 6.dp))
            punches.forEach { p ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(8.dp).background(if (p.kind == "OUT") Neg else Pos, CircleShape))
                    Text("${p.time}  ${if (p.kind == "IN") "In" else if (p.kind == "OUT") "Out" else "Punch"}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    Text(if (p.phone) "${if (p.outside) "Field" else "Phone"}${p.site?.let { " · $it" } ?: ""}" else "Reader", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                    if (p.review == "PENDING") StatusPill("Waiting approval", Tone.Warn)
                    if (p.review == "REJECTED") StatusPill("Refused", Tone.Neg)
                }
            }
        }
    }
}

@Composable
private fun Figure(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Hint(label)
        Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
    }
}

/** Asks for notifications once, saying what they are for (Android 13 and later need the permission). */
@Composable
fun RemindersCard() {
    val context = LocalContext.current
    var allowed by remember { mutableStateOf(Reminders.allowed(context)) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        allowed = ok
        if (ok) Reminders.start(context)
    }
    if (allowed || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    Section {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconTile(Icons.Outlined.NotificationsActive, Brand)
            Column(Modifier.weight(1f)) {
                Text("Turn on reminders", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Hint("When your shift starts or ends without a punch, and when HR decides a request.")
            }
        }
        OutlinedButton(onClick = { ask.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Allow notifications") }
    }
}
