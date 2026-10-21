package `in`.clor.attendance.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.AttentionItem
import `in`.clor.attendance.data.OvertimeDay
import `in`.clor.attendance.data.SignedOut
import `in`.clor.attendance.data.TimelineStep
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The self-service screens reached from the Attendance tab (and Home's banner). */
/** `tile`: the shorter name on the Attendance tab's tiles, which are half a phone wide (MX-10). */
enum class Panel(val title: String, val sub: String, val icon: ImageVector, val tile: String = title) {
    Attention("Needs attention", "Missing punches and days to fix", Icons.Outlined.WarningAmber),
    Review("Confirm my month", "Check the month before HR closes it", Icons.Outlined.EditCalendar, "Confirm month"),
    Shifts("Shifts ahead", "Shifts, weekly offs and holidays", Icons.Outlined.CalendarMonth),
    Overtime("Overtime & comp-off", "Extra hours and worked rest days", Icons.Outlined.Schedule, "Overtime"),
}

private val zone = ZoneId.of("Asia/Kolkata")
private val stampFmt = DateTimeFormatter.ofPattern("d MMM, HH:mm", Locale.ENGLISH)
private val weekdayFmt = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)

/** An ISO instant from the server, in India time: "20 Oct, 14:05". */
fun stamp(iso: String?): String = iso?.let { runCatching { Instant.parse(it).atZone(zone).format(stampFmt) }.getOrNull() } ?: ""

