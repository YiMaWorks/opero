package cn.yimakeji.opero.data

import androidx.compose.runtime.Immutable
import org.json.JSONArray
import org.json.JSONObject

// 后台返回的数据结构（code/server/src/types.ts）。只取原生页面用得到的字段；不认识的字段忽略（docs/api/README.md「改接口的人」）。

private fun JSONObject.str(k: String): String? = if (has(k) && !isNull(k)) optString(k) else null
private fun JSONObject.strList(k: String): List<String> = optJSONArray(k)?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
private inline fun <T> JSONArray?.mapObj(f: (JSONObject) -> T): List<T> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.let(f) }

@Immutable
data class Employee(
    val id: String,
    val name: String,
    val avatar: String,
    val avatarImg: String?,
    val color: String,
    val title: String,
    val executor: String,
    val host: String,
    val workspace: String,
    val menus: List<String>,
    /** all 每条都提醒 / decide 只提醒要我决定的 / none 免打扰 */
    val notify: String,
    val contextUsed: Int,
    /** 当前这段 work 的编号（上下文提示「先不换」按它记） */
    val workNo: Int?,
) {
    val codex: Boolean get() = executor.contains("codex", ignoreCase = true)

    companion object {
        fun of(o: JSONObject) = Employee(
            id = o.optString("id"),
            name = o.optString("name"),
            avatar = o.optString("avatar").ifEmpty { o.optString("name").take(1) },
            avatarImg = o.str("avatarImg")?.ifEmpty { null },
            color = o.optString("color").ifEmpty { "#5B4FE9" },
            title = o.optString("title"),
            executor = o.optString("executor"),
            host = o.optString("host"),
            workspace = o.optString("workspace"),
            menus = o.strList("menus"),
            notify = o.optString("notify").ifEmpty { "decide" },
            contextUsed = o.optInt("contextUsed", 0),
            workNo = o.optJSONArray("works")?.optJSONObject(0)?.let { if (it.has("no")) it.optInt("no") else null },
        )
    }
}

@Immutable
data class Session(
    val id: String,
    val employee: String,
    val last: String,
    val time: String,
    val ts: Long,
    val unread: Int,
    val pinned: Boolean,
    /** 员工在干活时的那句状态（「在跑命令…」） */
    val working: String?,
    /** 等你处理（「要你确认」） */
    val waiting: String?,
    val archived: Boolean,
    /** 开新会话时的交接，预填进输入框 */
    val draft: String?,
) {
    companion object {
        fun of(o: JSONObject) = Session(
            id = o.optString("id"),
            employee = o.optString("employee"),
            last = o.optString("last"),
            time = o.optString("time"),
            ts = o.optLong("ts"),
            unread = o.optInt("unread", 0),
            pinned = o.optBoolean("pinned"),
            working = o.str("working")?.ifEmpty { null },
            waiting = o.str("waiting")?.ifEmpty { null },
            archived = o.has("archived") && !o.isNull("archived") && o.optLong("archived") > 0,
            draft = o.str("draft")?.ifEmpty { null },
        )
    }
}

@Immutable
data class FileInfo(val name: String, val size: String, val ext: String, val image: Boolean, val url: String?, val w: Int?, val h: Int?) {
    companion object {
        fun of(o: JSONObject) = FileInfo(
            name = o.optString("name"),
            size = o.optString("size"),
            ext = o.optString("ext"),
            image = o.optBoolean("image") || o.optString("mediaType").startsWith("image/"),
            url = o.str("url")?.ifEmpty { null },
            w = o.optInt("w", 0).takeIf { it > 0 },
            h = o.optInt("h", 0).takeIf { it > 0 },
        )
    }
}

@Immutable
data class CardAction(val id: String, val label: String, val style: String, val panel: String?, val args: JSONObject?) {
    companion object {
        fun of(o: JSONObject) = CardAction(
            id = o.optString("id"),
            label = o.optString("label"),
            style = o.optString("style").ifEmpty { "default" },
            panel = o.str("panel")?.ifEmpty { null },
            args = o.optJSONObject("args"),
        )
    }
}

