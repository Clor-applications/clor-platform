package `in`.clor.attendance.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.LeaveAsk
import `in`.clor.attendance.data.LeavePreview
import `in`.clor.attendance.data.LeaveRequest
import `in`.clor.attendance.data.LeaveType
import `in`.clor.attendance.data.PreviewType
import `in`.clor.attendance.data.SignedOut
import `in`.clor.attendance.data.canCancelLeave
import `in`.clor.attendance.data.canShorten
import `in`.clor.attendance.data.dayBefore
import `in`.clor.attendance.data.fullDayWords
import `in`.clor.attendance.data.previewLines
import `in`.clor.attendance.data.sentWords
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

private val ist: ZoneId = ZoneId.of("Asia/Kolkata")

/**
 * Balances (any leave year), asking for leave with the date-by-date preview,
 * what I asked for (change while it waits, came back early, cancel), and the
 * restricted holidays to pick.
 */
@Composable
fun LeaveTab(api: Api, version: Int, onChanged: () -> Unit, onSignedOut: () -> Unit, startApplying: Boolean = false, onApplyShown: () -> Unit = {}) {
    val scope = rememberCoroutineScope()
    /* Null: the current leave year, as the server counts it. */
    var year by remember { mutableStateOf<Int?>(null) }
    val data = rememberLoad(onSignedOut, version, year) { api.leave(year) }
    var asking by remember { mutableStateOf(startApplying) }
    var editing by remember { mutableStateOf<LeaveRequest?>(null) }
    var shortening by remember { mutableStateOf<LeaveRequest?>(null) }
    var cancelling by remember { mutableStateOf<LeaveRequest?>(null) }
    LaunchedEffect(startApplying) { if (startApplying) { asking = true; onApplyShown() } }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    fun done(msg: String) {
        note = msg to true
        asking = false
        editing = null
        data.reload()
        onChanged()
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        LoadView(data) { l ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                IconButton(onClick = { year = l.year - 1 }) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, contentDescription = "Previous leave year") }
                Text("Leave ${l.year}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                IconButton(onClick = { year = l.year + 1 }) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = "Next leave year") }
            }
            Section("Balance") {
                if (l.types.isEmpty()) Hint("No leave types are set up for you.")
                l.types.forEachIndexed { i, t ->
                    if (i > 0) HorizontalDivider()
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(t.name, style = MaterialTheme.typography.bodyLarge)
                            Hint("Taken ${days(t.used)}${if (t.pending > 0) " · waiting ${days(t.pending)}" else ""}${if (!t.isPaid) " · unpaid" else ""}")
                        }
                        Text(t.available?.let { days(it) + " left" } ?: "No limit", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            note?.let { (t, ok) -> Text(t, color = if (ok) Pos else MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            if ((asking || editing != null) && l.types.isEmpty()) {
                Section("Apply for leave") {
                    Text("No leave types are set up for your company yet, so leave cannot be applied for. Ask HR to add them (Attendance → Leave types).", style = MaterialTheme.typography.bodyMedium)
                    TextButton(onClick = { asking = false }) { Text("Close") }
                }
            } else if (asking || editing != null) {
                LeaveForm(api, l.types, editing, onDone = { done(it) }, onCancel = { asking = false; editing = null }, onSignedOut = onSignedOut)
            } else if (l.types.isNotEmpty()) {
                Button(onClick = { note = null; asking = true }, modifier = Modifier.fillMaxWidth()) { Text("Apply for leave") }
            }
            Section("My requests") {
                if (l.requests.isEmpty()) Hint("Nothing asked for in this leave year.")
                l.requests.forEachIndexed { i, r ->
                    if (i > 0) HorizontalDivider()
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f)) {
                            Text("${r.leaveTypeName ?: "Leave"} · ${if (r.halfDay != null) "half day (${if (r.halfDay == "FIRST") "first" else "second"} half)" else days(r.days)}", style = MaterialTheme.typography.bodyLarge)
                            Hint(if (r.fromDate == r.toDate) shortDate(r.fromDate) else "${shortDate(r.fromDate)} to ${shortDate(r.toDate)}")
                            if (r.groupId != null) Hint("Part of a leave across the leave-year end")
                            r.note?.takeIf { it.isNotBlank() && r.status != "PENDING" }?.let { Hint("“$it”") }
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            val (t, tone) = requestStatus(r.status)
                            StatusPill(t, tone)
                            if (r.status == "PENDING" && editing?.id != r.id) TextButton(onClick = { note = null; asking = false; editing = r }) { Text("Change") }
                            if (canShorten(r, l.today)) TextButton(onClick = { note = null; shortening = r }) { Text("Came back early") }
                            if (canCancelLeave(r, l.today)) TextButton(onClick = { cancelling = r }) { Text("Cancel") }
                        }
                    }
                }
            }
            RestrictedHolidaysSection(api, version, onNote = { note = it }, onSignedOut = onSignedOut)
        }
    }
    cancelling?.let { r ->
        ConfirmDialog(
            title = if (r.status == "APPROVED") "Cancel this leave?" else "Withdraw this request?",
            text = "${r.leaveTypeName ?: "Leave"}, ${if (r.fromDate == r.toDate) shortDate(r.fromDate) else "${shortDate(r.fromDate)} to ${shortDate(r.toDate)}"}.",
            confirm = if (r.status == "APPROVED") "Cancel leave" else "Withdraw",
            onConfirm = { scope.launch { attempt(onSignedOut, { note = it to false }) { api.cancelLeave(r.id); done(if (r.status == "APPROVED") "Leave cancelled; the days are back." else "Withdrawn.") } } },
            onDismiss = { cancelling = null },
        )
    }
    shortening?.let { r -> ShortenDialog(r, onDismiss = { shortening = null }) { to ->
        shortening = null
        scope.launch { attempt(onSignedOut, { note = it to false }) { api.shortenLeave(r.id, to); done("Welcome back. Your leave now ends ${fullDayWords(to)}; the days after it are back in your balance.") } }
    } }
}

