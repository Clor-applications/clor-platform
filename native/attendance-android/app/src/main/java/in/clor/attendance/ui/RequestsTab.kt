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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.BusinessCenter
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.ManageAccounts
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.Timer
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
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.Kinds
import `in`.clor.attendance.data.MyRequest
import `in`.clor.attendance.data.attendanceAsk
import `in`.clor.attendance.data.attendanceAskProblem
import `in`.clor.attendance.data.requestWords
import `in`.clor.attendance.data.usageLine
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZoneOffset

/** What a new request can be. `kind` is the attendance request kind it sends, for the four that are one. */
enum class NewKind(val title: String, val sub: String, val icon: ImageVector, val kind: String? = null) {
    Missed("Missed or wrong punch", "Forgot to punch, the reader was down, wrong shift", Icons.Outlined.EditCalendar, Kinds.MISSED),
    Wfh("Work from home", "A day, a few days or half a day at home", Icons.Outlined.Home, Kinds.WFH),
    OnDuty("On duty", "Working away from the site: a client visit, training, travel", Icons.Outlined.BusinessCenter, Kinds.ON_DUTY),
    Permission("Permission", "A few hours off during the day", Icons.Outlined.Timer, Kinds.PERMISSION),
    Leave("Leave", "Casual, sick, earned…", Icons.Outlined.EventAvailable),
    Details("Update my details", "Phone, address, emergency contact and the rest of my file", Icons.Outlined.ManageAccounts),
    Phone("Punch from my phone", "Ask HR to allow phone punching for you", Icons.Outlined.PhoneAndroid),
    Help("My data rights", "A data-protection concern, or correcting data held about me", Icons.Outlined.SupportAgent),
}