/** The four tiles at the top of the Attendance tab. */
@Composable
fun PanelTiles(attention: Int?, onOpen: (Panel) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Panel.entries.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { p ->
                    val tint = if (p == Panel.Attention && (attention ?: 0) > 0) Neg else Brand
                    Row(
                        Modifier.weight(1f).background(MaterialTheme.colorScheme.surface, RoundedCornerShape(14.dp)).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(14.dp)).clickable { onOpen(p) }.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        IconTile(p.icon, tint)
                        Column(Modifier.weight(1f)) {
                            Text(p.tile, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            Text(
                                if (p == Panel.Attention && attention != null) (if (attention == 0) "All clear" else "$attention to fix") else p.sub,
                                style = MaterialTheme.typography.bodySmall,
                                color = if (p == Panel.Attention && (attention ?: 0) > 0) Neg else MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** One self-service screen, with a way back to the month. */
@Composable
fun PanelScreen(api: Api, panel: Panel, version: Int, onBack: () -> Unit, onFix: (String, String?) -> Unit, onChanged: () -> Unit, onSignedOut: () -> Unit) {
    androidx.activity.compose.BackHandler(onBack = onBack)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") }
            Text(panel.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        }
        when (panel) {
            Panel.Attention -> AttentionScreen(api, version, onFix, onSignedOut)
            Panel.Review -> ReviewScreen(api, version, onFix, onChanged, onSignedOut)
            Panel.Shifts -> ShiftsScreen(api, onSignedOut)
            Panel.Overtime -> OvertimeScreen(api, version, onChanged, onSignedOut)
        }
    }
}

@Composable
private fun AttentionScreen(api: Api, version: Int, onFix: (String, String?) -> Unit, onSignedOut: () -> Unit) {
    val data = rememberLoad(onSignedOut, version) { api.attention() }
    LoadView(data) { a ->
        if (a.items.isEmpty()) {
            Section { Hint("Nothing to fix. Every working day since last month has its punches, and nothing is waiting.") }
            return@LoadView
        }
        val fix = a.items.filter { it.action == "FIX" }
        val waiting = a.items.filter { it.action != "FIX" }
        if (fix.isNotEmpty()) {
            Section("To fix") {
                Hint("Ask for a correction, or apply for leave if you were off. Days not fixed may count as absent.")
                fix.forEachIndexed { i, it -> if (i > 0) HorizontalDivider(); AttentionRow(it, onFix) }
            }
        }
        if (waiting.isNotEmpty()) {
            Section("Waiting for a decision") { waiting.forEachIndexed { i, it -> if (i > 0) HorizontalDivider(); AttentionRow(it, onFix) } }
        }
    }
}

@Composable
private fun AttentionRow(item: AttentionItem, onFix: (String, String?) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(runCatching { LocalDate.parse(item.date).format(weekdayFmt) }.getOrDefault(item.date), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Hint(item.text)
        }
        if (item.action == "FIX") OutlinedButton(onClick = { onFix(item.date, item.checkIn) }) { Text("Fix") }
        else StatusPill("Waiting", Tone.Warn)
    }
}

@Composable
private fun ReviewScreen(api: Api, version: Int, onFix: (String, String?) -> Unit, onChanged: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    var month by rememberSaveable { mutableStateOf(YearMonth.now(zone).minusMonths(1).toString()) }
    var disputing by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var said by remember { mutableStateOf<String?>(null) }
    val data = rememberLoad(onSignedOut, month, version) { api.monthReview(month) }
    fun send(dispute: String?) {
        busy = true
        said = null
        scope.launch {
            try {
                if (dispute == null) api.confirmMonth(month) else api.disputeMonth(month, dispute)
                said = if (dispute == null) "Confirmed. Thank you." else "Sent to HR. They will check and correct it."
                disputing = false
                note = ""
                data.reload()
                onChanged()
            } catch (e: SignedOut) {
                onSignedOut()
            } catch (e: ApiError) {
                said = e.message
            } finally {
                busy = false
            }
        }
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        IconButton(onClick = { month = YearMonth.parse(month).minusMonths(1).toString(); said = null }) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, contentDescription = "Previous month") }
        Text(YearMonth.parse(month).format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH)), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        IconButton(onClick = { month = YearMonth.parse(month).plusMonths(1).toString(); said = null }, enabled = YearMonth.parse(month) < YearMonth.now(zone)) {
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = "Next month")
        }
    }
    LoadView(data) { r ->
        val s = r.summary
        Section {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Figure("Payable", num(s.payableDays))
                Figure("Present", num(s.present))
                Figure("Absent", num(s.absent))
                Figure("Leave", num(s.leave))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Figure("Late", num(s.late))
                Figure("Loss of pay", num(s.lossOfPayDays))
                Figure("Overtime", hm(s.overtimeMinutes.toInt()))
                Figure("OT approved", hm(s.approvedOvertimeMinutes.toInt()))
            }
            if (s.latePenaltyDays > 0) Hint("${num(s.latePenaltyDays)} day${if (s.latePenaltyDays == 1.0) "" else "s"} cut for coming late too often.")
            if (r.pendingOvertime > 0) Hint("${r.pendingOvertime} overtime or comp-off request${if (r.pendingOvertime == 1) " is" else "s are"} still waiting.")
        }
        if (r.unresolved.isNotEmpty()) {
            Section("Still open (${r.unresolved.size})") {
                r.unresolved.forEachIndexed { i, it -> if (i > 0) HorizontalDivider(); AttentionRow(it, onFix) }
            }
        }
        Section(if (r.confirmation != null) null else "Is this right?") {
            r.confirmation?.let { c ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatusPill(if (c.status == "CONFIRMED") "Confirmed" else "Reported wrong", if (c.status == "CONFIRMED") Tone.Pos else Tone.Warn)
                    Hint(stamp(c.at))
                }
                c.note?.let { Text("“$it”", style = MaterialTheme.typography.bodyMedium) }
            }
            if (r.cutoff.isNotEmpty()) Hint("Confirm by ${longDate(r.cutoff)}.")
            r.why?.let { Hint(it) }
            said?.let { Text(it, color = Pos, style = MaterialTheme.typography.bodyMedium) }
            if (r.canConfirm) {
                if (disputing) {
                    OutlinedTextField(note, { note = it.take(1000) }, label = { Text("What is wrong") }, placeholder = { Text("e.g. I was on a client visit on the 12th, not absent") }, modifier = Modifier.fillMaxWidth(), minLines = 3)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { send(note.trim()) }, enabled = !busy && note.trim().length >= 5) { Text("Send to HR") }
                        TextButton(onClick = { disputing = false }) { Text("Cancel") }
                    }
                } else {
                    if (r.unresolved.isNotEmpty() && r.confirmation == null) Hint("Fix the open days first, or confirm anyway if they are right.")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { send(null) }, enabled = !busy) { Text(if (r.confirmation?.status == "CONFIRMED") "Confirm again" else "Confirm month") }
                        OutlinedButton(onClick = { disputing = true }, enabled = !busy) { Text("Something is wrong") }
                    }
                }
            }
        }
    }
}