/** 卡片（docs/api/卡片.md）：data 原样留着，各种类按需取 */
@Immutable
data class Card(
    val id: String,
    val type: String,
    val open: Boolean,
    val level: String,
    val data: JSONObject,
    val actions: List<CardAction>,
    val result: String?,
) {
    val title: String get() = data.optString("title")
    fun s(k: String): String? = if (data.has(k) && !data.isNull(k)) data.optString(k).ifEmpty { null } else null
    /** data.rows：[[名字, 值], …] */
    val rows: List<Pair<String, String>>
        get() = data.optJSONArray("rows")?.let { a ->
            (0 until a.length()).mapNotNull { i -> a.optJSONArray(i)?.let { r -> r.optString(0) to r.optString(1) } }
        } ?: emptyList()

    companion object {
        fun of(o: JSONObject) = Card(
            id = o.optString("id"),
            type = o.optString("type").ifEmpty { "generic" },
            open = o.optString("state") == "open",
            level = o.optString("level").ifEmpty { "info" },
            data = o.optJSONObject("data") ?: JSONObject(),
            actions = o.optJSONArray("actions").mapObj { CardAction.of(it) },
            result = o.str("result")?.ifEmpty { null },
        )
    }
}

@Immutable
data class Message(
    val id: String,
    /** me / system / 员工 id */
    val from: String,
    /** text / status / system / file / card */
    val kind: String,
    /** 给人看的时间（「18:23」） */
    val at: String,
    val ts: Long,
    val text: String?,
    val spinning: Boolean,
    val file: FileInfo?,
    val card: Card?,
) {
    /** 复制 / 引用 / 转发用的文字 */
    val plain: String get() = text ?: card?.title ?: file?.name ?: ""

    companion object {
        fun of(o: JSONObject) = Message(
            id = o.optString("id"),
            from = o.optString("from"),
            kind = o.optString("kind").ifEmpty { "text" },
            at = o.optString("at"),
            ts = o.optLong("ts"),
            text = o.str("text"),
            spinning = o.optBoolean("spinning"),
            file = o.optJSONObject("file")?.let { FileInfo.of(it) },
            card = o.optJSONObject("card")?.let { Card.of(it) },
        )
    }
}

/** 员工在干活时排队的一句话（带着它的附件） */
@Immutable
data class QueueItem(val id: String, val emp: String, val sid: String, val text: String, val files: List<FileInfo>, val at: Long) {
    companion object {
        fun of(o: JSONObject) = QueueItem(
            id = o.optString("id"),
            emp = o.optString("emp"),
            sid = o.optString("sid"),
            text = o.optString("text"),
            files = o.optJSONArray("files").mapObj { FileInfo.of(it) },
            at = o.optLong("at"),
        )
    }
}

/** 传好、还没发的附件（POST /api/sessions/:id/files 回的 att） */
@Immutable
data class Att(val id: String, val name: String, val image: Boolean, val url: String, val w: Int?, val h: Int?) {
    companion object {
        fun of(o: JSONObject) = Att(
            id = o.optString("id"),
            name = o.optString("name"),
            image = o.optBoolean("image"),
            url = o.optString("url"),
            w = o.optInt("w", 0).takeIf { it > 0 },
            h = o.optInt("h", 0).takeIf { it > 0 },
        )
    }
}

@Immutable
data class Server(val id: String, val name: String, val online: Boolean, val cpu: Int, val mem: Int) {
    companion object {
        fun of(o: JSONObject) = Server(o.optString("id"), o.optString("name"), o.optBoolean("online"), o.optInt("cpu"), o.optInt("mem"))
    }
}

@Immutable
data class Workspace(val id: String, val name: String, val branch: String) {
    companion object {
        fun of(o: JSONObject) = Workspace(o.optString("id"), o.optString("name"), o.optString("branch"))
    }
}

/** 我（主人）：头像、名字 */
@Immutable
data class Me(val name: String, val avatar: String?, val avatarImg: String?) {
    companion object {
        fun of(o: JSONObject?) = Me(
            name = o?.optString("name").orEmpty(),
            avatar = o?.optString("avatar")?.ifEmpty { null },
            avatarImg = o?.optString("avatarImg")?.ifEmpty { null },
        )
    }
}

internal fun <T> JSONArray?.list(f: (JSONObject) -> T): List<T> = mapObj(f)