private val REASONS = listOf("FORGOT_PUNCH" to "Forgot to punch", "READER_DOWN" to "Reader not working", "WRONG_SHIFT" to "Wrong shift", "OTHER" to "Other")
private val zone: ZoneId = ZoneId.of("Asia/Kolkata")

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
    /** A day to fix, from Needs attention: the form opens on it, with the in time if one was recorded. */
    startDate: String? = null,
    startCheckIn: String? = null,
    openLeave: () -> Unit,
    onChanged: () -> Unit,
    onSignedOut: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var team by rememberSaveable { mutableStateOf(false) }
    var choosing by remember { mutableStateOf(false) }
    var form by remember { mutableStateOf<Pair<NewKind, MyRequest?>?>(null) }
    var message by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var confirming by remember { mutableStateOf<MyRequest?>(null) }
    val data = rememberLoad(onSignedOut, version) { api.requests() }
    /* Which attendance kinds the company has switched on: only those are offered. */
    val rules = rememberLoad(onSignedOut, version) { api.requestRules(YearMonth.now(zone).toString()) }
    val on = (rules.state as? Load.Ready)?.value?.kinds?.map { it.kind }?.toSet()
    LaunchedEffect(startNew) {
        if (startNew != null) {
            if (startNew == NewKind.Leave) openLeave() else form = startNew to startDate?.let { MyRequest(date = it, checkIn = startCheckIn) }
            onStarted()
        }
    }
    fun pick(k: NewKind) {
        choosing = false
        message = null
        when (k) {
            NewKind.Leave -> openLeave()
            else -> form = k to null
        }
    }
    fun withdraw(q: MyRequest) {
        scope.launch {
            attempt(onSignedOut, { message = it to false }) {
                when (q.kind) {
                    "leave" -> api.cancelLeave(q.id)
                    "overtime", "compoff" -> api.cancelOvertime(q.id)
                    else -> api.cancelRequest(q.id)
                }
                message = (if (q.status == "APPROVED") "Cancelled." else "Withdrawn.") to true
                data.reload()
                onChanged()
            }
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
            message?.let { (t, ok) -> Text(t, color = if (ok) Pos else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            when {
                team -> ApprovalsList(api, onSignedOut)
                form != null -> {
                    val (k, editing) = form!!
                    when (k) {
                        NewKind.Missed, NewKind.Wfh, NewKind.OnDuty, NewKind.Permission ->
                            AttendanceRequestForm(api, k.kind!!, editing, onDone = { msg -> form = null; message = msg to true; data.reload(); onChanged() }, onCancel = { form = null }, onSignedOut = onSignedOut)
                        NewKind.Details -> MyDetailsScreen(api, onBack = { form = null }, onSignedOut = onSignedOut)
                        NewKind.Help -> DataRequestForm(api, onDone = { msg -> form = null; message = msg to true; data.reload() }, onCancel = { form = null }, onSignedOut = onSignedOut)
                        NewKind.Phone -> PhoneAskForm(api, phoneAllowed, onDone = { msg -> form = null; message = msg to true }, onCancel = { form = null }, onSignedOut = onSignedOut)
                        NewKind.Leave -> Unit
                    }
                }
                else -> LoadView(data) { r ->
                    if (r.requests.isEmpty()) Section { Hint("Nothing asked for yet. Tap New request to fix a punch, work from home, go on duty, take leave or update your details.") }
                    r.requests.forEach { q ->
                        RequestCard(q,
                            onEdit = { message = null; form = (NewKind.entries.firstOrNull { it.kind != null && it.kind == (q.requestKind ?: Kinds.MISSED) } ?: NewKind.Missed) to q },
                            onChangeLeave = openLeave,
                            onCancel = { confirming = q },
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
    confirming?.let { q ->
        val approved = q.status == "APPROVED"
        ConfirmDialog(
            title = if (approved) "Cancel this request?" else "Withdraw this request?",
            text = if (approved) "It was approved; cancelling gives the days back." else null,
            confirm = if (approved) "Cancel request" else "Withdraw",
            onConfirm = { withdraw(q) },
            onDismiss = { confirming = null },
        )
    }
    if (choosing) {
        ModalBottomSheet(onDismissRequest = { choosing = false }) {
            Column(Modifier.padding(bottom = 28.dp)) {
                Text("New request", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                NewKind.entries
                    .filter { it != NewKind.Phone || !phoneAllowed }
                    /* Rules not loaded: offer them all, and the form says if a kind is off. */
                    .filter { it.kind == null || on == null || it.kind in on }
                    .forEach { k ->
                        ListItem(headlineContent = { Text(k.title) }, supportingContent = { Text(k.sub) }, leadingContent = { IconTile(k.icon, Brand) }, modifier = Modifier.clickable { pick(k) })
                    }
            }
        }
    }
}

@Composable
private fun RequestCard(q: MyRequest, onEdit: () -> Unit, onChangeLeave: () -> Unit, onCancel: () -> Unit) {
    val attendance = q.kind == "correction" || q.kind == "request"
    val title = when (q.kind) {
        "leave" -> "${q.leaveTypeName ?: "Leave"} · ${if (q.halfDay != null) "half day (${if (q.halfDay == "FIRST") "first" else "second"} half)" else q.days?.let { days(it) } ?: ""}"
        "overtime" -> "Overtime · ${hm(q.minutes)}"
        "compoff" -> "Comp-off · ${q.days?.let { days(it) } ?: ""}"
        "data" -> when (q.type) { "CORRECTION" -> "Correct my data"; "GRIEVANCE" -> "Concern raised"; "WITHDRAW" -> "Consent withdrawn"; "NOMINATE" -> "Nominee"; "ACCESS" -> "See my data"; "ERASURE" -> "Erase my data"; else -> "Data request" }
        "request" -> q.kindName ?: Kinds.name(q.requestKind.orEmpty())
        else -> when (q.reasonCode) { "ON_DUTY" -> "On duty"; "READER_DOWN" -> "Reader not working"; "WRONG_SHIFT" -> "Wrong shift"; "FORGOT_PUNCH" -> "Missed punch"; else -> "Missed punch" }
    }
    val sub = when (q.kind) {
        "leave" -> if (q.fromDate == q.toDate) shortDate(q.fromDate.orEmpty()) else "${shortDate(q.fromDate.orEmpty())} to ${shortDate(q.toDate.orEmpty())}"
        "data" -> q.dueAt?.let { "Answer by ${shortDate(it.take(10))}" } ?: ""
        "overtime", "compoff" -> shortDate(q.date.orEmpty())
        else -> requestWords(q)
    }
    /* Attendance requests say for themselves whether they can be withdrawn; for the rest, what can change can also be withdrawn. */
    val canWithdraw = if (attendance) q.canCancel else q.canChange
    val canEdit = attendance && q.canChange
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
        if (q.status != "REJECTED") q.note?.takeIf { it.isNotBlank() && q.status != "PENDING" }?.let { Hint("Note: $it") }
        Timeline(q.steps, q.next)
        if (canEdit || canWithdraw || (q.kind == "leave" && q.status == "PENDING")) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (canEdit) OutlinedButton(onClick = onEdit) { Text("Change") }
                if (q.kind == "leave" && q.status == "PENDING") OutlinedButton(onClick = onChangeLeave) { Text("Change under Leave") }
                if (canWithdraw) TextButton(onClick = onCancel) { Text(if (q.status == "APPROVED") "Cancel" else "Withdraw") }
            }
        }
    }
}

/**
 * A missed punch, work from home, on duty or permission: the same card as the
 * web app's Ask, with only the fields the kind takes and this month's "used /
 * left". Changing keeps the kind; the server checks the quota, the back-date
 * window and overlaps again.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AttendanceRequestForm(api: Api, startKind: String, start: MyRequest?, onDone: (String) -> Unit, onCancel: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    val editing = start?.takeIf { it.id.isNotEmpty() }
    var kind by remember { mutableStateOf(editing?.requestKind ?: startKind) }
    var date by remember { mutableStateOf(start?.date?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now(zone)) }
    var toDate by remember { mutableStateOf(editing?.toDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: date) }
    var half by remember { mutableStateOf(editing?.halfDay) }
    var place by remember { mutableStateOf(editing?.place.orEmpty()) }
    var picking by remember { mutableStateOf<String?>(null) }
    var checkIn by remember { mutableStateOf(start?.checkIn.orEmpty()) }
    var checkOut by remember { mutableStateOf(editing?.checkOut.orEmpty()) }
    var code by remember { mutableStateOf(editing?.reasonCode ?: "FORGOT_PUNCH") }
    var reason by remember { mutableStateOf(editing?.reason.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val spans = Kinds.spans(kind)
    val oneDay = !spans || toDate == date
    /* The quota line is for the month of the day asked for. */
    val month = YearMonth.from(date).toString()
    val rules = rememberLoad(onSignedOut, month) { api.requestRules(month) }
    val loaded = (rules.state as? Load.Ready)?.value
    val switchedOn = loaded?.kinds?.map { it.kind }
    val kindOff = switchedOn != null && kind !in switchedOn && editing == null
    val ask = attendanceAsk(kind, date.toString(), if (spans) toDate.toString() else null, if (oneDay) half else null, place, normalizeTime(checkIn), normalizeTime(checkOut), reason, code)
    val badTime = (checkIn.isNotBlank() && normalizeTime(checkIn) == null) || (checkOut.isNotBlank() && normalizeTime(checkOut) == null)
    val problem = if (badTime) "A time is not a time; use 24-hour, e.g. 09:10." else attendanceAskProblem(ask)
    Section(if (editing != null) "Change: ${editing.kindName ?: Kinds.name(kind)}" else "Ask") {
        if (editing == null && switchedOn != null && switchedOn.size > 1) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                loaded?.kinds.orEmpty().forEach { k -> FilterChip(selected = kind == k.kind, onClick = { kind = k.kind; error = null }, label = { Text(k.name, style = MaterialTheme.typography.labelMedium) }) }
            }
        }
        if (kindOff) {
            Text("${Kinds.name(kind)} requests are not switched on for your company. Ask HR if you need them.", style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = onCancel) { Text("Close") }
            return@Section
        }
        if (switchedOn != null && switchedOn.isEmpty() && editing == null) {
            Text("Nothing can be asked for right now.", style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = onCancel) { Text("Close") }
            return@Section
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { picking = "from" }, modifier = Modifier.weight(1f)) { Text(if (spans) "From ${shortDate(date.toString())}" else "Day: ${longDate(date.toString())}") }
            if (spans) OutlinedButton(onClick = { picking = "to" }, modifier = Modifier.weight(1f)) { Text("To ${shortDate(toDate.toString())}") }
        }
        if (spans && oneDay) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(null to "Whole day", "FIRST" to "First half", "SECOND" to "Second half").forEach { (k, label) ->
                    FilterChip(selected = half == k, onClick = { half = k }, label = { Text(label) })
                }
            }
        }
        if (kind == Kinds.ON_DUTY) {
            OutlinedTextField(place, { place = it.take(120) }, label = { Text("Place") }, placeholder = { Text("e.g. Client office, Peenya") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        if (kind == Kinds.MISSED) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                REASONS.forEach { (k, label) -> FilterChip(selected = code == k, onClick = { code = k }, label = { Text(label, style = MaterialTheme.typography.labelSmall) }) }
            }
        }
        if (Kinds.timed(kind)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TimeField(checkIn, { checkIn = it }, if (kind == Kinds.PERMISSION) "From" else "In", Modifier.weight(1f))
                TimeField(checkOut, { checkOut = it }, if (kind == Kinds.PERMISSION) "To" else "Out", Modifier.weight(1f), optional = kind == Kinds.MISSED)
            }
        }
        OutlinedTextField(reason, { reason = it.take(500) }, label = { Text("Why") }, placeholder = { Text(when (kind) { Kinds.MISSED -> "e.g. Reader was down at the gate"; Kinds.WFH -> "e.g. Plumber visit at home"; Kinds.ON_DUTY -> "e.g. Client visit"; else -> "e.g. Bank work" }) }, modifier = Modifier.fillMaxWidth(), minLines = 2)
        when (val s = rules.state) {
            is Load.Ready -> s.value.usage[kind]?.let { Hint(usageLine(it, kind)) }
            is Load.Failed -> FailedLine("Could not load this month's limits: ${s.message}", rules.reload)
            Load.Busy -> Unit
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        attempt(onSignedOut, { error = it }) {
                            if (editing != null) api.changeRequest(editing.id, ask) else api.askRequest(ask)
                            onDone(if (editing != null) "Changed. It waits for approval." else "Sent for approval. You will hear when it is decided.")
                        }
                        busy = false
                    }
                },
                enabled = !busy && problem == null,
            ) { Text(if (busy) "Sending…" else if (editing != null) "Save" else "Send") }
            TextButton(onClick = onCancel) { Text("Cancel") }
        }
        Hint(problem ?: "Your manager or HR decides.")
    }
    picking?.let { which ->
        val today = LocalDate.now(zone)
        val initial = if (which == "from") date else toDate
        val state = rememberDatePickerState(
            initialSelectedDateMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : androidx.compose.material3.SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                    val d = Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                    /* A missed punch is for a day that has happened; the last day is not before the first. */
                    return !(kind == Kinds.MISSED && d.isAfter(today)) && !(which == "to" && d.isBefore(date))
                }
            },
        )
        DatePickerDialog(
            onDismissRequest = { picking = null },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { ms ->
                        val d = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()
                        if (which == "from") {
                            date = d
                            if (toDate.isBefore(d)) toDate = d
                        } else {
                            toDate = d
                        }
                        Unit
                    }
                    picking = null
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { picking = null }) { Text("Cancel") } },
        ) { DatePicker(state = state) }
    }
}

