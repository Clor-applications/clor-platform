package `in`.clor.attendance.ui

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.core.content.ContextCompat
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.Locator
import `in`.clor.attendance.data.Me
import `in`.clor.attendance.data.Reminders
import `in`.clor.attendance.data.SignedOut
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream

/**
 * Today: the shift, one punch button, today's punches. The phone reads its
 * position once, when the button is pressed; the server stamps the time and
 * checks the site, and its answer is what the screen shows — never a guess.
 */
@Composable
fun TodayTab(api: Api, version: Int, onChanged: () -> Unit, onSignedOut: () -> Unit) {
    val me = rememberLoad(onSignedOut, version) { api.me() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        LoadView(me) { m ->
            Text(longDate(m.today), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Hint("${m.employee.name}${m.employee.code?.let { " · $it" } ?: ""} · ${m.company.name}")
            ShiftCard(m)
            if (m.phone.allowed) PunchCard(api, m, onPunched = { me.reload(); onChanged() }, onSignedOut) else Section { Text(m.phone.why ?: "Punch at the reader at work. Punching from your phone is not switched on for you.", style = MaterialTheme.typography.bodyMedium) }
            Section("Punches today") {
                if (m.punches.isEmpty()) Hint("None yet.")
                m.punches.forEach { p ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text(p.time, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text(listOfNotNull(if (p.kind == "IN") "In" else if (p.kind == "OUT") "Out" else null, if (p.phone) "Phone${p.site?.let { " · $it" } ?: ""}" else "Reader").joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            RemindersCard()
        }
    }
}

@Composable
private fun ShiftCard(m: Me) {
    val r = m.record
    Section {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(
                when {
                    m.shift.holiday != null -> "Holiday · ${m.shift.holiday}"
                    m.shift.off -> "Weekly off"
                    else -> "${m.shift.name} · ${m.shift.startTime}–${m.shift.endTime}"
                },
                style = MaterialTheme.typography.titleMedium,
            )
            r?.let { val (t, tone) = dayStatus(it.status); StatusPill(t, tone) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Figure("In", r?.checkInTime ?: "—")
            Figure("Out", r?.checkOutTime ?: "—")
            Figure("Worked", if (r?.checkOutTime != null) hm(r.workedMinutes) else "—")
        }
        if ((r?.lateMinutes ?: 0) > 0) Hint("Late by ${r!!.lateMinutes} min.", Warn)
    }
}

@Composable
private fun Figure(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Hint(label)
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun PunchCard(api: Api, m: Me, onPunched: () -> Unit, onSignedOut: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var withSelfie by remember { mutableStateOf(false) }
    val next = if (m.phone.next == "OUT") "Punch out" else "Punch in"

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
                message = "${if (r.kind == "IN") "In" else "Out"} at ${r.time}${r.site?.let { " · $it" } ?: ""}. Recorded." to true
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
            return@rememberLauncherForActivityResult
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
        send(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) selfie.launch(null) else message = "Camera not allowed. Untick the selfie to punch without one." to false
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
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) { Text(if (busy) "Checking your location…" else next, style = MaterialTheme.typography.titleMedium) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = withSelfie, onCheckedChange = { withSelfie = it })
            Text("Add a selfie", style = MaterialTheme.typography.bodyMedium)
        }
        message?.let { (text, ok) -> Text(text, color = if (ok) Pos else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        Hint(
            "Your location is read only when you press the button, to check you are at " +
                (m.phone.sites.joinToString { it.name }.ifEmpty { "a work site" }) +
                ". A selfie, if added, is kept for a short time and then deleted.",
        )
    }
}

/** Asks for notifications once, saying what they are for (Android 13 and later need the permission). */
@Composable
private fun RemindersCard() {
    val context = LocalContext.current
    var allowed by remember { mutableStateOf(Reminders.allowed(context)) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        allowed = ok
        if (ok) Reminders.start(context)
    }
    if (allowed || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    Section("Reminders") {
        Text("Get a reminder when your shift starts and you have not punched in, or it ended and you have not punched out, and word when HR decides a request.", style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = { ask.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Turn on reminders") }
    }
}
