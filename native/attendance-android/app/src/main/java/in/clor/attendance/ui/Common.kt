package `in`.clor.attendance.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.SignedOut
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** What a screen is loading: nothing yet, the answer, or what went wrong. */
sealed interface Load<out T> {
    data object Busy : Load<Nothing>
    data class Ready<T>(val value: T) : Load<T>
    data class Failed(val message: String) : Load<Nothing>
}

/**
 * Loads `fetch` when the screen opens and whenever `reload()` is called. A
 * signed-out answer goes straight to `onSignedOut`.
 */
class Loader<T>(val state: Load<T>, val reload: () -> Unit)

@Composable
fun <T> rememberLoad(onSignedOut: () -> Unit, vararg keys: Any?, fetch: suspend () -> T): Loader<T> {
    var tick by remember { mutableIntStateOf(0) }
    var state by remember(*keys) { mutableStateOf<Load<T>>(Load.Busy) }
    LaunchedEffect(tick, *keys) {
        state = try {
            Load.Ready(fetch())
        } catch (e: SignedOut) {
            onSignedOut()
            Load.Failed(e.message ?: "Please sign in again.")
        } catch (e: ApiError) {
            Load.Failed(e.message ?: "Something went wrong.")
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Load.Failed("Something went wrong.")
        }
    }
    return Loader(state) { tick++ }
}

@Composable
fun <T> LoadView(loader: Loader<T>, content: @Composable (T) -> Unit) {
    when (val s = loader.state) {
        is Load.Busy -> Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is Load.Failed -> Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(s.message, style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = loader.reload) { Text("Try again") }
        }
        is Load.Ready -> content(s.value)
    }
}

@Composable
fun Section(title: String? = null, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = CardDefaults.outlinedCardBorder(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (title != null) Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

/** A status as words in a tinted pill: colour is never the only signal. */
@Composable
fun StatusPill(text: String, tone: Tone = Tone.Neutral) {
    val (bg, fg) = when (tone) {
        Tone.Pos -> Pos.copy(alpha = 0.12f) to Pos
        Tone.Neg -> Neg.copy(alpha = 0.12f) to Neg
        Tone.Warn -> Warn.copy(alpha = 0.14f) to Warn
        Tone.Neutral -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(color = bg, shape = RoundedCornerShape(50)) {
        Text(text, color = fg, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp))
    }
}

enum class Tone { Pos, Neg, Warn, Neutral }

fun dayStatus(status: String): Pair<String, Tone> = when (status) {
    "PRESENT" -> "Present" to Tone.Pos
    "HALF_DAY" -> "Half day" to Tone.Warn
    "ABSENT" -> "Absent" to Tone.Neg
    "ON_LEAVE" -> "On leave" to Tone.Neutral
    "HOLIDAY" -> "Holiday" to Tone.Neutral
    "WEEKLY_OFF" -> "Weekly off" to Tone.Neutral
    else -> status.lowercase().replaceFirstChar { it.uppercase() } to Tone.Neutral
}

fun requestStatus(status: String): Pair<String, Tone> = when (status) {
    "PENDING" -> "Waiting" to Tone.Warn
    "APPROVED" -> "Approved" to Tone.Pos
    "REJECTED" -> "Declined" to Tone.Neg
    "CANCELLED" -> "Cancelled" to Tone.Neutral
    else -> status.lowercase() to Tone.Neutral
}

fun hm(minutes: Int?): String = if (minutes == null) "—" else "${minutes / 60}h ${"%02d".format(minutes % 60)}m"

private val dayFmt = DateTimeFormatter.ofPattern("EEE d MMM", Locale.ENGLISH)
private val longFmt = DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.ENGLISH)
fun shortDate(iso: String): String = runCatching { LocalDate.parse(iso).format(dayFmt) }.getOrDefault(iso)
fun longDate(iso: String): String = runCatching { LocalDate.parse(iso).format(longFmt) }.getOrDefault(iso)
fun days(n: Double): String = if (n % 1.0 == 0.0) "${n.toInt()} day${if (n.toInt() == 1) "" else "s"}" else "$n days"

val screenPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp)