@Composable
private fun ShiftsScreen(api: Api, onSignedOut: () -> Unit) {
    val today = LocalDate.now(zone).toString()
    val data = rememberLoad(onSignedOut) { api.upcoming(today, 28) }
    LoadView(data) { u ->
        val changed = u.days.count { it.changed }
        if (changed > 0) Section { Text("$changed day${if (changed == 1) " has" else "s have"} a changed shift.", color = Warn, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold) }
        Section {
            u.days.forEachIndexed { i, d ->
                if (i > 0) HorizontalDivider()
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(if (d.date == today) "Today" else runCatching { LocalDate.parse(d.date).format(weekdayFmt) }.getOrDefault(d.date), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            if (d.changed) SmallBadge("Changed")
                        }
                        Hint(
                            when (d.kind) {
                                "HOLIDAY" -> d.holiday ?: "Holiday"
                                "OFF" -> "Weekly off"
                                else -> "${d.shift} · ${d.startTime}–${d.endTime}${if (d.crossesMidnight) " (next day)" else ""}${if (d.changed) " · ${d.sourceText}" else ""}"
                            },
                        )
                    }
                    when (d.kind) {
                        "HOLIDAY" -> StatusPill("Holiday", Tone.Pos)
                        "OFF" -> StatusPill("Off", Tone.Neutral)
                        "LEAVE" -> StatusPill(if (d.halfDay != null) "Half-day leave" else "Leave", Tone.Pos)
                        "LEAVE_ASKED" -> StatusPill("Leave asked", Tone.Warn)
                        else -> Unit
                    }
                }
            }
        }
    }
}

