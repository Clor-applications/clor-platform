package `in`.clor.attendance.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.BusinessCenter
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.ManageAccounts
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.MyRequest
import `in`.clor.attendance.data.SignedOut
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

/** What a new request can be. */
enum class NewKind(val title: String, val sub: String, val icon: ImageVector) {
    Missed("Missed or wrong punch", "Forgot to punch, the reader was down, wrong shift", Icons.Outlined.EditCalendar),
    OnDuty("On duty", "Working away from the site: a client visit, training, travel", Icons.Outlined.BusinessCenter),
    Leave("Leave", "Casual, sick, earned…", Icons.Outlined.EventAvailable),
    Details("Update my details", "Phone, address, bank or anything on my file", Icons.Outlined.ManageAccounts),
    Phone("Punch from my phone", "Ask HR to allow phone punching for you", Icons.Outlined.PhoneAndroid),
    Help("Raise a concern", "A complaint or question about my data", Icons.Outlined.SupportAgent),
}

private val REASONS = listOf("FORGOT_PUNCH" to "Forgot to punch", "READER_DOWN" to "Reader not working", "WRONG_SHIFT" to "Wrong shift", "OTHER" to "Other")

/**
 * Requests: everything I asked for, with what is still waiting changeable or
 * withdrawable, and a "New request" for each kind. Approvers also see what
 * their team is waiting on.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RequestsTab(
    api: Api,
    version: Int,
    approver: Boolean,
    phoneAllowed: Boolean,
    startNew: NewKind?,
    onStarted: () -> Unit,
    openLeave: () -> Unit,
    onChanged: () -> Unit,
    onSignedOut: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var team by rememberSaveable { mutableStateOf(false) }
    var choosing by remember { mutableStateOf(false) }
    var form by remember { mutableStateOf<Pair<NewKind, MyRequest?>?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    val data = rememberLoad(onSignedOut, version) { api.requests() }
    LaunchedEffect(startNew) {
        if (startNew != null) {
            if (startNew == NewKind.Leave) openLeave() else form = startNew to null
            onStarted()
        }
    }
    fun pick(k: NewKind) {
        choosing = false
        when (k) {
            NewKind.Leave -> openLeave()
            else -> form = k to null
        }
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Requests", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            if (approver) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SegmentedButton(selected = !team, onClick = { team = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Mine") }
                    SegmentedButton(selected = team, onClick = { team = true }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("My team") }
                }
            }
            message?.let { Text(it, color = Pos, style = MaterialTheme.typography.bodyMedium) }
            when {
                team -> ApprovalsList(api, onSignedOut)
                form != null -> {
                    val (k, editing) = form!!
                    when (k) {
                        NewKind.Missed, NewKind.OnDuty -> CorrectionRequestForm(api, k, editing, onDone = { msg -> form = null; message = msg; data.reload(); onChanged() }, onCancel = { form = null }, onSignedOut = onSignedOut)
                        NewKind.Details, NewKind.Help -> DataRequestForm(api, k, onDone = { msg -> form = null; message = msg; data.reload() }, onCancel = { form = null }, onSignedOut = onSignedOut)
                        NewKind.Phone -> PhoneAskForm(api, phoneAllowed, onDone = { msg -> form = null; message = msg }, onCancel = { form = null }, onSignedOut = onSignedOut)
                        NewKind.Leave -> Unit
                    }
                }
                else -> LoadView(data) { r ->
                    if (r.requests.isEmpty()) Section { Hint("Nothing asked for yet. Tap New request to fix a punch, go on duty, take leave or update your details.") }
                    r.requests.forEach { q ->
                        RequestCard(q,
                            onEdit = { form = (if (q.reasonCode == "ON_DUTY") NewKind.OnDuty else NewKind.Missed) to q },
                            onCancel = {
                                scope.launch {
                                    try {
                                        if (q.kind == "leave") api.cancelLeave(q.id) else api.cancelCorrection(q.id)
                                        message = "Withdrawn."
                                        data.reload()
                                        onChanged()
                                    } catch (e: SignedOut) {
                                        onSignedOut()
                                    } catch (e: ApiError) {
                                        message = e.message
                                    }
                                }
                            },
                        )
                    }
                }
            }
            Box(Modifier.padding(bottom = 72.dp))
        }
        if (!team && form == null) {
            ExtendedFloatingActionButton(
                onClick = { choosing = true },
                icon = { Icon(Icons.Outlined.Add, contentDescription = null) },
                text = { Text("New request") },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
            )
        }
    }
    if (choosing) {
        ModalBottomSheet(onDismissRequest = { choosing = false }) {
            Column(Modifier.padding(bottom = 28.dp)) {
                Text("New request", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                NewKind.entries.filter { it != NewKind.Phone || !phoneAllowed }.forEach { k ->
                    ListItem(headlineContent = { Text(k.title) }, supportingContent = { Text(k.sub) }, leadingContent = { IconTile(k.icon, Brand) }, modifier = Modifier.clickable { pick(k) })
                }
            }
        }
    }
}

@Composable
private fun RequestCard(q: MyRequest, onEdit: () -> Unit, onCancel: () -> Unit) {
    val title = when (q.kind) {
        "leave" -> "${q.leaveTypeName ?: "Leave"}${q.days?.let { " · ${days(it)}" } ?: ""}"
        "data" -> when (q.type) { "CORRECTION" -> "Update my details"; "GRIEVANCE" -> "Concern raised"; "WITHDRAW" -> "Consent withdrawn"; "NOMINATE" -> "Nominee"; "ACCESS" -> "See my data"; "ERASURE" -> "Erase my data"; else -> "Data request" }
        else -> when (q.reasonCode) { "ON_DUTY" -> "On duty"; "READER_DOWN" -> "Reader not working"; "WRONG_SHIFT" -> "Wrong shift"; "FORGOT_PUNCH" -> "Missed punch"; else -> "Attendance correction" }
    }
    val sub = when (q.kind) {
        "leave" -> if (q.fromDate == q.toDate) shortDate(q.fromDate.orEmpty()) else "${shortDate(q.fromDate.orEmpty())} to ${shortDate(q.toDate.orEmpty())}"
        "data" -> q.dueAt?.let { "Answer by ${shortDate(it.take(10))}" } ?: ""
        else -> "${shortDate(q.date.orEmpty())} · ${q.checkIn ?: "—"}${q.checkOut?.let { " – $it" } ?: ""}"
    }
    Section {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                if (sub.isNotEmpty()) Hint(sub)
            }
            val (t, tone) = requestStatus(q.status)
            StatusPill(t, tone)
        }
        q.reason?.takeIf { it.isNotBlank() }?.let { Text("“$it”", style = MaterialTheme.typography.bodyMedium) }
        q.note?.takeIf { it.isNotBlank() && q.status != "PENDING" }?.let { Hint("HR: $it") }
        if (q.canChange) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (q.kind == "correction") OutlinedButton(onClick = onEdit) { Text("Edit") }
                TextButton(onClick = onCancel) { Text(if (q.status == "APPROVED") "Cancel leave" else "Withdraw") }
            }
        }
    }
}

private val HHMM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

/** Missed / wrong punch, or on duty: a day, the times, and why. Editing keeps the day. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CorrectionRequestForm(api: Api, kind: NewKind, editing: MyRequest?, onDone: (String) -> Unit, onCancel: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    val zone = ZoneId.of("Asia/Kolkata")
    var date by remember { mutableStateOf(editing?.date?.let { LocalDate.parse(it) } ?: LocalDate.now(zone)) }
    var picking by remember { mutableStateOf(false) }
    var checkIn by remember { mutableStateOf(editing?.checkIn ?: if (kind == NewKind.OnDuty) "09:00" else "") }
    var checkOut by remember { mutableStateOf(editing?.checkOut ?: if (kind == NewKind.OnDuty) "18:00" else "") }
    var code by remember { mutableStateOf(editing?.reasonCode ?: if (kind == NewKind.OnDuty) "ON_DUTY" else "FORGOT_PUNCH") }
    var reason by remember { mutableStateOf(editing?.reason ?: "") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val okIn = HHMM.matches(checkIn)
    val okOut = checkOut.isEmpty() || HHMM.matches(checkOut)
    Section(if (editing != null) "Change request" else kind.title) {
        OutlinedButton(onClick = { picking = true }, enabled = editing == null, modifier = Modifier.fillMaxWidth()) { Text("Day: ${longDate(date.toString())}") }
        if (kind == NewKind.Missed) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                REASONS.forEach { (k, label) -> FilterChip(selected = code == k, onClick = { code = k }, label = { Text(label, style = MaterialTheme.typography.labelSmall) }) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(checkIn, { checkIn = it.take(5) }, label = { Text(if (kind == NewKind.OnDuty) "From" else "In (HH:MM)") }, singleLine = true, isError = checkIn.isNotEmpty() && !okIn, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            OutlinedTextField(checkOut, { checkOut = it.take(5) }, label = { Text(if (kind == NewKind.OnDuty) "To" else "Out (HH:MM)") }, singleLine = true, isError = !okOut, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        }
        OutlinedTextField(reason, { reason = it.take(500) }, label = { Text(if (kind == NewKind.OnDuty) "Where and why" else "What happened") }, placeholder = { Text(if (kind == NewKind.OnDuty) "e.g. Client visit, Peenya" else "e.g. Reader was down at the gate") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            if (editing != null) api.editCorrection(editing.id, checkIn, checkOut.ifEmpty { null }, reason.trim(), code)
                            else api.askCorrection(date.toString(), checkIn, checkOut.ifEmpty { null }, reason.trim(), code)
                            onDone(if (editing != null) "Changed." else "Sent. You will hear when it is decided.")
                        } catch (e: SignedOut) {
                            onSignedOut()
                        } catch (e: ApiError) {
                            error = e.message
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && okIn && okOut && reason.trim().length >= 3,
            ) { Text(if (editing != null) "Save" else "Send") }
            TextButton(onClick = onCancel) { Text("Cancel") }
        }
        Hint("Times are 24-hour, e.g. 09:05 and 18:30. Your manager or HR decides.")
    }
    if (picking) {
        val state = rememberDatePickerState(
            initialSelectedDateMillis = date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : androidx.compose.material3.SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = !Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate().isAfter(LocalDate.now(zone))
            },
        )
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = { TextButton(onClick = { state.selectedDateMillis?.let { date = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }; picking = false }) { Text("OK") } },
            dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel") } },
        ) { DatePicker(state = state) }
    }
}

/** Update my details, or raise a concern: goes to HR as a data request (answered within 30 days). */
@Composable
private fun DataRequestForm(api: Api, kind: NewKind, onDone: (String) -> Unit, onCancel: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Section(kind.title) {
        OutlinedTextField(text, { text = it.take(2000) }, label = { Text(if (kind == NewKind.Details) "What should change, and to what" else "Your concern") },
            placeholder = { Text(if (kind == NewKind.Details) "e.g. New phone: 98xxxxxx10. New address: …" else "") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                busy = true
                scope.launch {
                    try {
                        api.askData(if (kind == NewKind.Details) "CORRECTION" else "GRIEVANCE", text.trim())
                        onDone("Sent to HR. The answer appears here.")
                    } catch (e: SignedOut) {
                        onSignedOut()
                    } catch (e: ApiError) {
                        error = e.message
                    } finally {
                        busy = false
                    }
                }
            }, enabled = !busy && text.trim().length >= 3) { Text("Send to HR") }
            TextButton(onClick = onCancel) { Text("Cancel") }
        }
    }
}

