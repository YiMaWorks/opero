package cn.yimakeji.opero.data

import android.net.Uri
import android.os.Build
import cn.yimakeji.opero.BuildConfig
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.push.PushClient
import org.json.JSONObject

/**
 * 登录 / 退出（docs/api/README.md「登录」）：
 *   - 主路：Opero 地址 + 账号（邮箱）+ 密码 → POST /api/app/login；开了两步验证再 POST /api/app/login/mfa
 *   - 可选：网页「我 → 账号安全 → 接手机」的 6 位配对码 → POST /api/app/pair，再 POST /api/app/session 换会话令牌
 *   - 退出：DELETE /api/app/devices/<deviceId>，删掉本地令牌
 */
object Account {
    /** 登录结果：done = 登好了；mfa = 还要输两步验证码（带票） */
    sealed interface Result {
        data object Done : Result
        data class Mfa(val ticket: String) : Result
    }

    /** 填的地址 → 规范的地址（补 https://、去掉结尾的 /）；不像地址回 null */
    fun normalize(input: String): String? {
        val s = input.trim().trimEnd('/')
        if (s.isEmpty()) return null
        val base = if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(s)) s else "https://$s"
        return base.takeIf { !Uri.parse(it).host.isNullOrBlank() }
    }

    /** 先确认这个地址真是 Opero 后台（GET /api/health 回 ok），填成官网、别的网站会拦下 */
    suspend fun check(base: String) {
        val host = Uri.parse(base).host ?: base
        val r = try {
            Api.call("GET", "/api/health", server = base, auth = Auth.NONE)
        } catch (e: ApiError) {
            throw if (e.status == 0) ApiError(0, "NETWORK", t("连不上 {0}：{1}", host, e.message ?: ""))
            else ApiError(e.status, "NOT_OPERO", t("这个地址不是 Opero 后台（HTTP {0}）", e.status))
        }
        if (!r.optBoolean("ok")) throw ApiError(0, "NOT_OPERO", t("这个地址不是 Opero 后台：填你自己服务器上装的 Opero 的地址（官网和试用版连不了）"))
    }

    private fun device() = JSONObject().apply {
        put("deviceId", Api.store.deviceId)
        put("name", listOfNotNull(Build.MANUFACTURER, Build.MODEL).joinToString(" ").ifBlank { "Android" })
        put("platform", "android")
        put("appVersion", BuildConfig.VERSION_NAME)
    }

    suspend fun login(base: String, email: String, password: String): Result {
        val r = Api.call("POST", "/api/app/login", device().put("email", email.trim()).put("password", password), server = base, auth = Auth.NONE)
        if (r.optBoolean("mfa")) return Result.Mfa(r.optString("ticket"))
        signedIn(base, r, email)
        return Result.Done
    }

    suspend fun loginMfa(base: String, email: String, ticket: String, code: String) {
        val r = Api.call("POST", "/api/app/login/mfa", device().put("ticket", ticket).put("code", code.trim()), server = base, auth = Auth.NONE)
        signedIn(base, r, email)
    }

    suspend fun pair(base: String, code: String) {
        val r = Api.call("POST", "/api/app/pair", device().put("code", code.trim()), server = base, auth = Auth.NONE)
        val dt = r.optString("deviceToken")
        if (dt.isBlank()) throw ApiError(0, "PAIR", t("配对码不对或者过期了"))
        val s = Api.store
        s.server = base
        s.deviceToken = dt
        s.sessionToken = null
        Api.refreshSession(null)
    }

    private fun signedIn(base: String, r: JSONObject, email: String) {
        val dt = r.optString("deviceToken")
        val st = r.optString("token")
        if (dt.isBlank() || st.isBlank()) throw ApiError(0, null, t("登录失败"))
        val s = Api.store
        s.server = base
        s.deviceToken = dt
        s.sessionToken = st
        s.email = email.trim()
    }

    /** 退出登录：告诉后台断开这台（失败也照样删本地的） */
    suspend fun logout() {
        PushClient.unregister()
        Api.store.clearPairing()
    }
}
