package cn.yimakeji.opero.ui.common

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** 线条图标：和网页 components/icons.tsx 同一套路径（24×24、描边 1.8、圆头），用 Icon(tint = …) 上色 */
object OperoIcons {
    private fun icon(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            for (d in paths) addPath(
                pathData = PathParser().parsePathString(d).toNodes(),
                stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f,
                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
            )
        }.build()

    val Chat by lazy { icon("chat", "M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z") }
    val People by lazy { icon("people", "M6.0,8.5a3.5,3.5 0 1,0 7.0,0a3.5,3.5 0 1,0 -7.0,0", "M3 20c0-4 3-6 6.5-6s6.5 2 6.5 6", "M16 5a3.5 3.5 0 0 1 0 7M18 14.5c2 .8 3 2.6 3 5.5") }
    val Workspace by lazy { icon("workspace", "M3 6.5h6.5l2 2H21V19H3z") }
    val Apps by lazy {
        icon(
            "apps",
            "M5.5,3.5h3a2,2 0 0 1 2,2v3a2,2 0 0 1 -2,2h-3a2,2 0 0 1 -2,-2v-3a2,2 0 0 1 2,-2z",
            "M15.5,3.5h3a2,2 0 0 1 2,2v3a2,2 0 0 1 -2,2h-3a2,2 0 0 1 -2,-2v-3a2,2 0 0 1 2,-2z",
            "M5.5,13.5h3a2,2 0 0 1 2,2v3a2,2 0 0 1 -2,2h-3a2,2 0 0 1 -2,-2v-3a2,2 0 0 1 2,-2z",
            "M15.5,13.5h3a2,2 0 0 1 2,2v3a2,2 0 0 1 -2,2h-3a2,2 0 0 1 -2,-2v-3a2,2 0 0 1 2,-2z",
        )
    }
    val Me by lazy { icon("me", "M8,8a4,4 0 1,0 8,0a4,4 0 1,0 -8,0", "M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7") }
    val Search by lazy { icon("search", "M4.5,11a6.5,6.5 0 1,0 13.0,0a6.5,6.5 0 1,0 -13.0,0", "M16 16l4.5 4.5") }
    val Plus by lazy { icon("plus", "M12 5v14M5 12h14") }
    val Mic by lazy { icon("mic", "M12,3h0a3,3 0 0 1 3,3v5a3,3 0 0 1 -3,3h0a3,3 0 0 1 -3,-3v-5a3,3 0 0 1 3,-3z", "M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21") }
    val Back by lazy { icon("back", "M15 5l-7 7 7 7") }
    val BellOff by lazy { icon("bellOff", "M9.5 19a2.5 2.5 0 0 0 5 0M6 8a6 6 0 0 1 10.3-4.2M18 10v3.5l1.5 2.5H7M4 4l16 16") }
    val Send by lazy { icon("send", "M4 12l16-8-6 16-2.5-6.5z") }
}