/** Came back early: the last day of leave, from its first day to the day before it was to end. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ShortenDialog(r: LeaveRequest, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val first = LocalDate.parse(r.fromDate)
    val last = LocalDate.parse(dayBefore(r.toDate))
    val today = LocalDate.now(ist)
    val start = if (today.isBefore(first)) first else if (today.isAfter(last)) last else today.minusDays(if (today.isAfter(first)) 1 else 0)
    val state = rememberDatePickerState(
        initialSelectedDateMillis = start.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
        selectableDates = object : androidx.compose.material3.SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                val d = Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                return !d.isBefore(first) && !d.isAfter(last)
            }
        },
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) } ?: onDismiss() }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    ) {
        Text("Last day of leave", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 24.dp, top = 16.dp))
        DatePicker(state = state)
    }
}

/**
 * Asking for leave, or changing a waiting request. As the type and dates are
 * picked the server works out what it would charge (POST /leave/preview):
 * the dates counted and skipped, the split at the leave-year end, the
 * balance after, and anything stopping it. Half day only where the type
 * allows it; a reason only where the type is not private.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LeaveForm(api: Api, types: List<LeaveType>, editing: LeaveRequest?, onDone: (String) -> Unit, onCancel: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    val today = LocalDate.now(ist)
    var type by remember(editing?.id) { mutableStateOf(editing?.let { e -> types.firstOrNull { it.id == e.leaveTypeId || it.name == e.leaveTypeName } } ?: types.first()) }
    var typeOpen by remember { mutableStateOf(false) }
    var from by remember(editing?.id) { mutableStateOf(editing?.let { LocalDate.parse(it.fromDate) } ?: today) }
    var to by remember(editing?.id) { mutableStateOf(editing?.let { LocalDate.parse(it.toDate) } ?: today) }
    var picking by remember { mutableStateOf<String?>(null) }
    var reason by remember(editing?.id) { mutableStateOf(editing?.reason.orEmpty()) }
    /* Null = whole day(s); FIRST / SECOND = that half of a single day. */
    var half by remember(editing?.id) { mutableStateOf(editing?.halfDay) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    /* The newest preview, and the type it last told us about (half day allowed, private). */
    var got by remember { mutableStateOf<Pair<String, LeavePreview>?>(null) }
    var previewFailed by remember { mutableStateOf<Pair<String, String>?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    var known by remember { mutableStateOf<PreviewType?>(null) }
    val typeInfo = known?.takeIf { it.id == type.id }
    val halfOf = if (from == to && typeInfo?.allowHalfDay == true) half else null
    val reasonNeeded = typeInfo?.isPrivate != true
    val key = "${type.id}|$from|$to|$halfOf|${editing?.id}"
    LaunchedEffect(key, retry) {
        previewFailed = null
        delay(300)
        try {
            val p = api.previewLeave(LeaveAsk(type.id, from.toString(), to.toString(), halfDay = halfOf, editing = editing?.id))
            got = key to p
            p.type?.let { known = it }
        } catch (e: SignedOut) {
            onSignedOut()
        } catch (e: ApiError) {
            previewFailed = key to (e.message ?: "The days could not be worked out.")
        }
    }
    val preview = got?.takeIf { it.first == key }?.second
    val failed = previewFailed?.takeIf { it.first == key }?.second
    val reasonOk = !reasonNeeded || reason.trim().length >= 3
    Section(if (editing != null) "Change leave" else "Apply for leave") {
        ExposedDropdownMenuBox(expanded = typeOpen, onExpandedChange = { typeOpen = it }) {
            OutlinedTextField(
                value = type.name,
                onValueChange = {},
                readOnly = true,
                label = { Text("Type") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = typeOpen) },
                modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
            )
            ExposedDropdownMenu(expanded = typeOpen, onDismissRequest = { typeOpen = false }) {
                types.forEach { t ->
                    DropdownMenuItem(text = { Text("${t.name}${t.available?.let { " · ${days(it)} left" } ?: ""}") }, onClick = { type = t; half = null; typeOpen = false })
                }
            }
        }
        if (editing == null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(onClick = { from = today; to = today }, label = { Text("Today") })
                AssistChip(onClick = { from = today.plusDays(1); to = today.plusDays(1) }, label = { Text("Tomorrow") })
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { picking = "from" }, modifier = Modifier.weight(1f)) { Text("From ${shortDate(from.toString())}") }
            OutlinedButton(onClick = { picking = "to" }, modifier = Modifier.weight(1f)) { Text("To ${shortDate(to.toString())}") }
        }
        if (from == to && typeInfo?.allowHalfDay == true) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(null to "Full day", "FIRST" to "First half", "SECOND" to "Second half").forEach { (k, label) ->
                    FilterChip(selected = half == k, onClick = { half = k }, label = { Text(label) })
                }
            }
            if (halfOf != null) Hint("Half a day of leave. Punch for the other half: worked, the day counts in full; not worked, it is a half day.")
        }
        OutlinedTextField(reason, { reason = it.take(500) }, label = { Text(if (reasonNeeded) "Reason" else "Reason (optional)") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
        if (!reasonNeeded) Hint("This leave is private: the reason is yours to give or not.")
        when {
            failed != null -> FailedLine(failed) { retry++ }
            preview == null -> Hint("Working out the days…")
            else -> {
                previewLines(preview).forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
                preview.problems.forEach { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    val p = preview ?: return@Button
                    busy = true
                    error = null
                    scope.launch {
                        attempt(onSignedOut, { error = it }) {
                            val ask = LeaveAsk(type.id, from.toString(), to.toString(), reason.trim(), halfOf, split = if (p.split) true else null)
                            val sent = if (editing != null) api.editLeave(editing.id, ask) else api.askLeave(ask)
                            onDone(sentWords(sent, changed = editing != null))
                        }
                        busy = false
                    }
                },
                enabled = !busy && preview != null && preview.problems.isEmpty() && reasonOk && !to.isBefore(from),
            ) { Text(if (busy) "Sending…" else if (editing != null) "Save" else "Send") }
            TextButton(onClick = onCancel) { Text(if (editing != null) "Keep it as it was" else "Cancel") }
        }
        if (!reasonOk && preview != null && preview.problems.isEmpty()) Hint("Say why, in a few words.")
    }
    picking?.let { which ->
        val initial = if (which == "from") from else to
        val state = rememberDatePickerState(
            initialSelectedDateMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : androidx.compose.material3.SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = which == "from" || !Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate().isBefore(from)
            },
        )
        DatePickerDialog(
            onDismissRequest = { picking = null },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { ms ->
                        val d = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()
                        if (which == "from") {
                            from = d
                            if (to.isBefore(d)) to = d
                        } else {
                            to = d
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

/** The optional holidays: pick up to the company's number, drop one before its day. */
@Composable
private fun RestrictedHolidaysSection(api: Api, version: Int, onNote: (Pair<String, Boolean>) -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    val data = rememberLoad(onSignedOut, version) { api.restrictedHolidays() }
    var busy by remember { mutableStateOf<String?>(null) }
    when (val s = data.state) {
        is Load.Busy -> Unit
        is Load.Failed -> Section("Restricted holidays") { FailedLine("Could not load the restricted holidays: ${s.message}", data.reload) }
        is Load.Ready -> {
            val r = s.value
            if (r.quota <= 0 && r.holidays.isEmpty()) return
            Section("Restricted holidays ${r.year}") {
                Hint(if (r.quota > 0) "${r.picked} of ${r.quota} picked" else "Your company gives no picks of these this year.")
                if (r.holidays.isEmpty()) Hint("No optional holidays this year.")
                r.holidays.forEachIndexed { i, h ->
                    if (i > 0) HorizontalDivider()
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(h.name, style = MaterialTheme.typography.bodyLarge)
                            Hint("${shortDate(h.date)}${if (h.picked) " · Picked" else ""}")
                        }
                        when {
                            h.past -> Hint("Past")
                            r.quota > 0 || h.picked -> OutlinedButton(
                                onClick = {
                                    busy = h.id
                                    scope.launch {
                                        attempt(onSignedOut, { onNote(it to false) }) {
                                            api.pickHoliday(h.id, !h.picked)
                                            onNote((if (h.picked) "Dropped ${h.name}." else "Picked ${h.name}: it is a holiday for you.") to true)
                                            data.reload()
                                        }
                                        busy = null
                                    }
                                },
                                enabled = busy == null && (h.picked || r.left > 0),
                            ) { Text(if (h.picked) "Drop" else "Pick") }
                        }
                    }
                }
            }
        }
    }
}
