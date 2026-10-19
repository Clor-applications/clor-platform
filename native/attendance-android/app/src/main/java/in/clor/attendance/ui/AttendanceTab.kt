package `in`.clor.attendance.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.Day
import `in`.clor.attendance.data.SignedOut
import kotlinx.coroutines.launch
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * A month of my days with its totals; tap a day to see why it counts as it
 * does (the same explanation HR sees) and to ask for it to be fixed.
 */
@Composable
fun AttendanceTab(api: Api, version: Int, onChanged: () -> Unit, onSignedOut: () -> Unit) {
    var month by rememberSaveable { mutableStateOf(YearMonth.now().toString()) }
    var open by remember { mutableStateOf<String?>(null) }
    val data = rememberLoad(onSignedOut, month, version) { api.month(month) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            IconButton(onClick = { month = YearMonth.parse(month).minusMonths(1).toString() }) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, contentDescription = "Previous month") }
            Text(YearMonth.parse(month).format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH)), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            IconButton(onClick = { month = YearMonth.parse(month).plusMonths(1).toString() }, enabled = YearMonth.parse(month) < YearMonth.now()) {
                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = "Next month")
            }
        }
        LoadView(data) { m ->
            Section {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Total("Present", m.totals.present)
                    Total("Half day", m.totals.halfDay)
                    Total("Absent", m.totals.absent)
                    Total("Leave", m.totals.leave)
                    Total("Late", m.totals.late)
                }
            }
            Calendar(month, m.days) { open = it }
            Section {
                if (m.days.isEmpty()) Hint("No days recorded this month yet.")
                m.days.sortedByDescending { it.date }.forEachIndexed { i, d ->
                    if (i > 0) HorizontalDivider()
                    DayRow(d) { open = d.date }
                }
            }
            val waiting = m.corrections.filter { it.status == "PENDING" }
            if (waiting.isNotEmpty()) {
                Section("Corrections waiting") {
                    waiting.forEach { c -> Text("${shortDate(c.date)} · in ${c.checkIn ?: "—"}${c.checkOut?.let { ", out $it" } ?: ""}", style = MaterialTheme.typography.bodyMedium) }
                }
            }
        }
    }
    open?.let { date -> DaySheet(api, date, onClose = { open = null }, onAsked = { open = null; onChanged() }, onSignedOut = onSignedOut) }
}

@Composable
private fun Total(label: String, n: Int) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text("$n", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Hint(label)
    }
}

@Composable
private fun DayRow(d: Day, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Column(Modifier.weight(1f)) {
            Text(shortDate(d.date), style = MaterialTheme.typography.bodyLarge)
            Hint(listOfNotNull(d.checkIn?.let { "In $it" }, d.checkOut?.let { "Out $it" }, if ((d.lateMinutes ?: 0) > 0) "late ${d.lateMinutes} min" else null).joinToString(" · ").ifEmpty { "No punches" })
        }
        val (t, tone) = dayStatus(d.status)
        StatusPill(t, tone)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DaySheet(api: Api, date: String, onClose: () -> Unit, onAsked: () -> Unit, onSignedOut: () -> Unit) {
    val explained = rememberLoad(onSignedOut, date) { api.explain(date) }
    var fixing by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onClose) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(longDate(date), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            LoadView(explained) { e ->
                Hint(listOfNotNull(e.holiday?.let { "Holiday: $it" }, if (e.shift.name.isNotEmpty()) "${e.shift.name} · ${e.shift.startTime}–${e.shift.endTime}" else null).joinToString(" · "))
                Section("Punches") {
                    if (e.punches.isEmpty()) Hint("No punches this day.")
                    e.punches.forEach { p -> Text("${p.time} · ${if (p.kind == "IN") "In" else if (p.kind == "OUT") "Out" else "Punch"} · ${p.where}", style = MaterialTheme.typography.bodyMedium) }
                }
                Section("Why the day is what it is") { e.steps.forEach { Text("• ${it.text}", style = MaterialTheme.typography.bodyMedium) } }
                when {
                    e.monthClosed -> Hint("This month is closed. Ask HR to correct it.")
                    fixing -> CorrectionForm(api, date, onDone = onAsked, onSignedOut = onSignedOut)
                    else -> Button(onClick = { fixing = true }, modifier = Modifier.fillMaxWidth()) { Text("Ask to fix this day") }
                }
            }
        }
    }
}

