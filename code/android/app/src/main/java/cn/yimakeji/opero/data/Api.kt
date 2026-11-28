package cn.yimakeji.opero.data

import android.net.Uri
import android.os.Build
import cn.yimakeji.opero.BuildConfig
import cn.yimakeji.opero.i18n.t
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** 接口出错：status 0 = 没连上；code 是后台的机器码（AUTH / DEVICE / LOGIN / MFA / VERIFY…）；message 已经换成当前语言 */
class ApiError(val status: Int, val code: String?, message: String) : Exception(message)

/** 这个请求带哪个令牌（docs/api/README.md「登录」） */
enum class Auth {
    /** 不带（健康检查、登录） */
    NONE,
    /** 设备令牌：/api/app/… 这些设备接口 */
    DEVICE,
    /** 主人的会话令牌：其它所有接口；过期了自动用设备令牌换一个再试一次 */
    OWNER,
}

/**
 * 调自己那套 Opero 的接口。
 * 请求头：Authorization: Bearer <令牌>、X-Opero-Client: app、User-Agent: OperoApp/<版本> (Android …)。用 Bearer 的不用带 X-Opero。
 * 设备被断开（401 DEVICE：网页上删了这台、改了密码）→ 清掉令牌、发 [signedOut]，界面回到登录页。
 */
object Api {
    lateinit var store: Store

    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
    /** 长轮询：后台最多等 30 秒，读超时留够 */
    private val longClient = client.newBuilder().readTimeout(65, TimeUnit.SECONDS).build()
    /** 传文件、取文件：大文件慢网 */
    private val fileClient = client.newBuilder().writeTimeout(5, TimeUnit.MINUTES).readTimeout(2, TimeUnit.MINUTES).build()
    /** 实时推送：后台有心跳，90 秒没数据就当断了 */
    private val streamClient: OkHttpClient = client.newBuilder().readTimeout(90, TimeUnit.SECONDS).build()
    private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

    val userAgent = "OperoApp/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MODEL})"

    private val _signedOut = MutableSharedFlow<String>(extraBufferCapacity = 1)
    /** 这台手机被断开了（参数是给人看的原因） */
    val signedOut: SharedFlow<String> = _signedOut

    private val refreshLock = Mutex()

    suspend fun call(
        method: String,
        path: String,
        body: JSONObject? = null,
        query: Map<String, Any?> = emptyMap(),
        long: Boolean = false,
        server: String? = null,
        auth: Auth = Auth.DEVICE,
    ): JSONObject = parseObject(text(send(method, path, jsonBody(method, body), query, if (long) longClient else client, server, auth)))

    /** 返回是数组的接口（比如 GET /api/sessions/:id/messages） */
    suspend fun callArray(method: String, path: String, query: Map<String, Any?> = emptyMap(), auth: Auth = Auth.OWNER): JSONArray {
        val s = text(send(method, path, null, query, client, null, auth))
        return try { JSONArray(s.ifBlank { "[]" }) } catch (_: Exception) { JSONArray() }
    }

    suspend fun post(path: String, body: JSONObject? = null) = call("POST", path, body)

    /** 主人的接口（会话令牌） */
    suspend fun owner(method: String, path: String, body: JSONObject? = null, query: Map<String, Any?> = emptyMap()) =
        call(method, path, body, query, auth = Auth.OWNER)

    /** 传文件：请求体是文件字节（POST /api/sessions/:id/files?name=&type=&w=&h=） */
    suspend fun upload(path: String, query: Map<String, Any?>, bytes: ByteArray, type: String): JSONObject {
        val body = bytes.toRequestBody(type.ifBlank { "application/octet-stream" }.toMediaTypeOrNull())
        return parseObject(text(send("POST", path, body, query, fileClient, null, Auth.OWNER)))
    }

    /** 拿文件 / 图片的字节：自己那套 Opero 的地址带会话令牌，别的地址不带 */
    suspend fun bytes(url: String): ByteArray {
        if (url.startsWith("data:")) {
            val comma = url.indexOf(',')
            if (comma < 0) throw ApiError(0, null, t("出错了（{0}）", "data"))
            val head = url.substring(0, comma)
            val body = url.substring(comma + 1)
            return if (head.endsWith(";base64")) android.util.Base64.decode(body, android.util.Base64.DEFAULT) else Uri.decode(body).toByteArray()
        }
        val full = abs(url)
        val base = store.server ?: ""
        if (base.isNotEmpty() && full.startsWith("$base/")) return send("GET", full.removePrefix(base), null, emptyMap(), fileClient, null, Auth.OWNER)
        return withContext(Dispatchers.IO) {
            val req = Request.Builder().url(full).header("User-Agent", userAgent).build()
            try {
                fileClient.newCall(req).execute().use { r ->
                    if (!r.isSuccessful) throw ApiError(r.code, null, t("出错了（{0}）", r.code))
                    r.body?.bytes() ?: ByteArray(0)
                }
            } catch (e: ApiError) { throw e } catch (e: Exception) { throw ApiError(0, "NETWORK", e.message ?: t("没有网络")) }
        }
    }

