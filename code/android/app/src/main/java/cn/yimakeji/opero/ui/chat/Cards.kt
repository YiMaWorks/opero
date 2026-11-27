package cn.yimakeji.opero.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.yimakeji.opero.data.Card
import cn.yimakeji.opero.data.CardAction
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.common.LocalHost
import cn.yimakeji.opero.ui.theme.Opero
import java.util.Locale

/** 点了卡片上的按钮：action + ask 卡片选中的那个选项 */
typealias OnCardAction = (Card, CardAction, String?) -> Unit

private val INFO = Color(0xFF3B82F6)

/** 标签颜色：带「要你 / 等你 / 待」= 橙；带「完成 / 已 / 通过 / 正常」= 绿；其它灰（docs/api/卡片.md「通用显示」） */
@Composable
private fun tagColor(tag: String): Pair<Color, Color> {
    val c = Opero.colors
    return when {
        Regex("要你|等你|待|危险").containsMatchIn(tag) -> c.warn to c.warn.copy(alpha = 0.12f)
        Regex("完成|已|通过|正常").containsMatchIn(tag) -> c.ok to c.ok.copy(alpha = 0.12f)
        else -> c.sub to c.panel2
    }
}

/**
 * 卡片（docs/api/卡片.md）。不认识的种类按通用样子画（标题、标签、键值行、链接、按钮 / 结果），
 * issue / confirm / ask 多画它们自己的字段；run（一轮小结）不在这里，见 [RunFoot]。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CardView(card: Card, onAction: OnCardAction) {
    val c = Opero.colors
    val host = LocalHost.current
    val bar = when (card.level) { "danger" -> c.danger; "warn" -> c.warn; else -> INFO }
    var choice by rememberSaveable(card.id) { mutableIntStateOf(card.data.optInt("recommend", 0)) }
    var showDetail by rememberSaveable(card.id) { mutableStateOf(false) }

    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(12.dp)).background(c.panel)
            .border(0.5.dp, c.line, RoundedCornerShape(12.dp)),
    ) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(if (card.open) bar else c.line))
        Column(Modifier.weight(1f).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // 标题 + 标签
            Row(verticalAlignment = Alignment.Top) {
                Text(t(card.title), color = c.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                card.s("tag")?.let { tag ->
                    val (fg, bg) = tagColor(tag)
                    Text(t(tag), color = fg, fontSize = 11.sp, modifier = Modifier.padding(start = 8.dp).clip(RoundedCornerShape(50)).background(bg).padding(horizontal = 8.dp, vertical = 2.dp))
                }
            }
            if (card.type == "confirm") card.s("note")?.let { Text(t(it), color = c.faint, fontSize = 13.sp) }
            if (card.type == "confirm" && card.open) card.s("why")?.let { Text(t(it), color = c.sub, fontSize = 14.sp) }
            // 键值行
            val rows = card.rows
            if (rows.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for ((k, v) in rows) Row {
                    Text(t(k), color = c.faint, fontSize = 13.sp, modifier = Modifier.width(88.dp))
                    Text(t(v), color = c.text, fontSize = 13.sp, modifier = Modifier.weight(1f))
                }
            }
            // issue 的日志片段、confirm 的具体命令：默认收起
            val mono = if (card.type == "issue") card.s("sample") else if (card.type == "confirm") card.s("detail") else null
            if (mono != null) {
                Text(
                    if (showDetail) t("收起") else if (card.type == "issue") t("看日志片段") else t("看具体命令 / 内容"),
                    color = c.primary, fontSize = 13.sp, modifier = Modifier.clickable { showDetail = !showDetail },
                )
                if (showDetail) Text(
                    mono, color = c.text, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 17.sp, softWrap = false,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.panel2).horizontalScroll(rememberScrollState()).padding(10.dp),
                )
            }
            // ask：单选，默认选推荐的
            val options = card.data.optJSONArray("options")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
            if (card.type == "ask" && card.open && options.isNotEmpty()) Column {
                options.forEachIndexed { i, o ->
                    Row(Modifier.fillMaxWidth().clickable { choice = i }, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = choice == i, onClick = { choice = i }, colors = RadioButtonDefaults.colors(selectedColor = c.primary))
                        Text(o, color = c.text, fontSize = 14.sp)
                        if (i == card.data.optInt("recommend", -1)) Text("  " + t("推荐"), color = c.faint, fontSize = 12.sp)
                    }
                }
            }
            card.s("url")?.takeIf { it.startsWith("http://") || it.startsWith("https://") }?.let { url ->
                Text(t("打开") + " ↗", color = c.primary, fontSize = 13.sp, modifier = Modifier.clickable { host.openExternal(url) })
            }
            if (card.open && card.actions.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (a in card.actions) {
                    val answer = if (card.type == "ask") options.getOrNull(choice) else null
                    ActionButton(a) { onAction(card, a, answer) }
                }
            }
            if (!card.open && card.result != null) Text("✓ " + t(card.result), color = c.sub, fontSize = 13.sp)
        }
    }
}

@Composable
private fun ActionButton(a: CardAction, onClick: () -> Unit) {
    val c = Opero.colors
    val shape = RoundedCornerShape(8.dp)
    when (a.style) {
        "primary" -> Button(onClick, shape = shape, colors = ButtonDefaults.buttonColors(containerColor = c.primary, contentColor = Color.White)) { Text(t(a.label), fontSize = 14.sp) }
        "danger" -> Button(onClick, shape = shape, colors = ButtonDefaults.buttonColors(containerColor = c.danger, contentColor = Color.White)) { Text(t(a.label), fontSize = 14.sp) }
        "ghost" -> TextButton(onClick, shape = shape) { Text(t(a.label), color = c.sub, fontSize = 14.sp) }
        else -> OutlinedButton(onClick, shape = shape) { Text(t(a.label), color = c.text, fontSize = 14.sp) }
    }
}

private fun usd(v: Double) = "$" + String.format(Locale.US, if (v >= 10) "%.1f" else "%.2f", v)

/**
 * 一轮做完的小结（run 卡片）：挂在员工这一轮最后一句下面的一行小字，不画成卡片。
 * ✓ 本次完成 · 已推送 abc1234 · 3 个文件 +12 −4 · 本次 $0.42 · 会话 $3.10（订阅）· 撤销 / 发布
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RunFoot(card: Card, onAction: OnCardAction) {
    val c = Opero.colors
    val d = card.data
    var more by rememberSaveable(card.id) { mutableStateOf(false) }
    val ok = d.optBoolean("ok")
    val stopped = d.optBoolean("stopped")
    val git = d.optString("git")
    val hash = Regex("推送到远端（([0-9a-f]{7,})").find(git)?.groupValues?.get(1)
    val gitShort = when {
        hash != null -> t("已推送 {0}", hash)
        Regex("推送失败|没推上去").containsMatchIn(git) -> t("没推送上去")
        git.contains("已提交") -> t("已提交")
        else -> t(git)
    }
    val files = d.optInt("files", 0)
    val small = 12.sp
    Column(Modifier.padding(top = 4.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                if (ok) "✓ " + t("本次完成") else if (stopped) "■ " + t("你让停下了") else "! " + t("这一轮没做完"),
                color = if (ok) c.ok else c.warn, fontSize = small,
            )
            if (gitShort.isNotBlank()) Text(gitShort, color = c.faint, fontSize = small)
            if (files > 0) Text(
                t("{0} 个文件", files) + " +${d.optInt("ins")} −${d.optInt("del")}", color = c.sub, fontSize = small,
                modifier = Modifier.clickable { more = !more },
            )
            Text(
                t("本次") + " " + usd(d.optDouble("cost", 0.0)) + " · " + t("会话") + " " + usd(d.optDouble("sessionCost", 0.0)) +
                    "（" + (if (d.optString("billing") == "sub") t("订阅") else t("按量")) + "）",
                color = c.faint, fontSize = small,
            )
            if (card.open) for (a in card.actions) {
                val label = if (a.id == "revert") t("撤销") else t(a.label).replace(t("这次改动"), "").ifBlank { t("发布") }
                Text(
                    label, color = if (a.style == "primary") c.primary else c.sub, fontSize = small,
                    fontWeight = if (a.style == "primary") FontWeight.SemiBold else FontWeight.Normal,
                    modifier = Modifier.clickable { onAction(card, a, null) },
                )
            }
            if (!card.open && card.result != null) Text(t(card.result), color = c.sub, fontSize = small)
        }
        val list = d.optJSONArray("list")
        if (more && list != null && list.length() > 0) Column(Modifier.padding(top = 4.dp)) {
            for (i in 0 until list.length()) {
                val f = list.optJSONObject(i) ?: continue
                Row {
                    Text(f.optString("f"), color = c.sub, fontSize = small, fontFamily = FontFamily.Monospace, modifier = Modifier.weight(1f))
                    Text(" +${f.optInt("a")}", color = c.ok, fontSize = small)
                    Text(" −${f.optInt("d")}", color = c.danger, fontSize = small)
                }
            }
            if (files > list.length()) Text(t("还有 {0} 个文件", files - list.length()), color = c.faint, fontSize = small)
        }
    }
}