private val HHMM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

@Composable
private fun CorrectionForm(api: Api, date: String, onDone: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    var checkIn by remember { mutableStateOf("") }
    var checkOut by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val okIn = HHMM.matches(checkIn)
    val okOut = checkOut.isEmpty() || HHMM.matches(checkOut)
    Section("What should it be?") {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(checkIn, { checkIn = it.take(5) }, label = { Text("In (HH:MM)") }, singleLine = true, isError = checkIn.isNotEmpty() && !okIn, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
            OutlinedTextField(checkOut, { checkOut = it.take(5) }, label = { Text("Out (HH:MM)") }, singleLine = true, isError = !okOut, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        }
        OutlinedTextField(reason, { reason = it.take(500) }, label = { Text("Why") }, placeholder = { Text("e.g. The reader was down") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            api.askCorrection(date, checkIn, checkOut.ifEmpty { null }, reason.trim())
                            onDone()
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
            ) { Text("Send to HR") }
            TextButton(onClick = onDone) { Text("Cancel") }
        }
        Hint("Times are 24-hour, e.g. 09:05 and 18:30.")
    }
}

/** The month as a calendar: each day tinted by what it counts as; tap one for its story. */
@Composable
private fun Calendar(month: String, days: List<Day>, onOpen: (String) -> Unit) {
    val ym = YearMonth.parse(month)
    val byDate = days.associateBy { it.date }
    val lead = ym.atDay(1).dayOfWeek.value - 1 /* Monday first */
    val today = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"))
    val cells = List(lead) { null } + (1..ym.lengthOfMonth()).map { ym.atDay(it) }
    Section {
        Row(Modifier.fillMaxWidth()) {
            listOf("M", "T", "W", "T", "F", "S", "S").forEach { Text(it, Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        cells.chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth()) {
                week.forEach { d ->
                    Box(Modifier.weight(1f).padding(2.dp).height(44.dp), contentAlignment = Alignment.Center) {
                        if (d != null) {
                            val rec = byDate[d.toString()]
                            val tint = when (rec?.status) {
                                "PRESENT" -> Pos
                                "HALF_DAY" -> Warn
                                "ABSENT" -> Neg
                                "ON_LEAVE" -> androidx.compose.ui.graphics.Color(0xFF2563EB)
                                else -> null
                            }
                            val isToday = d == today
                            Column(
                                Modifier.fillMaxSize()
                                    .background(tint?.copy(alpha = 0.14f) ?: androidx.compose.ui.graphics.Color.Transparent, androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                                    .then(if (isToday) Modifier.border(1.5.dp, Brand, androidx.compose.foundation.shape.RoundedCornerShape(10.dp)) else Modifier)
                                    .clickable(enabled = !d.isAfter(today)) { onOpen(d.toString()) },
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center,
                            ) {
                                Text("${d.dayOfMonth}", style = MaterialTheme.typography.bodyMedium, fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
                                    color = if (d.isAfter(today)) MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f) else tint ?: MaterialTheme.colorScheme.onSurface)
                                if ((rec?.lateMinutes ?: 0) > 0) Box(Modifier.size(4.dp).background(Warn, androidx.compose.foundation.shape.CircleShape))
                            }
                        }
                    }
                }
                repeat(7 - week.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("Present" to Pos, "Half day" to Warn, "Absent" to Neg, "Leave" to androidx.compose.ui.graphics.Color(0xFF2563EB)).forEach { (t, c) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).background(c, androidx.compose.foundation.shape.CircleShape))
                    Text(t, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 4.dp))
                }
            }
        }
    }
}