@Composable
private fun PhoneAskForm(api: Api, allowed: Boolean, onDone: (String) -> Unit, onCancel: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    Section("Punch from my phone") {
        if (allowed) Hint("Phone punching is already on for you.")
        else {
            Text("HR decides who may punch from a phone. Say why you need it, for example you work at client sites.", style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(note, { note = it.take(300) }, label = { Text("Why (optional)") }, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    busy = true
                    scope.launch {
                        try {
                            onDone(api.askPhonePunch(note.trim().ifEmpty { null }).message)
                        } catch (e: SignedOut) {
                            onSignedOut()
                        } catch (e: ApiError) {
                            onDone(e.message ?: "Not sent.")
                        } finally {
                            busy = false
                        }
                    }
                }, enabled = !busy) { Text("Ask HR") }
                TextButton(onClick = onCancel) { Text("Cancel") }
            }
        }
    }
}

/** What my team is waiting on: the approvals list, inside Requests. */
@Composable
private fun ApprovalsList(api: Api, onSignedOut: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { ApprovalsContent(api, onSignedOut) }
}

@Composable
fun SmallBadge(text: String) {
    Box(Modifier.background(Brand.copy(alpha = 0.12f), RoundedCornerShape(6.dp)).border(1.dp, Brand.copy(alpha = 0.3f), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp)) {
        Text(text, color = Brand, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
    }
}