    /**
     * 文件地址拼完整：后台给的是相对地址（`api/uploads/<员工>/<文件>`、`/api/files/<id>`），
     * 前面拼 Opero 地址（装在子路径下时地址里带着子路径），见 docs/api/README.md「文件和图片地址」
     */
    fun abs(url: String): String {
        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url
        return (store.server ?: "") + "/" + url.trimStart('/')
    }

    /** 实时推送（GET /api/events）：开一个不关的请求，调用方一行行读；会话令牌过期先换一个 */
    suspend fun openStream(path: String): Response {
        val token = store.sessionToken ?: refreshSession(null)
        val first = withContext(Dispatchers.IO) { streamClient.newCall(request("GET", path, null, emptyMap(), null, token)).execute() }
        if (first.code != 401) return first
        val code = parseObject(first.body?.string().orEmpty()).optString("code")
        first.close()
        if (code == "DEVICE") { deviceGone(); throw ApiError(401, code, t("这台手机在网页上被断开了，重新登录一下")) }
        val fresh = refreshSession(token)
        return withContext(Dispatchers.IO) { streamClient.newCall(request("GET", path, null, emptyMap(), null, fresh)).execute() }
    }

    private fun jsonBody(method: String, body: JSONObject?): RequestBody? =
        if (method == "GET" || method == "DELETE") null else (body ?: JSONObject()).toString().toRequestBody(JSON_TYPE)

    private fun text(b: ByteArray) = b.toString(Charsets.UTF_8)

    private fun parseObject(text: String): JSONObject = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (_: Exception) { JSONObject() }

    private suspend fun send(method: String, path: String, body: RequestBody?, query: Map<String, Any?>, http: OkHttpClient, server: String?, auth: Auth): ByteArray {
        if (auth != Auth.OWNER) return exec(method, path, body, query, http, server, if (auth == Auth.DEVICE) store.deviceToken else null, auth)
        val token = store.sessionToken ?: refreshSession(null)
        return try {
            exec(method, path, body, query, http, server, token, auth)
        } catch (e: ApiError) {
            if (e.status != 401 || e.code != "AUTH") throw e
            exec(method, path, body, query, http, server, refreshSession(token), auth) // 会话过期了：换一个再试一次
        }
    }

    /**
     * 用设备令牌换会话令牌（POST /api/app/session）。几个请求同时发现过期只换一次：
     * stale = 发现过期的那个令牌；别的请求已经换过了（现在的不是它）就直接用新的。
     */
    suspend fun refreshSession(stale: String?): String = refreshLock.withLock {
        store.sessionToken?.let { if (it != stale) return@withLock it }
        val r = call("POST", "/api/app/session", auth = Auth.DEVICE)
        val token = r.optString("token")
        if (token.isBlank()) throw ApiError(0, null, t("出错了（{0}）", "session"))
        store.sessionToken = token
        token
    }

    private fun request(method: String, path: String, body: RequestBody?, query: Map<String, Any?>, server: String?, token: String?): Request {
        val base = server ?: store.server ?: throw ApiError(0, "NO_SERVER", t("还没连上你的 Opero"))
        val url = (base + path).toHttpUrlOrNull()?.newBuilder()?.apply {
            query.forEach { (k, v) -> if (v != null) addQueryParameter(k, v.toString()) }
        }?.build() ?: throw ApiError(0, "BAD_URL", t("地址不对：{0}", base))
        val needsBody = method == "POST" || method == "PUT" || method == "PATCH"
        return Request.Builder().url(url)
            .header("X-Opero-Client", "app")
            .header("User-Agent", userAgent)
            .header("Accept-Language", "zh-CN") // 后台的提示是中文，App 按自己的字典换（和网页一样）
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .method(method, body ?: if (needsBody) ByteArray(0).toRequestBody(null) else null)
            .build()
    }

    private suspend fun exec(method: String, path: String, body: RequestBody?, query: Map<String, Any?>, http: OkHttpClient, server: String?, token: String?, auth: Auth): ByteArray =
        withContext(Dispatchers.IO) {
            val req = request(method, path, body, query, server, token)
            val (status, bytes) = try {
                http.newCall(req).execute().use { r -> r.code to (r.body?.bytes() ?: ByteArray(0)) }
            } catch (e: Exception) {
                throw ApiError(0, "NETWORK", e.message ?: t("没有网络"))
            }
            if (status !in 200..299) {
                val o = parseObject(text(bytes))
                val code = o.optString("code").ifEmpty { null }
                val msg = o.optString("message").ifEmpty { o.optString("detail") }.ifEmpty { t("出错了（{0}）", status) }
                if (status == 401 && code == "DEVICE" && auth != Auth.NONE) deviceGone()
                throw ApiError(status, code, t(msg))
            }
            bytes
        }

    private fun deviceGone() {
        if (store.deviceToken == null) return
        store.clearPairing()
        _signedOut.tryEmit(t("这台手机在网页上被断开了，重新登录一下"))
    }

    /** 这个地址是不是自己那套 Opero（嵌网页、外链判断用） */
    fun isOwn(url: String): Boolean {
        val server = store.server ?: return false
        val h = Uri.parse(server)
        val u = Uri.parse(url)
        return u.scheme == h.scheme && u.host == h.host && u.port == h.port
    }
}
