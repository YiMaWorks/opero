package cn.yimakeji.opero.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import cn.yimakeji.opero.i18n.I18n

/**
 * 颜色和网页默认风格一致（code/web/src/styles.css 的 :root / 深色）。
 * 网页有 14 套风格 + 自己配色，原生先只做默认的浅色 / 深色；以后读 settings 里的风格再跟上。
 */
@Immutable
data class OperoColors(
    val bg: Color,
    val panel: Color,
    val panel2: Color,
    val text: Color,
    val sub: Color,
    val faint: Color,
    val line: Color,
    val primary: Color,
    val primarySoft: Color,
    val ok: Color,
    val warn: Color,
    val danger: Color,
    val dangerSoft: Color,
)

val LightColors = OperoColors(
    bg = Color(0xFFF4F5F8), panel = Color(0xFFFFFFFF), panel2 = Color(0xFFF1F2F6),
    text = Color(0xFF14161F), sub = Color(0xFF4E5465), faint = Color(0xFF7A8091), line = Color(0xFFE4E6EC),
    primary = Color(0xFF5B4FE9), primarySoft = Color(0xFFEEECFE),
    ok = Color(0xFF12A150), warn = Color(0xFFC26A00), danger = Color(0xFFD92D20), dangerSoft = Color(0xFFFEECEB),
)

val DarkColors = OperoColors(
    bg = Color(0xFF0F1117), panel = Color(0xFF171A23), panel2 = Color(0xFF1C202A),
    text = Color(0xFFE9EBF1), sub = Color(0xFFA2A8B8), faint = Color(0xFF7C8396), line = Color(0xFF272B37),
    primary = Color(0xFF7C6CFF), primarySoft = Color(0x247C6CFF),
    ok = Color(0xFF4ADE80), warn = Color(0xFFFBBF24), danger = Color(0xFFFF6B6B), dangerSoft = Color(0x1FFF6B6B),
)

val LocalOperoColors = staticCompositionLocalOf { LightColors }

private fun scheme(c: OperoColors, dark: Boolean): ColorScheme =
    (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = c.primary, onPrimary = Color.White,
        primaryContainer = c.primarySoft, onPrimaryContainer = c.primary,
        background = c.bg, onBackground = c.text,
        surface = c.panel, onSurface = c.text,
        surfaceVariant = c.panel2, onSurfaceVariant = c.sub,
        surfaceContainerLowest = c.panel, surfaceContainerLow = c.panel, surfaceContainer = c.panel,
        surfaceContainerHigh = c.panel2, surfaceContainerHighest = c.panel2,
        outline = c.line, outlineVariant = c.line,
        error = c.danger, onError = Color.White, errorContainer = c.dangerSoft, onErrorContainer = c.danger,
    )

@Composable
fun OperoTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val c = if (dark) DarkColors else LightColors
    // 阿拉伯语从右往左：跟 Opero 设置的语言，不跟手机系统
    I18n.version // 换语言时重画
    val dir = if (I18n.rtl) LayoutDirection.Rtl else LayoutDirection.Ltr
    CompositionLocalProvider(LocalOperoColors provides c, LocalLayoutDirection provides dir) {
        MaterialTheme(colorScheme = scheme(c, dark), content = content)
    }
}

/** 在 Compose 里取 Opero 的颜色：Opero.colors.sub */
object Opero {
    val colors: OperoColors @Composable get() = LocalOperoColors.current
}
