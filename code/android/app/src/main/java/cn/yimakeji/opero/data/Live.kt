package cn.yimakeji.opero.data

import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import cn.yimakeji.opero.i18n.I18n
import cn.yimakeji.opero.i18n.t
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * 原生页面的数据（和网页 code/web/src/live.ts 一样的做法）：
 *   - 开机 GET /api/bootstrap 拿全；之后 GET /api/events（Server-Sent Events）收变化，按 docs/api/README.md 的事件表改本地。
 *   - 断线自动重连（1 → 2 → 4 … 最多 30 秒），重连上先重新拉一次 bootstrap，免得漏东西。
 *   - App 在前台才连（[resume] / [pause]）；在后台靠常驻推送（push/）。
 * 字段都是 Compose 状态：页面读了就会跟着变。
 */
object Live {
    private const val TAG = "OperoLive"

    var employees by mutableStateOf<List<Employee>>(emptyList())
        private set
    var sessions by mutableStateOf<List<Session>>(emptyList())
        private set
    var messages by mutableStateOf<Map<String, List<Message>>>(emptyMap())
        private set
    var queue by mutableStateOf<List<QueueItem>>(emptyList())
        private set
    var servers by mutableStateOf<List<Server>>(emptyList())
        private set
    var workspaces by mutableStateOf<List<Workspace>>(emptyList())
        private set
    var me by mutableStateOf(Me("", null, null))
        private set
    /** 设置里原生页面用得到的：常用语、深浅色 */
    var phrases by mutableStateOf<List<String>>(emptyList())
        private set
    var theme by mutableStateOf("system")
        private set
    /** AI 暂时连不上（限流 / 断了）；fallback = 自动切到的备用执行器 */
    var aiDown by mutableStateOf(false)
        private set
    var fallback by mutableStateOf<String?>(null)
        private set

    /** 拉过 bootstrap 了 */
    var ready by mutableStateOf(false)
        private set
    /** 实时推送连着 */
    var connected by mutableStateOf(false)
        private set
    /** 开机拉不到（连不上 / 出错）：给人看的原因 */
    var bootError by mutableStateOf<String?>(null)
        private set
    /** 哪些会话往前翻到头了 */
    var reachedTop by mutableStateOf<Set<String>>(emptySet())
        private set

    private val _toasts = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** 给人看的一句提示（后台的 toast、操作结果、出错） */
    val toasts: SharedFlow<String> = _toasts

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var loop: Job? = null

    fun toast(msg: String) { _toasts.tryEmit(msg) }

    // ───── 连接 ─────

    /** 到前台 / 刚登录：开始（已经连着就不管） */
    fun resume() {
        if (loop?.isActive == true || !Api.store.loggedIn) return
        loop = scope.launch { run() }
    }

    /** 到后台：断开实时推送（数据留着，回来重新拉） */
    fun pause() {
        loop?.cancel()
        loop = null
        connected = false
    }

    /** 退出登录 / 被断开：数据清空 */
    fun clear() {
        pause()
        employees = emptyList(); sessions = emptyList(); messages = emptyMap(); queue = emptyList()
        servers = emptyList(); workspaces = emptyList(); me = Me("", null, null); phrases = emptyList()
        ready = false; bootError = null; reachedTop = emptySet()
    }

    /** 重新拉一次（出错页的「重试」） */
    fun retry() { pause(); bootError = null; resume() }

