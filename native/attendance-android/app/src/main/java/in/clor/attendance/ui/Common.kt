package `in`.clor.attendance.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
