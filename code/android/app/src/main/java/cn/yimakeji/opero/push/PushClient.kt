package cn.yimakeji.opero.push

import android.os.Build
import cn.yimakeji.opero.BuildConfig
import cn.yimakeji.opero.data.Api
import cn.yimakeji.opero.data.ApiError
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject

/** 后台推过来的一条提醒（docs/规范/App外壳.md 第 3 节） */
data class PushItem(
    val id: Long,
    /** decide 要你决定 / alarm 严重告警 / info 知道就行 / clear 收掉某条告警 */
    val kind: String,
    val title: String,
    val body: String?,
    /** 点开去哪：chat/<会话编号>… 交给网页 */
    val route: String?,
    /** 严重告警的编号（带「我知道了」；kind = clear 时收掉这条） */
    val alarm: Long?,
) {
    companion object {
        fun of(o: JSONObject) = PushItem(
            id = o.optLong("id"),
            kind = o.optString("kind", "info"),
            title = o.optString("title"),
            body = o.optString("body").ifEmpty { null },
            route = o.optString("route").ifEmpty { null },
            alarm = if (o.has("alarm") && !o.isNull("alarm")) o.optLong("alarm") else null,
        )
    }
}

object PushState {
    val connected = MutableStateFlow(false)
    val running = MutableStateFlow(false)
    val lastError = MutableStateFlow<String?>(null)
}

/**
 * 推送接口（照 KidLock push/PushClient.kt）：登记 POST /api/app/devices；长轮询 GET /api/app/push?after=&wait=；断开 DELETE /api/app/devices/<id>
 * 一人一套没法用厂商推送（厂商推送要 App 发行方的密钥，不能发给每一套自建的 Opero），所以只有常驻连接 + 看门狗补取。
 */
object PushClient {
    suspend fun register() {
        val s = Api.store
        Api.post("/api/app/devices", JSONObject().apply {
            put("deviceId", s.deviceId)
            put("platform", "android")
            put("brand", Build.MANUFACTURER ?: "")
            put("model", Build.MODEL ?: "")
            put("osVersion", Build.VERSION.RELEASE ?: "")
            put("appVersion", BuildConfig.VERSION_NAME)
            put("enabled", s.pushEnabled)
        })
    }

    /** 取一次：没新的就在后台等最多 waitSec 秒 */
    suspend fun pollOnce(waitSec: Int): List<PushItem> {
        val s = Api.store
        val r = try {
            Api.call("GET", "/api/app/push", query = mapOf("device" to s.deviceId, "after" to s.pushLast, "wait" to waitSec), long = waitSec > 0)
        } catch (e: ApiError) {
            if (e.code != "DEVICE_NOT_FOUND") throw e
            register() // 后台没这台手机：登记后从现在开始，不补以前的
            Api.call("GET", "/api/app/push", query = mapOf("device" to s.deviceId, "after" to -1, "wait" to 0))
        }
        val last = r.optLong("last", -1)
        if (last >= 0) s.pushLast = last
        PushState.connected.value = true
        PushState.lastError.value = null
        val arr = r.optJSONArray("items") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let { PushItem.of(it) } }
    }

    suspend fun unregister() {
        try { Api.call("DELETE", "/api/app/devices/${Api.store.deviceId}") } catch (_: Exception) { }
        Api.store.pushLast = -1
    }
}
