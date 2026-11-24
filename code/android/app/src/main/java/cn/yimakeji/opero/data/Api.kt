package cn.yimakeji.opero.data

import cn.yimakeji.opero.Tr
import cn.yimakeji.opero.R
import android.os.Build
import cn.yimakeji.opero.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiError(val status: Int, val code: String?, message: String) : Exception(message)

/**
 * 外壳调自己那套 Opero 的接口（只有外壳自己的几个：配对、要网页票、推送、验证本人、检查更新，见 docs/规范/App外壳.md 第 3 节）。
 * 网页自己的请求走 WebView 的 cookie，不经过这里。
 * 请求头：Authorization: Bearer <设备令牌>、X-Opero-Client: app、User-Agent: OperoApp/<版本> (Android …)
 */
object Api {
    lateinit var store: Store

    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
    /** 长轮询：后台最多等 25 秒，读超时留够 */
    private val longClient = client.newBuilder().readTimeout(65, TimeUnit.SECONDS).build()
    private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

    val userAgent = "OperoApp/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MODEL})"

    suspend fun call(
        method: String,
        path: String,
        body: JSONObject? = null,
        query: Map<String, Any?> = emptyMap(),
        long: Boolean = false,
        server: String? = null,
        auth: Boolean = true,
    ): JSONObject = withContext(Dispatchers.IO) {
        val base = server ?: store.server ?: throw ApiError(0, "NO_SERVER", Tr.s(R.string.no_server))
        val url = (base + path).toHttpUrlOrNull()?.newBuilder()?.apply {
            query.forEach { (k, v) -> if (v != null) addQueryParameter(k, v.toString()) }
        }?.build() ?: throw ApiError(0, "BAD_URL", Tr.s(R.string.bad_url, base))
        val req = Request.Builder().url(url)
            .header("X-Opero-Client", "app")
            .header("User-Agent", userAgent)
            .header("Accept-Language", "zh-CN")
            .apply { if (auth) store.deviceToken?.let { header("Authorization", "Bearer $it") } }
            .method(method, if (method == "GET" || method == "DELETE") null else (body ?: JSONObject()).toString().toRequestBody(JSON_TYPE))
            .build()
        try {
            (if (long) longClient else client).newCall(req).execute().use { r ->
                val text = r.body?.string().orEmpty()
                val o = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (_: Exception) { JSONObject() }
                if (!r.isSuccessful) {
                    val code = o.optString("code").ifEmpty { null }
                    val msg = o.optString("message").ifEmpty { o.optString("detail") }.ifEmpty { Tr.s(R.string.error_code, r.code.toString()) }
                    throw ApiError(r.code, code, msg)
                }
                o
            }
        } catch (e: ApiError) {
            throw e
        } catch (e: Exception) {
            throw ApiError(0, "NETWORK", e.message ?: Tr.s(R.string.no_network))
        }
    }

    suspend fun post(path: String, body: JSONObject? = null) = call("POST", path, body)
}
