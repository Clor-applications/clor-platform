package `in`.clor.attendance.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.DetailFields
import `in`.clor.attendance.data.MyDetails
import `in`.clor.attendance.data.PhotoUnreadable
import `in`.clor.attendance.data.Photos
import `in`.clor.attendance.data.SelfRequest
import `in`.clor.attendance.data.Terms
import `in`.clor.attendance.data.detailsSavedWords
import `in`.clor.attendance.data.fullDayWords
import `in`.clor.attendance.data.photoWaiting
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * My details (server: routes/peoplePortal.ts, the web app's MyDetails.jsx):
 * my job in words, my personal details and a way to change them, and my
 * requests to HR with HR's answer. Contact details save at once (by the
 * company's setting); the rest, and a new photo, goes to HR as a change
 * request — never a data-protection request.
 */
@Composable
fun MyDetailsScreen(api: Api, onBack: () -> Unit, onSignedOut: () -> Unit) {
    val data = rememberLoad(onSignedOut) { api.myDetails() }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") }
            Text("My details", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        note?.let { (t, ok) -> Text(t, color = if (ok) Pos else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        LoadView(data) { d ->
            d.terms?.let { MyJob(it) }
            PersonalDetails(api, d, onSaved = { note = it to true; data.reload() }, onSignedOut = onSignedOut)
            NewPhoto(api, d, onSent = { note = it to true; data.reload() }, onSignedOut = onSignedOut)
            MyAsks(api, d.requests, onChanged = { msg -> note = msg; data.reload() }, onSignedOut = onSignedOut)
        }
    }
}

@Composable
private fun Line(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1.4f))
    }
}

@Composable
private fun MyJob(t: Terms) {
    val rows = listOfNotNull(
        t.designation?.let { "Job title" to it },
        t.department?.let { "Department" to it },
        listOfNotNull(t.employmentType, t.hours).joinToString(" · ").takeIf { it.isNotEmpty() }?.let { "Employment" to it },
        t.worksAt?.let { "Works at" to it },
        t.workMode?.let { "Work mode" to it },
        t.manager?.let { "Reporting manager" to it },
        t.departmentHead?.let { "Department head" to it },
        t.joinedOn?.let { "Joined" to fullDayWords(it) },
        t.confirmedOn?.let { "Confirmed" to fullDayWords(it) } ?: t.probationEndsOn?.let { "Probation ends" to fullDayWords(it) },
        t.contractEndsOn?.let { "Contract ends" to fullDayWords(it) },
        t.lastDay?.let { "Last working day" to fullDayWords(it) },
    )
    if (rows.isEmpty()) return
    Section("My job") {
        rows.forEachIndexed { i, (k, v) ->
            if (i > 0) HorizontalDivider()
            Line(k, v)
        }
    }
}

@Composable
private fun PersonalDetails(api: Api, d: MyDetails, onSaved: (String) -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf(false) }
    val form = remember { mutableStateMapOf<String, String>() }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Section("Personal details") {
        Hint(d.rule())
        if (!editing) {
            val filled = DetailFields.ORDER.filter { !d.fields[it].isNullOrBlank() }
            if (filled.isEmpty()) Hint("Nothing on file yet.")
            filled.forEachIndexed { i, k ->
                if (i > 0) HorizontalDivider()
                Line(d.label(k), DetailFields.shown(k, d.fields[k]))
            }
            OutlinedButton(onClick = {
                form.clear()
                DetailFields.ORDER.forEach { form[it] = d.fields[it].orEmpty() }
                error = null
                editing = true
            }) { Text(if (d.savesAtOnce.isEmpty()) "Ask HR to change" else "Change details") }
        } else {
            DetailFields.ORDER.forEach { k ->
                val choices = DetailFields.choices(k)
                if (choices != null) {
                    Text(d.label(k), style = MaterialTheme.typography.labelLarge)
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        choices.forEach { (v, label) -> FilterChip(selected = (form[k] ?: "") == v, onClick = { form[k] = v }, label = { Text(label) }) }
                    }
                } else {
                    val type = when {
                        k.contains("phone", ignoreCase = true) -> KeyboardType.Phone
                        k == "personalEmail" -> KeyboardType.Email
                        k == "pincode" -> KeyboardType.Number
                        else -> KeyboardType.Text
                    }
                    OutlinedTextField(
                        value = form[k] ?: "",
                        onValueChange = { form[k] = it.take(200) },
                        label = { Text(d.label(k)) },
                        placeholder = if (k == "dateOfBirth") ({ Text("YYYY-MM-DD") }) else null,
                        singleLine = k != "addressLine",
                        keyboardOptions = KeyboardOptions(keyboardType = type),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            val changes = DetailFields.changed(d.fields, form.toMap())
            val badDate = changes["dateOfBirth"]?.let { it.isNotEmpty() && runCatching { java.time.LocalDate.parse(it) }.isFailure } == true
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (badDate) Hint("Write the date of birth as YYYY-MM-DD, e.g. 1990-04-21.", MaterialTheme.colorScheme.error)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        attempt(onSignedOut, { error = it }) {
                            val r = api.changeDetails(changes)
                            editing = false
                            onSaved(detailsSavedWords(r, d))
                        }
                        busy = false
                    }
                }, enabled = !busy && changes.isNotEmpty() && !badDate) { Text(if (busy) "Sending…" else "Save changes") }
                TextButton(onClick = { editing = false }) { Text("Cancel") }
            }
        }
    }
}

