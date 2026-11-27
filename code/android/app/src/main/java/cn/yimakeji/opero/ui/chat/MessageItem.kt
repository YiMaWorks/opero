package cn.yimakeji.opero.ui.chat

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.yimakeji.opero.data.FileInfo
import cn.yimakeji.opero.data.Live
import cn.yimakeji.opero.data.Message
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.common.Avatar
import cn.yimakeji.opero.ui.common.LocalHost
import cn.yimakeji.opero.ui.common.Markdown
import cn.yimakeji.opero.ui.common.RemoteImage
import cn.yimakeji.opero.ui.theme.Opero
import kotlinx.coroutines.delay

/** 一条消息怎么画（网页 Chat.tsx 的 MessageView）：像微信，对方在左、我在右，带头像；时间变了中间插一条时间 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageItem(
    m: Message,
    owner: String,
    showTime: Boolean,
    foot: Message?,
    working: String?,
    onCardAction: (Message, cn.yimakeji.opero.data.Card, cn.yimakeji.opero.data.CardAction, String?) -> Unit,
    onMenu: () -> Unit,
    onStop: () -> Unit,
    onImage: (FileInfo) -> Unit,
    onFile: (FileInfo) -> Unit,
) {
    val c = Opero.colors
    val host = LocalHost.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp)) {
        if (showTime && m.at.isNotBlank() && m.kind != "status") {
            Text(m.at, color = c.faint, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp))
        }
        when {
            m.kind == "system" -> Text(
                t(m.text.orEmpty()), color = c.faint, fontSize = 12.sp, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 2.dp),
            )
            m.kind == "status" && m.spinning -> Typing(owner, working ?: m.text, onStop)
            m.kind == "status" -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(c.ok))
                Text("  " + t(m.text.orEmpty()), color = c.faint, fontSize = 12.sp)
            }
            m.card?.type == "run" -> Row {
                Spacer(Modifier.width(46.dp))
                RunFoot(m.card!!) { card, a, ans -> onCardAction(m, card, a, ans) }
            }
            else -> {
                val me = m.from == "me"
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (me) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
                    if (!me) { Avatar(m.from, 38.dp); Spacer(Modifier.width(8.dp)) }
                    Column(
                        Modifier.weight(1f, fill = m.kind == "card").widthIn(max = if (m.kind == "card") 640.dp else 520.dp),
                        horizontalAlignment = if (me) Alignment.End else Alignment.Start,
                    ) {
                        if (!me && m.from != owner && m.from != "system") Text(Live.empName(m.from), color = c.faint, fontSize = 12.sp, modifier = Modifier.padding(bottom = 2.dp))
                        val hold = Modifier.combinedClickable(onClick = {}, onLongClick = { host.haptic(); onMenu() })
                        when {
                            m.kind == "file" && m.file != null -> FileBubble(m.file, hold, onImage, onFile)
                            m.kind == "card" && m.card != null -> Box(hold) { CardView(m.card) { card, a, ans -> onCardAction(m, card, a, ans) } }
                            me -> Text(
                                m.text.orEmpty(), color = Color.White, fontSize = 15.sp, lineHeight = 22.sp,
                                modifier = Modifier.clip(RoundedCornerShape(12.dp, 4.dp, 12.dp, 12.dp)).background(c.primary).then(hold).padding(horizontal = 12.dp, vertical = 9.dp),
                            )
                            else -> Box(Modifier.clip(RoundedCornerShape(4.dp, 12.dp, 12.dp, 12.dp)).background(c.panel).then(hold).padding(horizontal = 12.dp, vertical = 9.dp)) {
                                // 员工说的话不翻译（和网页 data-no-i18n 一样）；系统发的才翻
                                Markdown(if (m.from == "system") t(m.text.orEmpty()) else m.text.orEmpty())
                            }
                        }
                        foot?.let { fm -> fm.card?.let { fc -> RunFoot(fc) { card, a, ans -> onCardAction(fm, card, a, ans) } } }
                    }
                    if (me) { Spacer(Modifier.width(8.dp)); Avatar("me", 38.dp) }
                }
            }
        }
    }
}

/** 员工在干活：头像 + 跳动的三个点 + 在做什么 + 走秒（10 秒没变才显示）+ 停止 */
@Composable
private fun Typing(owner: String, what: String?, onStop: () -> Unit) {
    val c = Opero.colors
    val name = Live.empName(owner)
    val text = (what ?: "").removePrefix(name).trim().ifEmpty { t("在想…") }
    val dots = rememberInfiniteTransition(label = "dots")
    val a by dots.animateFloat(0.3f, 1f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "a")
    var since by remember(text) { mutableLongStateOf(System.currentTimeMillis()) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(text) { since = System.currentTimeMillis(); while (true) { now = System.currentTimeMillis(); delay(1000) } }
    val sec = ((now - since) / 1000).toInt()
    Row(verticalAlignment = Alignment.Top) {
        Avatar(owner, 38.dp)
        Spacer(Modifier.width(8.dp))
        Row(
            Modifier.clip(RoundedCornerShape(4.dp, 12.dp, 12.dp, 12.dp)).background(c.panel).padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("•••", color = c.primary, fontSize = 14.sp, modifier = Modifier.alpha(a))
            Text("  " + t(text), color = c.sub, fontSize = 14.sp, modifier = Modifier.weight(1f, fill = false))
            if (sec >= 10) Text(
                "  " + if (sec >= 60) t("已 {0} 分 {1} 秒", sec / 60, sec % 60) else t("已 {0} 秒", sec),
                color = c.faint, fontSize = 12.sp,
            )
            Text(
                "  " + t("停止"), color = c.danger, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable(onClick = onStop).padding(start = 4.dp),
            )
        }
    }
}

/** 图片（按比例占位，点开看大图）/ 文件（点了下载、用系统打开） */
@Composable
private fun FileBubble(f: FileInfo, hold: Modifier, onImage: (FileInfo) -> Unit, onFile: (FileInfo) -> Unit) {
    val c = Opero.colors
    val url = f.url
    if (f.image && url != null) {
        val ratio = if (f.w != null && f.h != null && f.h > 0) (f.w.toFloat() / f.h).coerceIn(0.4f, 2.5f) else 1.3f
        RemoteImage(
            url, Modifier.widthIn(max = 240.dp).fillMaxWidth(0.62f).aspectRatio(ratio).clip(RoundedCornerShape(10.dp)).background(c.panel2)
                .then(hold).clickable { onImage(f) },
            max = 960,
        ) { Text(f.name, color = c.faint, fontSize = 12.sp) }
        return
    }
    Row(
        Modifier.widthIn(max = 280.dp).clip(RoundedCornerShape(10.dp)).background(c.panel).then(hold).clickable(enabled = url != null) { onFile(f) }.padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            f.ext.ifBlank { "FILE" }, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(c.primary).padding(horizontal = 6.dp, vertical = 10.dp),
        )
        Column(Modifier.padding(start = 10.dp)) {
            Text(f.name, color = c.text, fontSize = 14.sp, maxLines = 2)
            Text(f.size + if (url != null) " · " + t("点开预览") else "", color = c.faint, fontSize = 12.sp)
        }
    }
}