    private suspend fun run() {
        var wait = 1000L
        while (scope.isActive && Api.store.loggedIn) {
            try {
                boot()
                wait = 1000L
                stream()
            } catch (e: ApiError) {
                if (e.code == "DEVICE") return // 回登录页（Api.signedOut）
                if (!ready) bootError = e.message
                Log.w(TAG, "live: ${e.message}")
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "live", e)
            }
            connected = false
            delay(wait)
            wait = (wait * 2).coerceAtMost(30_000L)
        }
    }

    private suspend fun boot() {
        val b = Api.owner("GET", "/api/bootstrap")
        employees = b.optJSONArray("employees").list { Employee.of(it) }
        sessions = b.optJSONArray("sessions").list { Session.of(it) }.filter { !it.archived }
        val ms = b.optJSONObject("messages")
        messages = buildMap { ms?.let { o -> o.keys().forEach { sid -> put(sid, o.optJSONArray(sid).list { Message.of(it) }) } } }
        queue = b.optJSONArray("queue").list { QueueItem.of(it) }
        servers = b.optJSONArray("servers").list { Server.of(it) }
        workspaces = b.optJSONArray("workspaces").list { Workspace.of(it) }
        me = Me.of(b.optJSONObject("me"))
        b.optJSONObject("settings")?.let { settings(it) }
        reachedTop = emptySet()
        bootError = null
        ready = true
    }

    private fun settings(s: JSONObject) {
        if (s.has("phrases")) phrases = s.optJSONArray("phrases")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
        if (s.has("theme")) theme = s.optString("theme").ifEmpty { "system" }
        if (s.has("aiDown")) aiDown = s.optBoolean("aiDown")
        if (s.has("fallback")) fallback = s.optString("fallback").ifEmpty { null }
        if (s.has("lang")) {
            val l = s.optString("lang").ifEmpty { null }
            Api.store.lang = l
            I18n.setPref(l)
        }
    }

    /** 读实时推送：每条 `data: {json}`，空行分隔 */
    private suspend fun stream() = withContext(Dispatchers.IO) {
        Api.openStream("/api/events").use { r ->
            if (!r.isSuccessful) throw ApiError(r.code, null, t("出错了（{0}）", r.code))
            val src = r.body?.source() ?: return@use
            withContext(Dispatchers.Main) { connected = true }
            val buf = StringBuilder()
            while (isActive) {
                val line = src.readUtf8Line() ?: break
                when {
                    line.startsWith("data:") -> buf.append(line.removePrefix("data:").trimStart())
                    line.isEmpty() && buf.isNotEmpty() -> {
                        val text = buf.toString()
                        buf.setLength(0)
                        val ev = try { JSONObject(text) } catch (_: Exception) { null }
                        if (ev != null) withContext(Dispatchers.Main) { apply(ev) }
                    }
                }
            }
        }
    }

    private fun apply(ev: JSONObject) {
        when (ev.optString("t")) {
            "put" -> put(ev.optString("coll"), ev.optJSONObject("item") ?: return)
            "del" -> del(ev.optString("coll"), ev.optString("id"))
            "msg" -> upsertMsg(ev.optString("sid"), Message.of(ev.optJSONObject("msg") ?: return))
            "msgDel" -> dropMsg(ev.optString("sid"), ev.optString("id"))
            "settings" -> ev.optJSONObject("settings")?.let { settings(it) }
            "me" -> ev.optJSONObject("me")?.let { me = Me.of(it) }
            "toast" -> ev.optString("text").takeIf { it.isNotBlank() }?.let { toast(t(it)) }
        }
    }

    private fun <T> upsert(list: List<T>, item: T, id: (T) -> String): List<T> {
        val i = list.indexOfFirst { id(it) == id(item) }
        return if (i >= 0) list.toMutableList().also { it[i] = item } else list + item
    }

    private fun put(coll: String, o: JSONObject) {
        when (coll) {
            "employees" -> employees = upsert(employees, Employee.of(o)) { it.id }
            "sessions" -> {
                val s = Session.of(o)
                sessions = if (s.archived) sessions.filter { it.id != s.id } else upsert(sessions, s) { it.id }
            }
            "queue" -> queue = upsert(queue, QueueItem.of(o)) { it.id }
            "servers" -> servers = upsert(servers, Server.of(o)) { it.id }
            "workspaces" -> workspaces = upsert(workspaces, Workspace.of(o)) { it.id }
        }
    }

    private fun del(coll: String, id: String) {
        when (coll) {
            "employees" -> employees = employees.filter { it.id != id }
            "sessions" -> sessions = sessions.filter { it.id != id }
            "queue" -> queue = queue.filter { it.id != id }
            "servers" -> servers = servers.filter { it.id != id }
            "workspaces" -> workspaces = workspaces.filter { it.id != id }
        }
    }

    private fun upsertMsg(sid: String, m: Message) {
        val list = messages[sid] ?: emptyList()
        messages = messages + (sid to upsert(list, m) { it.id })
    }

    private fun dropMsg(sid: String, id: String) {
        val list = messages[sid] ?: return
        messages = messages + (sid to list.filter { it.id != id })
    }

    // ───── 查 ─────

    fun employee(id: String?) = employees.firstOrNull { it.id == id }
    fun session(id: String?) = sessions.firstOrNull { it.id == id }
    fun empName(id: String) = employee(id)?.name ?: id
    fun serverOf(e: Employee) = servers.firstOrNull { it.name == e.host || it.id == e.host }
    fun workspaceOf(e: Employee) = workspaces.firstOrNull { it.id == e.workspace }

    /** 会话该不该冒红点（和网页 badgeOf 一样）：all 有未读就红；decide 只有要你决定的才红；none 不红 */
    fun badgeOf(s: Session, e: Employee?): String? {
        val n = e?.notify ?: "decide"
        if (n == "none") return if (s.unread > 0) "grey" else null
        if (s.waiting != null) return "red"
        if (s.unread <= 0) return null
        return if (n == "all") "red" else "grey"
    }

    /** 会话页签上的数字 */
    val unreadTotal: Int get() = sessions.sumOf { s -> if (badgeOf(s, employee(s.employee)) == "red") maxOf(1, s.unread) else 0 }

    // ───── 做事 ─────

    /** 调接口：出错弹一句提示，返回 null */
    suspend fun <T> tryCall(block: suspend () -> T): T? = try { block() } catch (e: ApiError) { toast(e.message ?: t("出错了")); null }

    fun markRead(sid: String) {
        val s = session(sid) ?: return
        if (s.unread <= 0) return
        sessions = sessions.map { if (it.id == sid) it.copy(unread = 0) else it }
        scope.launch { tryCall { Api.owner("POST", "/api/sessions/$sid/read") } }
    }

    fun togglePin(sid: String) {
        val s = session(sid) ?: return
        sessions = sessions.map { if (it.id == sid) it.copy(pinned = !s.pinned) else it }
        scope.launch { tryCall { Api.owner("PUT", "/api/sessions/$sid", JSONObject().put("pinned", !s.pinned)) } }
    }

    /** 免打扰 = 这个员工的提醒设成「不提醒」；再点一次回到「只提醒要我决定的」 */
    fun toggleMute(sid: String) {
        val e = employee(session(sid)?.employee) ?: return
        val n = if (e.notify == "none") "decide" else "none"
        employees = employees.map { if (it.id == e.id) it.copy(notify = n) else it }
        scope.launch { tryCall { Api.owner("PUT", "/api/employees/${e.id}", JSONObject().put("notify", n)) } }
    }

    /** 找到（没有就建）和某个员工的会话，返回会话 id */
    suspend fun sessionFor(empId: String): String? {
        sessions.firstOrNull { it.employee == empId }?.let { return it.id }
        val r = tryCall { Api.owner("POST", "/api/sessions/for/$empId") } ?: return null
        val s = Session.of(r)
        if (s.id.isNotEmpty()) sessions = upsert(sessions, s) { it.id }
        return s.id.ifEmpty { null }
    }

    /** 发消息：mode = auto（在干活就插话，插不进就排队）/ queue（排队）；返回 null = 没发出去，否则 true = 排队了 */
    suspend fun send(sid: String, text: String, files: List<Att>, mode: String): Boolean? {
        val body = JSONObject().put("text", text).put("mode", mode).put("files", JSONArray().apply {
            files.forEach { f -> put(JSONObject().put("id", f.id).apply { f.w?.let { put("w", it) }; f.h?.let { put("h", it) } }) }
        })
        val r = tryCall { Api.owner("POST", "/api/sessions/$sid/messages", body) } ?: return null
        val queued = r.optJSONObject("queued") != null
        if (queued) toast(t("已排队：这一轮做完按顺序发"))
        return queued
    }

    /** 先传附件（还没发） */
    suspend fun upload(sid: String, bytes: ByteArray, name: String, type: String, w: Int?, h: Int?): Att {
        val q = mutableMapOf<String, Any?>("name" to name, "type" to type)
        if (w != null && h != null) { q["w"] = w; q["h"] = h }
        val r = Api.upload("/api/sessions/$sid/files", q, bytes, type)
        return Att.of(r.optJSONObject("att") ?: throw ApiError(0, null, t("传失败了")))
    }

    fun dropUpload(sid: String, att: Att) {
        scope.launch { tryCall { Api.owner("DELETE", "/api/sessions/$sid/files/${android.net.Uri.encode(att.id)}") } }
    }

    fun stop(sid: String) { scope.launch { tryCall { Api.owner("POST", "/api/sessions/$sid/stop") } } }

    fun editQueue(id: String, text: String) { scope.launch { tryCall { Api.owner("PUT", "/api/queue/$id", JSONObject().put("text", text)) } } }
    fun deleteQueue(id: String) {
        queue = queue.filter { it.id != id }
        scope.launch { tryCall { Api.owner("DELETE", "/api/queue/$id") } }
    }
    fun runQueue(sid: String) { scope.launch { tryCall { Api.owner("POST", "/api/sessions/$sid/queue/run") } } }

    fun deleteMessage(sid: String, id: String) {
        dropMsg(sid, id)
        scope.launch { tryCall { Api.owner("DELETE", "/api/messages/$id") } }
    }

    /** 卡片按钮（不含 panel 和验证本人，那两步页面先做）；成功返回 result */
    suspend fun cardAction(msgId: String, action: String, answer: String?): String? {
        val body = JSONObject().put("action", action).apply { if (answer != null) put("answer", answer) }
        val r = tryCall { Api.owner("POST", "/api/messages/$msgId/action", body) } ?: return null
        return r.optString("result").ifEmpty { null }
    }

    /** 开新会话接着做（上下文快满）：后台归档现在的、开新的，交接预填在新会话的输入框 */
    fun handoff(sid: String, reason: String) {
        scope.launch {
            if (tryCall { Api.owner("POST", "/api/sessions/$sid/handoff", JSONObject().put("reason", reason)) } != null)
                toast(t("已开新会话：交接写在输入框里，看一下再发"))
        }
    }

    /** 交接预填用过了：清掉 */
    fun clearDraft(sid: String) {
        sessions = sessions.map { if (it.id == sid) it.copy(draft = null) else it }
        scope.launch { tryCall { Api.owner("PUT", "/api/sessions/$sid", JSONObject().put("draft", "")) } }
    }

    fun setPhrases(list: List<String>) {
        phrases = list
        scope.launch { tryCall { Api.owner("PUT", "/api/settings", JSONObject().put("phrases", JSONArray(list))) } }
    }

    /** 往前翻：拿这个会话更早的 100 条 */
    suspend fun loadOlder(sid: String) {
        if (sid in reachedTop) return
        val list = messages[sid] ?: emptyList()
        val before = list.firstOrNull { it.ts > 0 }?.ts ?: return
        val arr = tryCall { Api.callArray("GET", "/api/sessions/$sid/messages", mapOf("before" to before)) } ?: return
        val older = arr.list { Message.of(it) }
        val have = list.map { it.id }.toHashSet()
        val add = older.filter { it.id !in have }
        if (add.isEmpty()) { reachedTop = reachedTop + sid; return }
        messages = messages + (sid to (add + (messages[sid] ?: emptyList())))
    }

    /**
     * 转给别的员工（POST /api/sessions/<目标会话>/forward {msg}）：文字照转（后台加「转自「某某」」），
     * 图片 / 文件由后台把文件本身复制给对方，对方员工直接能看能用；对方在干活就插话 / 排队
     */
    suspend fun forward(toEmp: String, msgId: String): Boolean {
        val sid = sessionFor(toEmp) ?: return false
        return tryCall { Api.owner("POST", "/api/sessions/$sid/forward", JSONObject().put("msg", msgId)) } != null
    }
}