/** A picked or taken picture, made small on the phone, and its preview. */
private class Chosen(val dataUrl: String, val preview: ImageBitmap)

/**
 * A new photo (the web app's "New photo" in My details): from the gallery
 * through the Photo Picker (no permission) or a picture from the camera app
 * (the camera permission, asked only then). It is made small here, shown, and
 * sent as a change request; HR decides it, and while they do it shows as
 * waiting and no second one can be asked for.
 */
@Composable
private fun NewPhoto(api: Api, d: MyDetails, onSent: (String) -> Unit, onSignedOut: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var chosen by remember { mutableStateOf<Chosen?>(null) }
    var reading by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    /* What went wrong, and what Try again does: read the same picture again, open the camera again, or send again. */
    var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableStateOf<(() -> Unit)?>(null) }
    /* Where the camera app writes; kept if the app is closed behind the camera. */
    var cameraUri by rememberSaveable { mutableStateOf<String?>(null) }

    fun read(uri: Uri, fromCamera: Boolean) {
        reading = true
        error = null
        retry = null
        scope.launch {
            try {
                val (url, bytes) = withContext(Dispatchers.Default) { Photos.shrink(context, uri) }
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw PhotoUnreadable("That photo could not be read. Choose another.")
                chosen = Chosen(url, bmp.asImageBitmap())
                if (fromCamera) withContext(Dispatchers.IO) { Photos.clearCamera(context) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: PhotoUnreadable) {
                error = e.message
                retry = { read(uri, fromCamera) }
            } catch (e: OutOfMemoryError) {
                error = "That photo is too big for this phone to open. Choose a smaller one."
            } catch (e: Exception) {
                error = "That photo could not be read. Try again, or choose another."
                retry = { read(uri, fromCamera) }
            } finally {
                reading = false
            }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) read(uri, fromCamera = false) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken ->
        val uri = cameraUri?.let(Uri::parse)
        if (taken && uri != null) read(uri, fromCamera = true) else Photos.clearCamera(context)
        cameraUri = null
    }
    fun openCamera() {
        error = null
        retry = null
        try {
            val uri = Photos.cameraTarget(context)
            cameraUri = uri.toString()
            camera.launch(uri)
        } catch (e: ActivityNotFoundException) {
            cameraUri = null
            error = "This phone has no camera app to take a picture with. Choose one from your photos instead."
        } catch (e: Exception) {
            cameraUri = null
            error = "The camera could not be opened. Try again, or choose from your photos."
            retry = { openCamera() }
        }
    }
    val allowCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) {
            openCamera()
        } else {
            error = "Camera not allowed. Choose a photo from your gallery, or allow the camera in Settings."
        }
    }
    fun takePicture() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) openCamera() else allowCamera.launch(Manifest.permission.CAMERA)
    }
    fun send(c: Chosen) {
        sending = true
        error = null
        retry = null
        scope.launch {
            attempt(onSignedOut, { error = it; retry = { send(c) } }) {
                val r = api.changeDetails(emptyMap(), c.dataUrl)
                chosen = null
                onSent(detailsSavedWords(r, d))
            }
            sending = false
        }
    }

    val waiting = d.photoWaiting()
    Section("Photo") {
        if (waiting != null) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("New photo sent", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                StatusPill(if (waiting.status == "MORE_INFO") "HR asked for more" else "Waiting for HR", Tone.Warn)
            }
            Hint(
                if (waiting.status == "MORE_INFO") "HR need more from you before they decide. Answer under My requests."
                else "HR check it before it shows, within ${d.hrDecidesWithinDays} working days. To send a different one, withdraw this under My requests.",
            )
            return@Section
        }
        val c = chosen
        if (c != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Image(c.preview, contentDescription = "Your new photo", contentScale = ContentScale.Crop, modifier = Modifier.size(96.dp).clip(RoundedCornerShape(12.dp)))
                Text(
                    "This is the photo that will be sent. HR check it before it shows.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
            }
        } else {
            Hint("${if (d.hasPhoto) "" else "No photo on file yet. "}A new photo goes to HR, who decide within ${d.hrDecidesWithinDays} working days.")
        }
        if (reading) Hint("Getting the photo ready…")
        error?.let { msg ->
            Text(msg, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            retry?.let { again -> OutlinedButton(onClick = again, enabled = !reading && !sending) { Text("Try again") } }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (c != null) {
                Button(onClick = { send(c) }, enabled = !sending && !reading) { Text(if (sending) "Sending…" else "Send to HR") }
                TextButton(onClick = { chosen = null; error = null; retry = null }, enabled = !sending) { Text("Cancel") }
            } else {
                OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !reading) { Text("Choose a photo") }
                OutlinedButton(onClick = { takePicture() }, enabled = !reading) { Text("Take a picture") }
            }
        }
    }
}

