package `in`.clor.attendance.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.Ask
import `in`.clor.attendance.data.SignedOut
import kotlinx.coroutines.launch

/** Leave and corrections from the people who report to me. The server checks each decision is mine to make. */
@Composable
fun ApprovalsTab(api: Api, onSignedOut: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Waiting on you", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        ApprovalsContent(api, onSignedOut)
    }
}

/** The list itself, also shown under Requests → My team. */
@Composable
fun ApprovalsContent(api: Api, onSignedOut: () -> Unit) {
    val data = rememberLoad(onSignedOut) { api.approvals() }
    LoadView(data) { a ->
        val all = a.leaves + a.corrections + a.punches
        if (all.isEmpty()) Section { Hint("Nothing waiting. Requests from people who report to you appear here.") }
        all.forEach { ask -> AskCard(api, ask, onDecided = data.reload, onSignedOut = onSignedOut) }
    }
}

@Composable
private fun AskCard(api: Api, ask: Ask, onDecided: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun decide(approve: Boolean) {
        busy = true
        error = null
        scope.launch {
            try {
                api.decide(ask.type, ask.id, approve, note.trim().ifEmpty { null })
                onDecided()
            } catch (e: SignedOut) {
                onSignedOut()
            } catch (e: ApiError) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }
    Section(when (ask.type) { "leave" -> "Leave · ${ask.employeeName}"; "punch" -> "Field punch · ${ask.employeeName}"; else -> "Correction · ${ask.employeeName}" }) {
        if (ask.type == "punch") {
            Text("${shortDate(ask.date.orEmpty())} · ${if (ask.kind == "OUT") "Out" else "In"} at ${ask.checkIn ?: "—"}", style = MaterialTheme.typography.bodyLarge)
            FieldEvidence(api, ask)
        } else if (ask.type == "leave") {
            Text("${ask.leaveTypeName ?: "Leave"} · ${ask.days?.let { days(it) } ?: ""}", style = MaterialTheme.typography.bodyLarge)
            Hint(if (ask.fromDate == ask.toDate) shortDate(ask.fromDate.orEmpty()) else "${shortDate(ask.fromDate.orEmpty())} to ${shortDate(ask.toDate.orEmpty())}")
        } else {
            Text("${shortDate(ask.date.orEmpty())} · in ${ask.checkIn ?: "—"}${ask.checkOut?.let { ", out $it" } ?: ""}", style = MaterialTheme.typography.bodyLarge)
        }
        ask.reason?.let { Text("“$it”", style = MaterialTheme.typography.bodyMedium) }
        OutlinedTextField(note, { note = it.take(500) }, label = { Text("Note (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { decide(true) }, enabled = !busy) { Text("Approve") }
            OutlinedButton(onClick = { decide(false) }, enabled = !busy) { Text("Decline") }
        }
    }
}

/** For a field punch: where it was made (open in the phone's map app) and the selfie, so it can be judged from afar. */
@Composable
private fun FieldEvidence(api: Api, ask: Ask) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var photo by remember { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    var showing by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    ask.accuracy?.let { Hint("Location accurate to about $it m") }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (ask.latitude != null && ask.longitude != null) {
            OutlinedButton(onClick = {
                val uri = android.net.Uri.parse("geo:${ask.latitude},${ask.longitude}?q=${ask.latitude},${ask.longitude}(${android.net.Uri.encode(ask.employeeName)})")
                runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, uri)) }
                    .onFailure { runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://www.openstreetmap.org/?mlat=${ask.latitude}&mlon=${ask.longitude}#map=18/${ask.latitude}/${ask.longitude}"))) } }
            }) { Text("View on map") }
        }
        if (ask.photo) {
            OutlinedButton(onClick = {
                scope.launch {
                    try {
                        val data = api.punchPhoto(ask.id).photo
                        val bytes = android.util.Base64.decode(data.substringAfter(","), android.util.Base64.DEFAULT)
                        photo = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                        showing = photo != null
                        if (photo == null) problem = "The selfie could not be read."
                    } catch (e: Exception) {
                        problem = e.message ?: "The selfie could not be loaded."
                    }
                }
            }) { Text("View selfie") }
        }
    }
    problem?.let { Hint(it, MaterialTheme.colorScheme.error) }
    if (showing && photo != null) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showing = false },
            confirmButton = { androidx.compose.material3.TextButton(onClick = { showing = false }) { Text("Close") } },
            title = { Text("${ask.employeeName} · ${ask.checkIn ?: ""}") },
            text = { androidx.compose.foundation.Image(photo!!, contentDescription = "Selfie with the punch", modifier = Modifier.fillMaxWidth()) },
        )
    }
}
