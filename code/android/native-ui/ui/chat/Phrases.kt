package cn.yimakeji.opero.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import cn.yimakeji.opero.data.Live
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.common.LocalHost
import cn.yimakeji.opero.ui.theme.Opero
import kotlinx.coroutines.launch

/**
 * 常用语（网页 Chat.tsx 的 sendPhrase / useReorder）：放在输入框上面那排小标签里（调用方是一个横着能滑的 Row，间距 [gap]）。
 *   - 平时：点一下直接发给员工（POST /api/sessions/:id/messages {text, files: [], mode: auto}），不动输入框里正在写的、不带待发附件；
 *     员工在干活插不进去会排队，提示「已排队」。
 *   - 编辑时：长按一个拖动调顺序，松手存 PUT /api/settings {phrases}（就是数组顺序，各端共用）；右边 × 删掉。
 */
@Composable
fun PhraseChips(sid: String, phrases: List<String>, editing: Boolean, gap: Dp) {
    val c = Opero.colors
    val host = LocalHost.current
    val scope = rememberCoroutineScope()
    val gapPx = with(LocalDensity.current) { gap.toPx() }
    // 拖的时候先在本地排，松手再存；后台推来新的顺序（别的设备改了）就跟着换
    val order = remember(phrases) { phrases.toMutableStateList() }
    val widths = remember { mutableStateMapOf<String, Float>() }
    var dragging by remember { mutableStateOf<String?>(null) }
    var startLeft by remember { mutableFloatStateOf(0f) } // 开始拖时它的左边（相对第一个常用语）
    var moved by remember { mutableFloatStateOf(0f) }      // 手指一共挪了多少
    var sending by remember { mutableStateOf<String?>(null) }

    /** 第 i 个位置的左边：前面几个的宽 + 间距（只用宽度算，不依赖布局还没更新的位置） */
    fun leftOf(i: Int): Float = (0 until i).sumOf { (widths[order[it]] ?: 0f).toDouble() + gapPx }.toFloat()

    fun finish() {
        dragging = null
        moved = 0f
        val now = order.toList()
        if (now != phrases) Live.savePhrases(now)
    }

    for (p in order) key(p) {
        val short = p.replace(Regex("\\s+"), " ").trim().let { if (it.codePointCount(0, it.length) > 6) it.take(6) + "…" else it }
        val me = dragging == p
        val shift = if (me) startLeft + moved - leftOf(order.indexOf(p)) else 0f
        Row(
            Modifier
                .zIndex(if (me) 1f else 0f)
                .graphicsLayer { translationX = shift; if (me) { scaleX = 1.08f; scaleY = 1.08f } }
                .onGloballyPositioned { widths[p] = it.size.width.toFloat() }
                .clip(RoundedCornerShape(50))
                .background(if (me) c.primarySoft else c.panel2)
                .then(
                    if (editing) Modifier.pointerInput(p) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = { dragging = p; startLeft = leftOf(order.indexOf(p)); moved = 0f; host.haptic() },
                            onDrag = { change, delta ->
                                change.consume()
                                moved += delta.x
                                // 手指（它的中心）挪到了第几个位置：一格格往后数
                                val w = widths[p] ?: 0f
                                val center = startLeft + moved + w / 2
                                var target = 0
                                val rest = order.filter { it != p }
                                var x = 0f
                                for (q in rest) {
                                    val qw = widths[q] ?: 0f
                                    if (center > x + qw / 2) { target++; x += qw + gapPx } else break
                                }
                                val from = order.indexOf(p)
                                if (target != from) { order.removeAt(from); order.add(target, p) }
                            },
                            onDragEnd = { finish() },
                            onDragCancel = { finish() },
                        )
                    } else Modifier.clickable(enabled = sending == null) {
                        sending = p
                        scope.launch { try { Live.send(sid, p, emptyList(), "auto") } finally { sending = null } }
                    },
                )
                .padding(start = 10.dp, end = if (editing) 4.dp else 10.dp, top = 5.dp, bottom = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(if (sending == p) "$short…" else short, color = c.sub, fontSize = 13.sp, maxLines = 1)
            if (editing) Text(
                "×", color = c.faint, fontSize = 15.sp,
                modifier = Modifier.clip(RoundedCornerShape(50)).clickable { Live.savePhrases(order.filter { it != p }) }.padding(horizontal = 6.dp),
            )
        }
    }
    if (editing && order.size > 1) Text(t("长按拖动排序"), color = c.faint, fontSize = 12.sp)
}