/**
 * A data-protection request (DPDP): a concern, or correcting data held about
 * me. Answered within 30 days by law. Everyday changes to my phone or address
 * go through Update my details instead.
 */
@Composable
private fun DataRequestForm(api: Api, onDone: (String) -> Unit, onCancel: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    var type by remember { mutableStateOf("GRIEVANCE") }
    var text by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Section(NewKind.Help.title) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FilterChip(selected = type == "GRIEVANCE", onClick = { type = "GRIEVANCE" }, label = { Text("Raise a concern") })
            FilterChip(selected = type == "CORRECTION", onClick = { type = "CORRECTION" }, label = { Text("Correct data held about me") })
        }
        Hint("A data-protection request, answered within 30 days. To change your phone, address or emergency contact, use Update my details.")
        OutlinedTextField(text, { text = it.take(2000) }, label = { Text(if (type == "CORRECTION") "Which data is wrong, and what is right" else "Your concern") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                busy = true
                error = null
                scope.launch {
                    attempt(onSignedOut, { error = it }) {
                        api.askData(type, text.trim())
                        onDone("Sent to HR. The answer appears here.")
                    }
                    busy = false
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
    var error by remember { mutableStateOf<String?>(null) }
    Section("Punch from my phone") {
        if (allowed) Hint("Phone punching is already on for you.")
        else {
            Text("HR decides who may punch from a phone. Say why you need it, for example you work at client sites.", style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(note, { note = it.take(300) }, label = { Text("Why (optional)") }, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        attempt(onSignedOut, { error = it }) { onDone(api.askPhonePunch(note.trim().ifEmpty { null }).message) }
                        busy = false
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
