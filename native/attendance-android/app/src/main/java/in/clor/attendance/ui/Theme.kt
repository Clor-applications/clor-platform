package `in`.clor.attendance.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/*
 * CLOR's tokens (packages/ui/src/index.css): orange brand for the one primary
 * action and selection; #E85F00 where white text sits on it (3.3:1, as the
 * web's primary button); calm grey ground, white cards, green / red / amber
 * only for status, always with words beside them.
 */
val Brand = Color(0xFFE85F00)
val Pos = Color(0xFF16845B)
val Neg = Color(0xFFC2413A)
val Warn = Color(0xFF996200)

private val Light = lightColorScheme(
    primary = Brand,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFF5EC),
    onPrimaryContainer = Color(0xFF7A2E00),
    background = Color(0xFFF3F3F0),
    onBackground = Color(0xFF111827),
    surface = Color.White,
    onSurface = Color(0xFF111827),
    surfaceVariant = Color(0xFFF1F1EE),
    onSurfaceVariant = Color(0xFF52525B),
    outline = Color(0xFFE4E4E0),
    error = Neg,
)

private val Dark = darkColorScheme(
    primary = Color(0xFFFF8A33),
    onPrimary = Color(0xFF1A0B00),
    primaryContainer = Color(0xFF3A1D08),
    onPrimaryContainer = Color(0xFFFFD8BA),
    background = Color(0xFF0C0E0D),
    onBackground = Color(0xFFF1F5F9),
    surface = Color(0xFF151918),
    onSurface = Color(0xFFF1F5F9),
    surfaceVariant = Color(0xFF1E2321),
    onSurfaceVariant = Color(0xFFA1A1AA),
    outline = Color(0xFF2A302E),
    error = Color(0xFFF87171),
)

/** Appearance: AUTO follows the phone's light / dark setting; LIGHT and DARK fix it. */
enum class Appearance { AUTO, LIGHT, DARK }

@Composable
fun ClorTheme(appearance: Appearance = Appearance.AUTO, content: @Composable () -> Unit) {
    val dark = when (appearance) {
        Appearance.AUTO -> isSystemInDarkTheme()
        Appearance.LIGHT -> false
        Appearance.DARK -> true
    }
    MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
}
