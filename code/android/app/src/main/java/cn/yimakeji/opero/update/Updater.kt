package cn.yimakeji.opero.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import cn.yimakeji.opero.BuildConfig
import cn.yimakeji.opero.data.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * App 内更新：问自己那套 Opero 有没有新外壳（GET /api/app/update → versionCode / versionName / url / sha256 / must / notes），
 * 下载到 files/update/、核对 sha256，交给系统安装器（第一次要在系统设置里允许「安装未知应用」）。
 * 外壳很少要更新：界面都在网页里，网页随 Opero 一起发版。
 */
object Updater {
    data class Latest(val code: Int, val name: String, val url: String, val sha256: String?, val must: Boolean, val notes: String)

    suspend fun check(): Latest? {
        val o = Api.call("GET", "/api/app/update", query = mapOf("platform" to "android", "build" to BuildConfig.VERSION_CODE))
        val code = o.optInt("versionCode", 0)
        val url = o.optString("url")
        if (code <= BuildConfig.VERSION_CODE || url.isBlank()) return null
        return Latest(code, o.optString("versionName"), url, o.optString("sha256").ifEmpty { null }, o.optBoolean("must"), o.optString("notes"))
    }

    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()

    /** 下载并核对；返回安装包文件 */
    suspend fun download(ctx: Context, l: Latest, onProgress: (Int) -> Unit = {}): File = withContext(Dispatchers.IO) {
        val dir = File(ctx.filesDir, "update").apply { mkdirs() }
        val f = File(dir, "opero-${l.code}.apk")
        val url = if (l.url.startsWith("http")) l.url else (Api.store.server ?: "") + l.url
        client.newCall(Request.Builder().url(url).header("User-Agent", Api.userAgent).build()).execute().use { r ->
            if (!r.isSuccessful) throw IllegalStateException("下载失败（${r.code}）")
            val body = r.body ?: throw IllegalStateException("下载失败")
            val total = body.contentLength()
            val md = MessageDigest.getInstance("SHA-256")
            f.outputStream().use { out ->
                body.byteStream().use { inp ->
                    val buf = ByteArray(64 * 1024)
                    var got = 0L
                    while (true) {
                        val n = inp.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n); md.update(buf, 0, n); got += n
                        if (total > 0) onProgress((got * 100 / total).toInt())
                    }
                }
            }
            val sum = md.digest().joinToString("") { "%02x".format(it) }
            if (l.sha256 != null && !sum.equals(l.sha256, ignoreCase = true)) { f.delete(); throw IllegalStateException("安装包校验不对，已删掉，稍后再试") }
        }
        f
    }

    /** 交给系统安装；还没允许「安装未知应用」就先带去设置页，返回 false */
    fun install(ctx: Context, f: File): Boolean {
        if (!ctx.packageManager.canRequestPackageInstalls()) {
            ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return false
        }
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
        ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }

    /** 装好新版后清掉下载的安装包 */
    fun cleanup(ctx: Context) { try { File(ctx.filesDir, "update").listFiles()?.forEach { it.delete() } } catch (_: Exception) { } }
}