/** What I asked HR about myself, where it stands, what HR said; answer them or withdraw. */
@Composable
private fun MyAsks(api: Api, requests: List<SelfRequest>, onChanged: (Pair<String, Boolean>) -> Unit, onSignedOut: () -> Unit) {
    if (requests.isEmpty()) return
    val scope = rememberCoroutineScope()
    val answers = remember { mutableStateMapOf<String, String>() }
    var confirming by remember { mutableStateOf<SelfRequest?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    Section("My requests to HR") {
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        requests.forEachIndexed { i, r ->
            if (i > 0) HorizontalDivider()
            Column(Modifier.padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(if (r.kind == "LEAVING") "Resignation" else "Change to my details", style = MaterialTheme.typography.titleSmall)
                        r.createdAt?.let { Hint("Asked ${fullDayWords(it)}") }
                    }
                    StatusPill(r.statusLabel.ifEmpty { r.status }, when (r.status) { "APPROVED" -> Tone.Pos; "REJECTED" -> Tone.Neg; "WAITING", "MORE_INFO" -> Tone.Warn; else -> Tone.Neutral })
                }
                r.asked.forEach { a -> Hint("${a.label}: ${if (a.field == "photoUrl") "new photo" else DetailFields.shown(a.field, a.value)}") }
                r.comment?.let { Text("${it.by.ifEmpty { "HR" }}: ${it.text}", style = MaterialTheme.typography.bodyMedium) }
                r.replies.forEach { Hint("You answered: ${it.note}") }
                if (r.canReply) {
                    OutlinedTextField(answers[r.id] ?: "", { answers[r.id] = it.take(1000) }, label = { Text("Your answer") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                    OutlinedButton(onClick = {
                        error = null
                        scope.launch {
                            attempt(onSignedOut, { error = it }) {
                                api.answerMyRequest(r.id, answers[r.id].orEmpty().trim())
                                answers[r.id] = ""
                                onChanged("Answer sent to HR." to true)
                            }
                        }
                    }, enabled = !answers[r.id].isNullOrBlank()) { Text("Send answer") }
                }
                if (r.canWithdraw) TextButton(onClick = { confirming = r }) { Text("Withdraw") }
            }
        }
    }
    confirming?.let { r ->
        ConfirmDialog("Withdraw this request?", "HR will no longer decide it. You can ask again later.", "Withdraw", onConfirm = {
            error = null
            scope.launch { attempt(onSignedOut, { error = it }) { api.withdrawMyRequest(r.id); onChanged("Withdrawn." to true) } }
        }, onDismiss = { confirming = null })
    }
}
