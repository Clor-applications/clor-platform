package `in`.clor.attendance.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.DetailFields
import `in`.clor.attendance.data.MyDetails
import `in`.clor.attendance.data.SelfRequest
import `in`.clor.attendance.data.Terms
import `in`.clor.attendance.data.detailsSavedWords
import `in`.clor.attendance.data.fullDayWords
import kotlinx.coroutines.launch

/**
 * My details (server: routes/peoplePortal.ts, the web app's MyDetails.jsx):
 * my job in words, my personal details and a way to change them, and my
 * requests to HR with HR's answer. Contact details save at once (by the
 * company's setting); the rest goes to HR as a change request — never a
 * data-protection request.
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
            Hint("A new photo is changed in the web app for now.")
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
