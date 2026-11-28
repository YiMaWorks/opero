package cn.yimakeji.opero.ui.sessions

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.yimakeji.opero.data.Live
import cn.yimakeji.opero.data.Session
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.common.Avatar
import cn.yimakeji.opero.ui.common.Dot
import cn.yimakeji.opero.ui.common.LocalHost
import cn.yimakeji.opero.ui.theme.Opero
import kotlinx.coroutines.launch

private const val FOLD_AT = 4 // 置顶超过这么多个就可以折叠

/**
 * 会话列表（网页 components/SessionList.tsx）：像微信。置顶的在最上面（底色稍深，多了能折叠），其余按最近时间排；
 * 要你处理的在预览前面加「[要你确认]」+ 红点。长按：置顶 / 免打扰。右上：搜索、找员工聊。
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun SessionListScreen(onOpen: (String) -> Unit) {
    val c = Opero.colors
    val scope = rememberCoroutineScope()
    var folded by rememberSaveable { mutableStateOf(false) }
    var search by rememberSaveable { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf<Session?>(null) }
    var picking by remember { mutableStateOf(false) }

    val q = search?.trim().orEmpty()
    val sorted = Live.sessions.sortedByDescending { it.ts }.filter { s ->
        q.isEmpty() || (Live.employee(s.employee)?.name ?: "").contains(q, true) || s.last.contains(q, true)
    }
    val pinned = sorted.filter { it.pinned }
    val rest = sorted.filter { !it.pinned }
    val canFold = pinned.size >= FOLD_AT && q.isEmpty()

    Column(Modifier.fillMaxSize().background(c.bg)) {
        // 顶栏：Opero ·（没连上时说一声）· 搜索 · 找员工聊
        Row(Modifier.fillMaxWidth().background(c.panel).padding(horizontal = 8.dp).height(52.dp), verticalAlignment = Alignment.CenterVertically) {
            if (search == null) {
                Spacer(Modifier.width(8.dp))
                Text("Opero", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = c.text)
                if (!Live.connected && Live.ready) Text("  " + t("连接中…"), fontSize = 12.sp, color = c.faint)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { search = "" }) { Text(t("搜索"), color = c.sub) }
                TextButton(onClick = { picking = true }) { Text("＋", fontSize = 22.sp, color = c.text) }
            } else {
                OutlinedTextField(
                    value = search ?: "", onValueChange = { search = it }, singleLine = true,
                    placeholder = { Text(t("搜索员工、聊天记录"), color = c.faint) },
                    modifier = Modifier.weight(1f).padding(vertical = 4.dp), shape = RoundedCornerShape(10.dp),
                )
                TextButton(onClick = { search = null }) { Text(t("取消"), color = c.sub) }
            }
        }
        if (!Live.ready) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(Live.bootError ?: t("加载中…"), color = c.faint) }
            return@Column
        }
        LazyColumn(Modifier.fillMaxSize()) {
            if (canFold) item("fold") {
                Row(
                    Modifier.fillMaxWidth().combinedClickable(onClick = { folded = !folded }).padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(t("{0} 个置顶聊天", pinned.size), color = c.sub, fontSize = 13.sp, modifier = Modifier.weight(1f))
                    Text(if (folded) "▾" else "▴", color = c.faint)
                }
            }
            if (!(canFold && folded)) items(pinned, key = { "s:" + it.id }) { s -> Item(s, onOpen) { menu = s } }
            items(rest, key = { "s:" + it.id }) { s -> Item(s, onOpen) { menu = s } }
            if (sorted.isEmpty()) item("empty") {
                Text(
                    if (q.isEmpty()) t("还没有会话：点右上角 ＋ 找个员工聊") else t("没找到"),
                    color = c.faint, modifier = Modifier.fillMaxWidth().padding(32.dp),
                )
            }
        }
    }

    menu?.let { s ->
        val muted = Live.employee(s.employee)?.notify == "none"
        ModalBottomSheet(onDismissRequest = { menu = null }, containerColor = c.panel) {
            Text(Live.empName(s.employee), color = c.sub, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            SheetRow(if (s.pinned) t("取消置顶") else t("置顶聊天")) { Live.togglePin(s.id); menu = null }
            SheetRow(if (muted) t("取消免打扰") else t("消息免打扰")) { Live.toggleMute(s.id); menu = null }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (picking) EmployeePicker(t("找员工聊"), exclude = null, onDismiss = { picking = false }) { emp ->
        picking = false
        scope.launch { Live.sessionFor(emp)?.let(onOpen) }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Item(s: Session, onOpen: (String) -> Unit, onMenu: () -> Unit) {
    val c = Opero.colors
    val host = LocalHost.current
    val e = Live.employee(s.employee) ?: return
    val badge = Live.badgeOf(s, e)
    Row(
        Modifier.fillMaxWidth().background(if (s.pinned) c.panel2 else c.panel)
            .combinedClickable(onClick = { onOpen(s.id) }, onLongClick = { host.haptic(); onMenu() })
            .padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Avatar(e.id, 48.dp)
            when {
                badge == "red" -> Box(
                    Modifier.align(Alignment.TopEnd).padding(start = 30.dp).clip(CircleShape).background(c.danger).padding(horizontal = 5.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    val n = maxOf(1, s.unread)
                    Text(if (n > 99) "99+" else n.toString(), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
                s.working != null -> Dot(c.ok, 12.dp, Modifier.align(Alignment.BottomEnd))
                badge == "grey" -> Dot(c.faint, 10.dp, Modifier.align(Alignment.TopEnd))
            }
        }
        Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(e.name, color = c.text, fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(s.time, color = c.faint, fontSize = 12.sp)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                val line = s.working ?: s.last
                Row(Modifier.weight(1f)) {
                    if (s.working == null && s.waiting != null) Text("[${t(s.waiting)}]", color = c.warn, fontSize = 13.sp, maxLines = 1)
                    Text(
                        line, color = if (s.working != null) c.ok else c.faint, fontSize = 13.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (e.notify == "none") Text(" 🔕", fontSize = 12.sp, color = c.faint)
            }
        }
    }
    HorizontalDivider(color = c.line, thickness = 0.5.dp, modifier = Modifier.padding(start = 74.dp))
}

@Composable
fun SheetRow(text: String, color: Color = Opero.colors.text, onClick: () -> Unit) {
    Text(
        text, color = color, fontSize = 16.sp,
        modifier = Modifier.fillMaxWidth().combinedClickableCompat(onClick).padding(horizontal = 20.dp, vertical = 14.dp),
    )
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableCompat(onClick: () -> Unit) = this.combinedClickable(onClick = onClick)

/** 选一个员工（找员工聊、转给别的员工） */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmployeePicker(title: String, exclude: String?, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val c = Opero.colors
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = c.panel) {
        Text(title, color = c.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
        LazyColumn {
            items(Live.employees.filter { it.id != exclude }, key = { it.id }) { e ->
                Row(
                    Modifier.fillMaxWidth().combinedClickableCompat { onPick(e.id) }.padding(horizontal = 20.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(e.id, 36.dp)
                    Column(Modifier.padding(start = 12.dp)) {
                        Text(e.name, color = c.text, fontSize = 15.sp)
                        if (e.title.isNotBlank()) Text(e.title, color = c.faint, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}
