package cn.yimakeji.opero.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import cn.yimakeji.opero.data.Api
import cn.yimakeji.opero.data.ApiError
import cn.yimakeji.opero.data.Card
import cn.yimakeji.opero.data.CardAction
import cn.yimakeji.opero.data.FileInfo
import cn.yimakeji.opero.data.Live
import cn.yimakeji.opero.data.Message
import cn.yimakeji.opero.data.QueueItem
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.push.VisibleRoute
import cn.yimakeji.opero.ui.Routes
import cn.yimakeji.opero.ui.common.Avatar
import cn.yimakeji.opero.ui.common.LocalHost
import cn.yimakeji.opero.ui.common.copy
import cn.yimakeji.opero.ui.sessions.EmployeePicker
import cn.yimakeji.opero.ui.sessions.SheetRow
import cn.yimakeji.opero.ui.theme.Opero
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 聊天（网页 components/Chat.tsx 的手机版）：顶栏、消息、上下文提示、排队、输入。
 * 列表倒着排（最新的在最下面、index 0）：贴底自然跟着新消息走；往上翻到顶加载更早的。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(requested: String, onBack: () -> Unit, onOpenRoute: (String) -> Unit, onOpenChat: (String) -> Unit) {
    val c = Opero.colors
    // 「开新会话接着做」/ 换了执行器：原来的会话归档了，跟到同一个员工的新会话
    val empOf = remember(requested) { mutableStateOf(Live.session(requested)?.employee) }
    if (empOf.value == null) Live.session(requested)?.employee?.let { empOf.value = it }
    val sid = if (Live.session(requested) != null) requested else Live.sessions.firstOrNull { it.employee == empOf.value }?.id ?: requested
    val ctx = LocalContext.current
    val host = LocalHost.current
    val scope = rememberCoroutineScope()
    val session = Live.session(sid)
    val emp = Live.employee(session?.employee)
    if (session == null || emp == null) {
        Box(Modifier.fillMaxSize().background(c.bg), contentAlignment = Alignment.Center) {
            Text(if (Live.ready) t("这个会话不在了") else t("加载中…"), color = c.faint)
        }
        return
    }
    val store = Api.store
    var text by remember(sid) { mutableStateOf(store.draft(sid)) }
    var sending by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<Message?>(null) }
    var forward by remember { mutableStateOf<Message?>(null) }
    var viewer by remember { mutableStateOf<String?>(null) } // 看大图：从哪条消息开始
    var editQ by remember { mutableStateOf<QueueItem?>(null) }
    var ctxTick by remember { mutableIntStateOf(0) }

    // 正在看这个会话：来了就算已读；推送不再为它弹通知
    LaunchedEffect(sid, session.unread) { if (session.unread > 0) Live.markRead(sid) }
    val life = LocalLifecycleOwner.current
    DisposableEffect(sid, life) {
        val me = "chat/$sid"
        // App 到后台就不算在看了：那时来的推送要弹
        val obs = LifecycleEventObserver { _, ev ->
            if (ev == Lifecycle.Event.ON_RESUME) VisibleRoute.route = me
            if (ev == Lifecycle.Event.ON_PAUSE && VisibleRoute.route == me) VisibleRoute.route = null
        }
        life.lifecycle.addObserver(obs)
        if (life.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) VisibleRoute.route = me
        onDispose { life.lifecycle.removeObserver(obs); if (VisibleRoute.route == me) VisibleRoute.route = null }
    }
    // 开新会话接着做：交接预填进输入框，看一下再发
    LaunchedEffect(session.draft) { session.draft?.let { text = it; Live.clearDraft(sid) } }
    LaunchedEffect(text) { store.setDraft(sid, text) }

    // 要显示的消息：空的系统行不要；「在干活」气泡永远在最下面；一轮小结挂在员工上一条下面
    val raw = Live.messages[sid] ?: emptyList()
    val shown = remember(raw) {
        val keep = raw.filter { !((it.kind == "system" || it.kind == "status") && !it.spinning && it.text.isNullOrBlank()) }
        floatReleases(keep.filter { !(it.kind == "status" && it.spinning) }) + keep.filter { it.kind == "status" && it.spinning }
    }
    val feet = remember(shown) {
        val at = HashMap<String, Message>()
        shown.forEachIndexed { i, m ->
            if (m.card?.type != "run") return@forEachIndexed
            for (j in i - 1 downTo 0) {
                val p = shown[j]
                if (p.kind == "status" || p.kind == "system" || p.card?.let { isReleaseCard(it) } == true) continue // 发布卡片挪过位置，小结不挂它
                if (p.from == m.from && p.card?.type != "run" && !at.containsKey(p.id)) at[p.id] = m
                break
            }
        }
        at
    }
    val attached = remember(feet) { feet.values.map { it.id }.toHashSet() }
    val visible = remember(shown, attached) { shown.filter { it.id !in attached }.asReversed() }
    /** 上一条的时间（时间变了才插时间分隔） */
    val prevAt = remember(shown) { HashMap<String, String>().also { mp -> shown.forEachIndexed { i, m -> if (i > 0) mp[m.id] = shown[i - 1].at } } }

    // 贴底 / 新消息提示 / 往上翻加载
    val list = rememberLazyListState()
    var unseen by remember { mutableIntStateOf(0) }
    var lastCount by remember { mutableIntStateOf(visible.size) }
    LaunchedEffect(visible.size) {
        val added = visible.size - lastCount
        lastCount = visible.size
        if (added <= 0) return@LaunchedEffect
        val mine = visible.take(added).any { it.from == "me" }
        if (list.firstVisibleItemIndex <= 1 || mine) { list.scrollToItem(0); unseen = 0 } else unseen += added
    }
    LaunchedEffect(list) {
        snapshotFlow { list.firstVisibleItemIndex }.distinctUntilChanged().collect { if (it <= 1) unseen = 0 }
    }
    LaunchedEffect(list, sid) {
        snapshotFlow { list.layoutInfo.let { (it.visibleItemsInfo.lastOrNull()?.index ?: 0) to it.totalItemsCount } }.distinctUntilChanged().collect { (last, total) ->
            if (total > 3 && last >= total - 2) Live.loadOlder(sid)
        }
    }

    fun send(mode: String) {
        val pend = Pending.of(sid)
        if (pend.any { it.busy }) { Live.toast(t("附件还在传，等一下")); return }
        val atts = pend.mapNotNull { it.att }
        val v = text.trim()
        if (v.isEmpty() && atts.isEmpty()) return
        sending = true
        scope.launch {
            val r = Live.send(sid, v, atts, mode)
            sending = false
            if (r != null) { text = ""; pend.clear(); list.scrollToItem(0) }
        }
    }

    /** 卡片按钮：panel → 打开对应网页页面；危险的先验证本人；接口要验证（403 VERIFY）就验了再点一次 */
    fun act(m: Message, card: Card, a: CardAction, answer: String?) {
        a.panel?.let { panel ->
            val params = HashMap<String, String?>()
            a.args?.let { o -> o.keys().forEach { k -> params[k] = o.optString(k) } }
            onOpenRoute(Routes.seg(panel, params))
            return
        }
        suspend fun go(): Boolean {
            return try {
                val r = Api.owner("POST", "/api/messages/${m.id}/action", JSONObject().put("action", a.id).apply { if (answer != null) put("answer", answer) })
                // 不改卡片状态的按钮（发布卡片的修 / 重发 / 回滚、合并请求的刷新）：结果提示一句
                val result = r.optString("result")
                if (result.isNotBlank() && (a.id.startsWith("rel:") || a.id == "refresh")) Live.toast(t(result))
                true
            } catch (e: ApiError) {
                if (e.code == "VERIFY") false else { Live.toast(e.message ?: t("出错了")); true }
            }
        }
        val title = card.title.ifBlank { t("确认") }
        val why = card.s("why")
        if (a.style == "danger") { host.verify(title, why) { ok -> if (ok) scope.launch { go() } }; return }
        scope.launch { if (!go()) host.verify(title, why) { ok -> if (ok) scope.launch { go() } } }
    }

    /** 取到文件再做事（下载 / 分享 / 打开）：下载地址带 dl=1（docs/api/README.md「文件和图片地址」） */
    fun withBytes(f: FileInfo, then: (ByteArray) -> Unit) {
        val url = f.url ?: run { Live.toast(t("这个文件还没传好")); return }
        Live.toast(t("正在下载…"))
        scope.launch {
            try { then(Api.bytes(url + (if ('?' in url) "&" else "?") + "dl=1")) } catch (e: ApiError) { Live.toast(e.message ?: t("下载失败")) }
        }
    }
    fun saveFile(f: FileInfo) = withBytes(f) { host.saveFile(f.name, it, mimeOf(f.name)) }
    fun shareFile(f: FileInfo) = withBytes(f) { host.shareFile(f.name, it, mimeOf(f.name)) }
    fun openFile(f: FileInfo) = withBytes(f) { host.openFile(f.name, it, mimeOf(f.name)) }

    Column(Modifier.fillMaxSize().background(c.bg)) {
        Header(sid, onBack, onOpenRoute)
        if (Live.aiDown) Text(
            Live.fallback?.let { t("{0} 暂时连不上（API 限流），已自动切到备用 {1}", emp.executor, it) } ?: t("{0} 暂时连不上，员工先歇着；恢复后会接着做。", emp.executor),
            color = c.warn, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().background(c.warn.copy(alpha = 0.1f)).padding(horizontal = 14.dp, vertical = 8.dp),
        )
        Box(Modifier.weight(1f)) {
            LazyColumn(state = list, reverseLayout = true, modifier = Modifier.fillMaxSize()) {
                item("end") { Spacer(Modifier.height(6.dp)) }
                items(visible, key = { "m:" + it.id }) { m ->
                    MessageItem(
                        m, owner = emp.id, showTime = m.at != prevAt[m.id], foot = feet[m.id], working = session.working,
                        onCardAction = { mm, card, a, ans -> act(mm, card, a, ans) },
                        onMenu = { menuFor = m }, onStop = { Live.stop(sid) },
                        onImage = { viewer = m.id }, onFile = { saveFile(it) },
                    )
                }
                if (visible.isEmpty()) item("hello") {
                    Text(t("还没有消息，跟「{0}」说点什么吧。", emp.name), color = c.faint, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(32.dp))
                }
                if (sid in Live.reachedTop && visible.isNotEmpty()) item("top") {
                    Text(t("没有更早的了"), color = c.faint, fontSize = 12.sp, modifier = Modifier.fillMaxWidth().padding(12.dp))
                }
            }
            if (unseen > 0) Text(
                "↓ " + t("{0} 条新消息", unseen), color = Color.White, fontSize = 13.sp,
                modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp).clip(RoundedCornerShape(50)).background(c.primary)
                    .clickable { unseen = 0; scope.launch { list.animateScrollToItem(0) } }.padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }

        // 上下文快满 / 会话很长：提醒，换不换主人定
        val ctxKey = "${emp.id}:${emp.workNo ?: 0}"
        val ctxOff = ctxTick >= 0 && store.ctxOff(ctxKey) // 读 ctxTick：点了「先不换」马上收起
        if ((emp.contextUsed >= 80 || raw.size >= 300) && session.working == null && !ctxOff) Row(
            Modifier.fillMaxWidth().background(c.warn.copy(alpha = 0.1f)).padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (emp.contextUsed >= 80) t("上下文用了 {0}%，快满了", emp.contextUsed) else t("这个会话很长了"),
                color = c.warn, fontSize = 13.sp, modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { store.setCtxOff(ctxKey); ctxTick++ }) { Text(t("先不换"), color = c.sub, fontSize = 13.sp) }
            TextButton(onClick = { Live.handoff(sid, "上下文快满了") }) { Text(t("开新会话接着做"), color = c.primary, fontSize = 13.sp) }
        }
        // 在干活但没有「在干活」气泡（比如刚重连）：底下一条
        if (session.working != null && shown.none { it.kind == "status" && it.spinning }) Row(
            Modifier.fillMaxWidth().background(c.panel).padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("• " + t(session.working), color = c.ok, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text(t("停止"), color = c.danger, fontSize = 13.sp, modifier = Modifier.clickable { Live.stop(sid) }.padding(start = 8.dp))
        }
        // 排队
        val myQueue = Live.queue.filter { it.emp == emp.id }.sortedBy { it.at }
        if (myQueue.isNotEmpty()) Column(Modifier.fillMaxWidth().background(c.panel).padding(horizontal = 12.dp, vertical = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(t("排队中 · {0}", myQueue.size), color = c.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    "  " + if (session.working != null) t("这一轮做完按顺序自动发") else t("员工闲着，点右边开始"),
                    color = c.faint, fontSize = 12.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (session.working == null) TextButton(onClick = { Live.runQueue(sid) }) { Text(t("开始处理排队"), color = c.primary, fontSize = 13.sp) }
            }
            myQueue.forEachIndexed { i, q ->
                Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${i + 1}", color = c.faint, fontSize = 12.sp, modifier = Modifier.width(18.dp))
                    Text(
                        q.text.ifBlank { t("（只有附件）") } + if (q.files.isNotEmpty()) "  📎${q.files.size}" else "",
                        color = c.sub, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f).clickable { editQ = q },
                    )
                    Text("×", color = c.faint, fontSize = 18.sp, modifier = Modifier.clickable { Live.deleteQueue(q.id) }.padding(horizontal = 8.dp))
                }
            }
        }
        Composer(emp, session, text, { text = it }, { send(it) }, sending, onOpenRoute)
    }

    // 长按消息
    menuFor?.let { m ->
        ModalBottomSheet(onDismissRequest = { menuFor = null }, containerColor = c.panel) {
            if (m.text != null || m.card != null) SheetRow(t("复制")) { copy(ctx, m.plain); Live.toast(t("已复制")); menuFor = null }
            m.file?.takeIf { it.url != null }?.let { f ->
                if (f.image) SheetRow(t("看大图")) { viewer = m.id; menuFor = null }
                else SheetRow(t("打开")) { openFile(f); menuFor = null }
                SheetRow(if (f.image) t("存到相册") else t("下载")) { saveFile(f); menuFor = null }
                SheetRow(t("分享")) { shareFile(f); menuFor = null }
            }
            SheetRow(t("引用")) { text = "「${m.plain.take(80)}」\n$text"; menuFor = null }
            SheetRow(t("转给别的员工")) { forward = m; menuFor = null }
            SheetRow(t("删除"), color = c.danger) { Live.deleteMessage(sid, m.id); menuFor = null }
            Spacer(Modifier.height(24.dp))
        }
    }
    forward?.let { m ->
        EmployeePicker(t("转给谁"), exclude = emp.id, onDismiss = { forward = null }) { to ->
            forward = null
            scope.launch { if (Live.forward(to, m.id)) Live.toast(t("已转给「{0}」", Live.empName(to))) }
        }
    }
    editQ?.let { q ->
        var v by remember(q.id) { mutableStateOf(q.text) }
        AlertDialog(
            onDismissRequest = { editQ = null },
            title = { Text(t("改排队的话")) },
            text = { OutlinedTextField(v, { v = it }, minLines = 2, maxLines = 6, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { TextButton(onClick = { if (v != q.text) Live.editQueue(q.id, v); editQ = null }) { Text(t("保存")) } },
            dismissButton = { TextButton(onClick = { editQ = null }) { Text(t("取消")) } },
        )
    }
    viewer?.let { start ->
        // 这个会话里所有的图片（按时间），左右滑翻
        val images = shown.filter { it.kind == "file" && it.file?.image == true && it.file?.url != null }
        ImageViewer(
            images, start, onClose = { viewer = null },
            onSave = { m -> m.file?.let { saveFile(it) } },
            onShare = { m -> m.file?.let { shareFile(it) } },
            onForward = { m -> viewer = null; forward = m }, // 先关大图，选员工的面板才不会被挡住
        )
    }
}

/** 顶栏：返回、头像、名字 +「在干活 / 等你」、副标题（在干什么 / 职位 + 服务器负载）；点名字看员工资料，「···」看聊天信息 */
@Composable
private fun Header(sid: String, onBack: () -> Unit, onOpenRoute: (String) -> Unit) {
    val c = Opero.colors
    val session = Live.session(sid) ?: return
    val emp = Live.employee(session.employee) ?: return
    val server = Live.serverOf(emp)
    Row(Modifier.fillMaxWidth().background(c.panel).padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("‹", fontSize = 26.sp, color = c.text) }
        Row(
            Modifier.weight(1f).clickable { onOpenRoute(Routes.seg("profile", mapOf("id" to emp.id))) },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(emp.id, 36.dp)
            Column(Modifier.padding(start = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(emp.name, color = c.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val pill = if (session.working != null) t("在干活") else session.waiting?.let { t(it) }
                    if (pill != null) Text(
                        pill, color = if (session.working != null) c.ok else c.warn, fontSize = 11.sp,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background((if (session.working != null) c.ok else c.warn).copy(alpha = 0.12f)).padding(horizontal = 7.dp, vertical = 1.dp),
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        session.working?.let { t(it) } ?: emp.title, color = if (session.working != null) c.ok else c.faint, fontSize = 12.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                    )
                    if (server != null && session.working == null) {
                        if (!server.online) Text("  " + t("服务器离线"), color = c.danger, fontSize = 12.sp)
                        else {
                            fun tone(v: Int) = if (v >= 90) c.danger else if (v >= 80) c.warn else c.faint
                            Text("  CPU ${server.cpu}%", color = tone(server.cpu), fontSize = 12.sp)
                            Text("  " + t("内存") + " ${server.mem}%", color = tone(server.mem), fontSize = 12.sp)
                        }
                    }
                }
            }
        }
        TextButton(onClick = { onOpenRoute(Routes.seg("chatInfo", mapOf("sid" to sid))) }) { Text("···", fontSize = 20.sp, color = c.text) }
    }
}

private fun mimeOf(name: String) = when (name.substringAfterLast('.', "").lowercase()) {
    "pdf" -> "application/pdf"; "txt", "log", "md" -> "text/plain"; "json" -> "application/json"; "csv" -> "text/csv"
    "zip" -> "application/zip"; "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "gif" -> "image/gif"; "webp" -> "image/webp"
    "html", "htm" -> "text/html"; else -> "*/*"
}

/**
 * 发布卡片往后挪（docs/规范/表单与卡片.md「发布卡片」的显示顺序，网页 Chat.tsx 的 floatReleases）：
 * 发布要好几分钟，按发起时间排会夹在员工这一轮的话中间。越过它后面员工 / 系统的消息，遇到我说的话或另一张发布卡片停；
 * 在发的挪到最下面，发完的只越过 ts ≤ ended 的消息。
 */
internal fun floatReleases(list: List<Message>): List<Message> {
    val out = list.toMutableList()
    var i = 0
    while (i < out.size) {
        val m = out[i]
        val card = m.card
        if (card == null || !isReleaseCard(card)) { i++; continue }
        val until = if (card.data.optString("status") == "running") Long.MAX_VALUE else card.data.optLong("ended").takeIf { it > 0 } ?: Long.MAX_VALUE
        var j = i
        while (j + 1 < out.size && out[j + 1].from != "me" && out[j + 1].card?.type != "release" && out[j + 1].ts <= until) j++
        if (j > i) { out.removeAt(i); out.add(j, m) } else i++ // 挪过去以后原来的位置换成了下一条，再看一遍
    }
    return out
}
