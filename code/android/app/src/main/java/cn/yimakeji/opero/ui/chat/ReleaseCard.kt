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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.yimakeji.opero.data.Card
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.common.LocalHost
import cn.yimakeji.opero.ui.theme.Opero
import kotlinx.coroutines.delay
import org.json.JSONObject

/** 发布卡片里的一步（data.steps[]）：s = pending / running / done / failed；est = 上次成功时这一步用了多少毫秒，0 = 不知道 */
private class Step(val label: String, val s: String, val msg: String, val t0: Long, val t1: Long, val est: Long)

/** 用时：「12 秒」「3 分 5 秒」 */
private fun dur(ms: Long): String {
    val sec = (ms / 1000).coerceAtLeast(0)
    return if (sec >= 60) t("{0} 分 {1} 秒", sec / 60, sec % 60) else t("{0} 秒", sec)
}

/** 这张卡片是新格式的发布卡片（`data.rel` 有值）：原生画；没有就按通用卡片画 */
fun isReleaseCard(card: Card) = card.type == "release" && card.data.optString("rel").isNotEmpty()

/**
 * 发布卡片（docs/规范/表单与卡片.md「发布卡片」，网页 components/cards.tsx 的 ReleaseCard）：
 * 「发布」+ 环境（生产红）+ 状态和总用时 → 项目 → 环境 → 版本 → 总进度条 → 步骤时间线 → 失败原因 + 日志 / 成功「线上已经是 …」→ 按钮。
 * 按钮都不把卡片标成点过（rel:fix / rel:retry / rel:rollback:<id> 调接口、结果提示一句；rel:view 打开发布详情）。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReleaseCard(card: Card, onAction: OnCardAction) {
    val c = Opero.colors
    val host = LocalHost.current
    val d = card.data
    val status = d.optString("status")
    val running = status == "running"
    val prod = d.optBoolean("prod")
    val steps = remember(d) {
        val a = d.optJSONArray("steps")
        (0 until (a?.length() ?: 0)).mapNotNull { i -> a?.optJSONObject(i) }.map { o: JSONObject ->
            Step(o.optString("label"), o.optString("s"), o.optString("msg"), o.optLong("t0"), o.optLong("t1"), o.optLong("est"))
        }
    }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(running) { while (running) { now = System.currentTimeMillis(); delay(1000) } }
    var showLog by rememberSaveable(card.id) { mutableStateOf(false) }
    val started = d.optLong("started")
    val end = if (running) now else d.optLong("ended").takeIf { it > 0 } ?: now
    val tone = when (status) { "success" -> c.ok; "failed" -> c.danger; else -> c.primary }

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.panel).border(0.5.dp, c.line, RoundedCornerShape(12.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // 发布 · 环境 · 状态 + 用时
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(if (d.optBoolean("rollback")) t("回滚") else t("发布"), color = c.sub, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            d.optString("env").ifBlank { null }?.let { env ->
                val col = if (prod) c.danger else c.sub
                Text(t(env), color = col, fontSize = 11.sp, modifier = Modifier.clip(RoundedCornerShape(50)).background(col.copy(alpha = 0.12f)).padding(horizontal = 7.dp, vertical = 1.dp))
            }
            Box(Modifier.weight(1f))
            Text(
                when (status) { "success" -> t("已发布"); "failed" -> t("失败"); else -> t("发布中") } + if (started > 0) " · " + dur(end - started) else "",
                color = tone, fontSize = 12.sp, fontWeight = FontWeight.Medium,
            )
        }
        // 项目 → 环境
        Text(
            listOf(d.optString("app"), d.optString("target")).filter { it.isNotBlank() }.joinToString(" → ").ifBlank { t(card.title) },
            color = c.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
        )
        // 版本 · 提交 · 组件 · 谁发的
        val ver = listOfNotNull(
            d.optString("version").ifBlank { null },
            d.optString("sha").take(7).ifBlank { null },
            d.optString("comp").ifBlank { null },
            d.optString("by").ifBlank { null },
        ).joinToString(" · ")
        if (ver.isNotEmpty()) Text(ver, color = c.faint, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
        d.optString("note").ifBlank { null }?.let { Text(it, color = c.sub, fontSize = 13.sp) }

        // 总进度：做完的步数 + 正在做的那步按上次用时估（最多 90%）
        if (steps.isNotEmpty()) {
            val doneN = steps.count { it.s == "done" }
            val cur = steps.firstOrNull { it.s == "running" }
            val part = if (cur != null && cur.est > 0 && cur.t0 > 0) ((now - cur.t0).toFloat() / cur.est).coerceIn(0f, 0.9f) else 0f
            val frac = if (status == "success") 1f else ((doneN + part) / steps.size).coerceIn(0f, 1f)
            Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(c.panel2)) {
                Box(Modifier.fillMaxWidth(frac).height(4.dp).clip(RoundedCornerShape(2.dp)).background(tone))
            }
            // 步骤时间线
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (st in steps) Row(verticalAlignment = Alignment.Top) {
                    val (icon, col) = when (st.s) {
                        "done" -> "✓" to c.ok
                        "failed" -> "✕" to c.danger
                        "running" -> "●" to c.primary
                        else -> "○" to c.faint
                    }
                    Text(icon, color = col, fontSize = 13.sp, modifier = Modifier.width(18.dp))
                    Column(Modifier.weight(1f)) {
                        Text(t(st.label), color = if (st.s == "pending") c.faint else c.text, fontSize = 13.sp)
                        if (st.msg.isNotBlank()) Text(t(st.msg), color = c.faint, fontSize = 12.sp)
                    }
                    val time = when {
                        st.s == "running" && st.t0 > 0 -> t("已用 {0}", dur(now - st.t0)) + if (st.est > 0) " / " + t("约 {0}", dur(st.est)) else ""
                        (st.s == "done" || st.s == "failed") && st.t0 > 0 && st.t1 > 0 -> dur(st.t1 - st.t0)
                        st.s == "pending" && st.est > 0 -> t("约 {0}", dur(st.est))
                        else -> ""
                    }
                    if (time.isNotEmpty()) Text(time, color = c.faint, fontSize = 11.sp, modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
        // 失败：原因 + 日志；成功：线上已经是 …
        if (status == "failed") {
            d.optString("reason").ifBlank { null }?.let {
                Text(t(it), color = c.danger, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.dangerSoft).padding(8.dp))
            }
            if (d.optBoolean("autoFix")) Text(t("失败原因已经发给员工，它会接着修"), color = c.sub, fontSize = 12.sp)
            d.optString("log").ifBlank { null }?.let { log ->
                Text(if (showLog) t("收起") else t("看日志"), color = c.primary, fontSize = 13.sp, modifier = Modifier.clickable { showLog = !showLog })
                if (showLog) Text(
                    log, color = c.text, fontFamily = FontFamily.Monospace, fontSize = 11.5.sp, lineHeight = 16.sp, softWrap = false,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.panel2).horizontalScroll(rememberScrollState()).padding(10.dp),
                )
            }
        }
        if (status == "success") d.optString("version").ifBlank { null }?.let { Text(t("线上已经是 {0}", it), color = c.ok, fontSize = 13.sp) }
        // 发到哪几台、流水线链接
        val servers = d.optJSONArray("servers")?.let { a -> (0 until a.length()).map { a.optString(it) } }?.filter { it.isNotBlank() } ?: emptyList()
        if (servers.isNotEmpty()) Text(t("发到") + " " + servers.joinToString("、"), color = c.faint, fontSize = 12.sp)
        d.optString("url").takeIf { it.startsWith("http://") || it.startsWith("https://") }?.let { url ->
            Text(t("看流水线") + " ↗", color = c.primary, fontSize = 13.sp, modifier = Modifier.clickable { host.openExternal(url) })
        }
        if (card.actions.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (a in card.actions) ActionButton(a) { onAction(card, a, null) }
        }
        if (!card.open && card.result != null) Text("✓ " + t(card.result), color = c.sub, fontSize = 13.sp)
    }
}

