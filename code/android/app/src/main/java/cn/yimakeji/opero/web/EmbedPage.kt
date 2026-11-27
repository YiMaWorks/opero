package cn.yimakeji.opero.web

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import cn.yimakeji.opero.BuildConfig
import cn.yimakeji.opero.data.Api
import cn.yimakeji.opero.data.ApiError
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.ErrorScreen
import cn.yimakeji.opero.ui.common.AppHost
import cn.yimakeji.opero.ui.theme.Opero
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/** 嵌入页要用到的系统能力（MainActivity 实现） */
interface WebEnv : AppHost {
    /** 系统语音识别；done(文字, 出错原因) */
    fun voice(lang: String, done: (String, String?) -> Unit)
    /** 网页的 <input type="file">：交给系统选文件 */
    fun chooseFiles(params: WebChromeClient.FileChooserParams, cb: ValueCallback<Array<Uri>>): Boolean
    /** 网页要麦克风 */
    fun askMic(req: PermissionRequest)
    fun setBars(dark: Boolean)
    fun logout()
    fun shellChanged()
}

/**
 * 一个嵌入的网页（docs/api/README.md「嵌网页」）：POST /api/app/ticket { route, embed: true } 换一张一分钟的票，WebView 打开，
 * 进去就是登录状态、只显示这一页。WebView 按 key 留着（页签根上的页面切走再回来不用重新加载），关掉一层时销毁。
 */
class WebPage(val key: String, val route: String, val closable: Boolean, private val env: WebEnv, private val nav: Nav) {
    interface Nav {
        fun open(route: String)
        fun close(key: String)
    }

    var loading by mutableStateOf(true)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    private var view: WebView? = null
    @Volatile private var current = ""
    private val main = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val host = object : Bridge.Host {
        override fun trusted() = Api.isOwn(current)
        override fun verify(id: String, title: String, subtitle: String) = ui {
            env.verify(title, subtitle.ifBlank { null }) { ok -> js("window.__operoNative && window.__operoNative.onVerify(${JSONObject.quote(id)}, $ok)") }
        }
        override fun setTheme(dark: Boolean) = ui { env.setBars(dark) }
        override fun setBars(dark: Boolean, bg: Int, panel: Int) = ui { env.setBars(dark) }
        override fun openExternal(url: String) = ui { env.openExternal(url) }
        override fun haptic() = ui { env.haptic() }
        override fun unpair() = ui { env.logout() }
        override fun relogin() = ui { load() }
        override fun shellChanged() = ui { env.shellChanged() }
        override fun voice(lang: String) = ui {
            env.voice(lang) { text, err ->
                js("window.__operoNative && window.__operoNative.onVoice && window.__operoNative.onVoice(${JSONObject.quote(text)}${if (err != null) ", ${JSONObject.quote(err)}" else ""})")
            }
        }
        override fun open(route: String) = ui { nav.open(route) }
        override fun close() = ui { nav.close(key) }
    }

    private fun ui(f: () -> Unit) { main.post(f) }
    private fun js(code: String) { view?.evaluateJavascript(code, null) }

    @SuppressLint("SetJavaScriptEnabled")
    fun webView(ctx: Context, dark: Boolean): WebView {
        view?.let { (it.parent as? ViewGroup)?.removeView(it); return it }
        val w = WebView(ctx).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.setSupportMultipleWindows(false)
            settings.userAgentString = "${settings.userAgentString} OperoApp/${BuildConfig.VERSION_NAME} ${if (dark) "dark" else "light"}"
            addJavascriptInterface(if (closable) ClosableBridge(host) else Bridge(host), "OperoNative")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, req: WebResourceRequest?): Boolean {
                    val u = req?.url?.toString() ?: return false
                    if (Api.isOwn(u)) return false
                    env.openExternal(u) // 别的网站交给系统
                    return true
                }
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) { current = url ?: "" }
                override fun onPageFinished(view: WebView?, url: String?) { current = url ?: ""; loading = false }
                override fun onReceivedError(view: WebView?, req: WebResourceRequest?, err: WebResourceError?) {
                    if (req == null || !req.isForMainFrame) return
                    error = t("打不开 {0}：{1}", req.url.host ?: "", err?.description ?: t("没有网络"))
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView?, cb: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean =
                    if (cb == null || params == null) false else env.chooseFiles(params, cb)
                override fun onPermissionRequest(req: PermissionRequest?) {
                    if (req == null) return
                    main.post {
                        if (!Api.isOwn(req.origin.toString()) || PermissionRequest.RESOURCE_AUDIO_CAPTURE !in req.resources) req.deny()
                        else env.askMic(req)
                    }
                }
            }
            setDownloadListener { url, _, _, _, _ -> env.openExternal(url) }
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, false)
        view = w
        load()
        return w
    }

    /** 换票、打开（第一次、重试、网页说登录过期了） */
    fun load() {
        val w = view ?: return
        val server = Api.store.server ?: return
        loading = true
        error = null
        scope.launch {
            try {
                val r = Api.post("/api/app/ticket", JSONObject().put("route", route).put("embed", true))
                val url = r.optString("url")
                w.loadUrl(if (url.startsWith("http")) url else server + url)
            } catch (e: ApiError) {
                if (e.code != "DEVICE") error = t("连不上 {0}：{1}", Uri.parse(server).host ?: server, e.message ?: "")
                loading = false
            }
        }
    }

    /** 返回键先问网页：有弹窗 / 子页就是网页自己退（done(true)），到顶了 done(false) */
    fun back(done: (Boolean) -> Unit) {
        val w = view
        if (w == null || error != null) { done(false); return }
        w.evaluateJavascript("(function(){try{return !!(window.__operoNative&&window.__operoNative.back&&window.__operoNative.back())}catch(e){return false}})()") { r ->
            done(r == "true")
        }
    }

    fun destroy() {
        view?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        view = null
    }
}

@Composable
fun EmbedView(page: WebPage, dark: Boolean, env: WebEnv) {
    val c = Opero.colors
    val err = page.error
    Box(Modifier.fillMaxSize().background(c.bg)) {
        AndroidView(factory = { ctx -> page.webView(ctx, dark) }, modifier = Modifier.fillMaxSize())
        if (err != null) ErrorScreen(err, onRetry = { page.load() }, onLogout = { env.logout() })
        else if (page.loading) CircularProgressIndicator(Modifier.align(Alignment.Center), color = c.primary)
    }
}