@Composable
fun Hint(text: String, color: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = color)
}

@Composable
fun Fill(content: @Composable () -> Unit) = Box(Modifier.fillMaxSize()) { content() }

/** Ask before something that cannot be taken back (withdraw, cancel leave). */
@Composable
fun ConfirmDialog(title: String, text: String? = null, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = text?.let { { Text(it) } },
        confirmButton = { androidx.compose.material3.TextButton(onClick = { onDismiss(); onConfirm() }) { Text(confirm) } },
        dismissButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text("Keep it") } },
    )
}

/**
 * Runs an action and turns every failure into words: signed out goes to
 * sign-in, anything else lands in `onError` (never a crash, never silence).
 */
suspend fun attempt(onSignedOut: () -> Unit, onError: (String) -> Unit, block: suspend () -> Unit) {
    try {
        block()
    } catch (e: SignedOut) {
        onSignedOut()
    } catch (e: ApiError) {
        onError(e.message ?: "Something went wrong. Try again.")
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        onError("Something went wrong. Try again.")
    }
}

/** A failed load inside a card: what went wrong and Try again, never an empty space. */
@Composable
fun FailedLine(message: String, onRetry: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        OutlinedButton(onClick = onRetry) { Text("Try again") }
    }
}

/** A small tinted square with an icon, as on the home cards. */
@Composable
fun IconTile(icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color) {
    Box(Modifier.size(36.dp).background(tint.copy(alpha = 0.12f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
        androidx.compose.material3.Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
    }
}

/**
 * A typed time, read the way people type it on a number pad: 9.10, 9:10,
 * 910, 0910 and 9 all mean a time; returns "HH:MM" (24-hour) or null.
 */
fun normalizeTime(raw: String): String? {
    val s = raw.trim().replace(Regex("[.,\\- h]"), ":")
    if (s.isEmpty()) return null
    val (h, m) = when {
        ':' in s -> s.substringBefore(':') to s.substringAfter(':').ifEmpty { "0" }
        s.length <= 2 -> s to "0"
        s.length == 3 -> s.take(1) to s.drop(1)
        s.length == 4 -> s.take(2) to s.drop(2)
        else -> return null
    }
    val hh = h.toIntOrNull() ?: return null
    val mm = m.toIntOrNull() ?: return null
    if (hh !in 0..23 || mm !in 0..59 || m.length > 2) return null
    return "%02d:%02d".format(hh, mm)
}

/** A time box: type it (any of the forms above) or tap the clock for a picker. Shows how it was read. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun TimeField(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, optional: Boolean = false) {
    var picking by remember { mutableStateOf(false) }
    val read = normalizeTime(value)
    val bad = value.isNotBlank() && read == null
    androidx.compose.material3.OutlinedTextField(
        value = value,
        onValueChange = { onChange(it.take(5)) },
        label = { Text(label) },
        singleLine = true,
        isError = bad,
        supportingText = { Text(if (bad) "Use 24-hour, e.g. 09:10" else if (read != null && read != value) "Read as $read" else if (optional && value.isBlank()) "Optional" else "") },
        trailingIcon = {
            androidx.compose.material3.IconButton(onClick = { picking = true }) {
                androidx.compose.material3.Icon(androidx.compose.material.icons.Icons.Outlined.Schedule, contentDescription = "Pick a time")
            }
        },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
        modifier = modifier,
    )
    if (picking) {
        val start = read ?: "09:00"
        val state = androidx.compose.material3.rememberTimePickerState(initialHour = start.take(2).toInt(), initialMinute = start.takeLast(2).toInt(), is24Hour = true)
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { picking = false },
            confirmButton = { androidx.compose.material3.TextButton(onClick = { onChange("%02d:%02d".format(state.hour, state.minute)); picking = false }) { Text("OK") } },
            dismissButton = { androidx.compose.material3.TextButton(onClick = { picking = false }) { Text("Cancel") } },
            text = { androidx.compose.material3.TimePicker(state = state) },
        )
    }
}
