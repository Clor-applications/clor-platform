package `in`.clor.attendance.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color

/*
 * The Blaze palette, as Attendance on the web (packages/ui/src/index.css,
 * [data-palette='blaze']): Blaze #FF6700, Graphite #23272B, Almost Black
 * #070D0D, Cloud White #F7F8FA.
 *
 *   buttons            Graphite, white text (15:1)
 *   the Punch button   Blaze, Almost Black text (6.9:1): the one Blaze action
 *   orange as text     Blaze Ink #B84A00 (5.2:1 on white); Blaze itself on
 *                      white is 2.9:1, so it never carries small text
 *   selection          Blaze tint #FFECDE with ink, never Material's lavender
 *   status             green / red / amber / blue, always with words beside
 *
 * Dark: Almost Black ground, Blaze buttons with Almost Black text, as the web.
 */
val Blaze = Color(0xFFFF6700)
val Graphite = Color(0xFF23272B)
val AlmostBlack = Color(0xFF070D0D)
val CloudWhite = Color(0xFFF7F8FA)
val Pos = Color(0xFF16845B)
val Neg = Color(0xFFC2413A)
val Warn = Color(0xFF996200)
/** Leave, in the calendar and its legend (the web's leave colour). */
val LeaveTone = Color(0xFF2563EB)

/** Orange for text, icons and tints: Blaze Ink on light, a lighter Blaze on dark. */
val Brand: Color
    @Composable @ReadOnlyComposable
    get() = MaterialTheme.colorScheme.tertiary

private val Light = lightColorScheme(
    primary = Graphite,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFECDE),
    onPrimaryContainer = Color(0xFF7A2E00),
    secondary = Graphite,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFECDE),
    onSecondaryContainer = AlmostBlack,
    tertiary = Color(0xFFB84A00),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFFF6EF),
    onTertiaryContainer = Color(0xFF7A2E00),
    background = CloudWhite,
    onBackground = AlmostBlack,
    surface = Color.White,
    onSurface = AlmostBlack,
    surfaceVariant = Color(0xFFEEF0F3),
    onSurfaceVariant = Color(0xFF4B5258),
    surfaceTint = Color.Transparent,
    surfaceBright = Color.White,
    surfaceDim = Color(0xFFE6E8EB),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFFBFBFC),
    surfaceContainer = Color.White,
    surfaceContainerHigh = Color(0xFFF2F3F5),
    surfaceContainerHighest = Color(0xFFEEF0F3),
    inverseSurface = Graphite,
    inverseOnSurface = Color.White,
    inversePrimary = Blaze,
    outline = Color(0xFFDDE0E4),
    outlineVariant = Color(0xFFE8EAED),
    error = Neg,
)

private val Dark = darkColorScheme(
    primary = Blaze,
    onPrimary = AlmostBlack,
    primaryContainer = Color(0xFF3D1E0A),
    onPrimaryContainer = Color(0xFFFFD2B3),
    secondary = Color(0xFFECEEF1),
    onSecondary = AlmostBlack,
    secondaryContainer = Color(0xFF3D1E0A),
    onSecondaryContainer = Color(0xFFFFE4D1),
    tertiary = Color(0xFFFF8A40),
    onTertiary = AlmostBlack,
    tertiaryContainer = Color(0xFF1F130B),
    onTertiaryContainer = Color(0xFFFFD2B3),
    background = AlmostBlack,
    onBackground = CloudWhite,
    surface = Color(0xFF121718),
    onSurface = CloudWhite,
    surfaceVariant = Color(0xFF181E20),
    onSurfaceVariant = Color(0xFFA9AFB5),
    surfaceTint = Color.Transparent,
    surfaceBright = Color(0xFF23272B),
    surfaceDim = AlmostBlack,
    surfaceContainerLowest = AlmostBlack,
    surfaceContainerLow = Color(0xFF0E1314),
    surfaceContainer = Color(0xFF121718),
    surfaceContainerHigh = Color(0xFF181E20),
    surfaceContainerHighest = Color(0xFF23272B),
    inverseSurface = CloudWhite,
    inverseOnSurface = AlmostBlack,
    inversePrimary = Color(0xFFB84A00),
    outline = Color(0xFF2B3134),
    outlineVariant = Color(0xFF23292B),
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
