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
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
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
import `in`.clor.attendance.data.LeaveType
import `in`.clor.attendance.data.SignedOut
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** Balances, asking for leave, and what I asked for (cancel while it is still possible). */
@Composable
fun LeaveTab(api: Api, version: Int, onChanged: () -> Unit, onSignedOut: () -> Unit, startApplying: Boolean = false, onApplyShown: () -> Unit = {}) {
    val scope = rememberCoroutineScope()
    val data = rememberLoad(onSignedOut, version) { api.leave() }
    var asking by remember { mutableStateOf(startApplying) }
    LaunchedEffect(startApplying) { if (startApplying) onApplyShown() }
    var error by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        LoadView(data) { l ->
            Section("Balance ${l.year}") {
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
            if (asking) {
                LeaveForm(api, l.types, onDone = { asking = false; onChanged() }, onCancel = { asking = false }, onSignedOut = onSignedOut)
            } else if (l.types.isNotEmpty()) {
                Button(onClick = { asking = true }, modifier = Modifier.fillMaxWidth()) { Text("Apply for leave") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Section("My requests") {
                if (l.requests.isEmpty()) Hint("Nothing asked for this year.")
                l.requests.forEachIndexed { i, r ->
                    if (i > 0) HorizontalDivider()
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${r.leaveTypeName ?: "Leave"} · ${days(r.days)}", style = MaterialTheme.typography.bodyLarge)
                            Hint(if (r.fromDate == r.toDate) shortDate(r.fromDate) else "${shortDate(r.fromDate)} to ${shortDate(r.toDate)}")
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            val (t, tone) = requestStatus(r.status)
                            StatusPill(t, tone)
                            if (r.status == "PENDING" || (r.status == "APPROVED" && r.fromDate > l.today)) {
                                TextButton(onClick = {
                                    scope.launch {
                                        try {
                                            api.cancelLeave(r.id)
                                            onChanged()
                                        } catch (e: SignedOut) {
                                            onSignedOut()
                                        } catch (e: ApiError) {
                                            error = e.message
                                        }
                                    }
                                }) { Text("Cancel") }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LeaveForm(api: Api, types: List<LeaveType>, onDone: () -> Unit, onCancel: () -> Unit, onSignedOut: () -> Unit) {
    val scope = rememberCoroutineScope()
    var type by remember { mutableStateOf(types.first()) }
    var typeOpen by remember { mutableStateOf(false) }
    var from by remember { mutableStateOf(LocalDate.now()) }
    var to by remember { mutableStateOf(LocalDate.now()) }
    var picking by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Section("Apply for leave") {
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
                    DropdownMenuItem(text = { Text("${t.name}${t.available?.let { " · ${days(it)} left" } ?: ""}") }, onClick = { type = t; typeOpen = false })
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { picking = "from" }, modifier = Modifier.weight(1f)) { Text("From ${shortDate(from.toString())}") }
            OutlinedButton(onClick = { picking = "to" }, modifier = Modifier.weight(1f)) { Text("To ${shortDate(to.toString())}") }
        }
        OutlinedTextField(reason, { reason = it.take(500) }, label = { Text("Reason") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            api.askLeave(type.id, from.toString(), to.toString(), reason.trim())
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
                enabled = !busy && reason.trim().length >= 3 && !to.isBefore(from),
            ) { Text("Send") }
            TextButton(onClick = onCancel) { Text("Cancel") }
        }
        Hint("Weekly offs and holidays inside the dates are not counted.")
    }
    picking?.let { which ->
        val initial = if (which == "from") from else to
        val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
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