@Composable
private fun OvertimeScreen(api: Api, version: Int, onChanged: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    var month by rememberSaveable { mutableStateOf(YearMonth.now(zone).toString()) }
    var asking by remember { mutableStateOf<Pair<OvertimeDay, String>?>(null) }
    var said by remember { mutableStateOf<String?>(null) }
    val data = rememberLoad(onSignedOut, month, version) { api.overtime(month) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        IconButton(onClick = { month = YearMonth.parse(month).minusMonths(1).toString() }) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, contentDescription = "Previous month") }
        Text(YearMonth.parse(month).format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH)), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        IconButton(onClick = { month = YearMonth.parse(month).plusMonths(1).toString() }, enabled = YearMonth.parse(month) < YearMonth.now(zone)) {
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = "Next month")
        }
    }
    said?.let { Text(it, color = Pos, style = MaterialTheme.typography.bodyMedium) }
    LoadView(data) { o ->
        Section {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Figure("Recorded", hm(o.recordedMinutes))
                Figure("Approved", hm(o.approvedMinutes), Pos)
                Figure("Waiting", hm(o.pendingMinutes), Warn)
            }
            Hint(
                buildString {
                    append("Only approved overtime is paid.")
                    if (!o.policy.overtimeRequests) append(" Your company approves overtime itself; there is nothing to ask.")
                    if (o.policy.compOff) append(" Work on a weekly off or holiday can be taken back as comp-off.")
                },
            )
        }
        if (o.days.isEmpty()) Section { Hint("No overtime or rest-day work recorded this month.") }
        o.days.sortedByDescending { it.date }.forEach { d ->
            Section {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(runCatching { LocalDate.parse(d.date).format(weekdayFmt) }.getOrDefault(d.date), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Hint("Worked ${hm(d.workedMinutes)}${if (d.overtimeMinutes > 0) " · overtime ${hm(d.overtimeMinutes)}" else ""}${if (d.restDay) " · rest day" else ""}")
                    }
                    when {
                        d.overtimeApproved -> StatusPill("Approved", Tone.Pos)
                        d.overtimeRequest != null -> requestStatus(d.overtimeRequest.status).let { (t, tone) -> StatusPill(t, tone) }
                        else -> Unit
                    }
                }
                d.compOffRequest?.let { c ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Hint("Comp-off ${days(c.days ?: d.compOffDays)}")
                        requestStatus(c.status).let { (t, tone) -> StatusPill(t, tone) }
                    }
                }
                listOfNotNull(d.overtimeRequest?.note, d.compOffRequest?.note).filter { it.isNotBlank() }.forEach { Hint("Note: $it") }
                if (d.canAskOvertime || d.canAskCompOff) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (d.canAskOvertime) OutlinedButton(onClick = { asking = d to "OVERTIME" }) { Text("Ask to approve") }
                        if (d.canAskCompOff) OutlinedButton(onClick = { asking = d to "COMP_OFF" }) { Text("Ask comp-off (${days(d.compOffDays)})") }
                    }
                }
            }
        }
    }
    asking?.let { (d, kind) ->
        var reason by remember(d.date, kind) { mutableStateOf("") }
        var busy by remember(d.date, kind) { mutableStateOf(false) }
        var error by remember(d.date, kind) { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { asking = null },
            title = { Text(if (kind == "COMP_OFF") "Comp-off for ${shortDate(d.date)}" else "Overtime on ${shortDate(d.date)}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (kind == "COMP_OFF") "You worked ${hm(d.workedMinutes)} on a rest day. Approved, ${days(d.compOffDays)} of comp-off is added to your leave." else "${hm(d.overtimeMinutes)} beyond your shift. Approved, it is paid as overtime.", style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(reason, { reason = it.take(500) }, label = { Text("What was the extra work for") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                TextButton(enabled = !busy && reason.trim().length >= 3, onClick = {
                    busy = true
                    scope.launch {
                        try {
                            api.askOvertime(d.date, kind, reason.trim())
                            asking = null
                            said = "Sent. You will hear when it is decided."
                            data.reload()
                            onChanged()
                        } catch (e: SignedOut) {
                            onSignedOut()
                        } catch (e: ApiError) {
                            error = e.message
                        } finally {
                            busy = false
                        }
                    }
                }) { Text("Send") }
            },
            dismissButton = { TextButton(onClick = { asking = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Figure(label: String, value: String, tint: Color = MaterialTheme.colorScheme.onSurface) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(vertical = 4.dp)) {
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = tint)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun num(n: Double): String = if (n % 1.0 == 0.0) n.toInt().toString() else n.toString()

/**
 * Where a request stands: "Next: HR" and, opened, each step with when it
 * happened — sent, the manager, HR, the decision and its reason.
 */
@Composable
fun Timeline(steps: List<TimelineStep>, next: String?) {
    if (steps.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
        Text(
            if (next != null) "Next: $next" else steps.lastOrNull()?.let { "${it.label}${stamp(it.at).let { t -> if (t.isNotEmpty()) " · $t" else "" }}" } ?: "",
            style = MaterialTheme.typography.labelMedium,
            color = if (next != null) Warn else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f),
        )
        Text(if (open) "Hide steps" else "Show steps", style = MaterialTheme.typography.labelMedium, color = Brand)
    }
    if (open) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(start = 4.dp)) {
            steps.forEach { s ->
                val c = when (s.state) { "DONE" -> Pos; "NOW" -> Warn; "REFUSED" -> Neg; else -> MaterialTheme.colorScheme.outline }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.size(10.dp).background(if (s.state == "LATER") Color.Transparent else c, RoundedCornerShape(50)).border(2.dp, c, RoundedCornerShape(50)))
                    Column {
                        Text(s.label, style = MaterialTheme.typography.bodyMedium, fontWeight = if (s.state == "NOW") FontWeight.SemiBold else FontWeight.Normal)
                        val t = stamp(s.at)
                        Hint(
                            when (s.state) {
                                "NOW" -> "Deciding now"
                                "LATER" -> "Not yet"
                                "WITHDRAWN" -> "Withdrawn${if (t.isNotEmpty()) " · $t" else ""}"
                                else -> t
                            },
                        )
                    }
                }
            }
        }
    }
}
