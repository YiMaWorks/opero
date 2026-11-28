package cn.yimakeji.opero.web

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.URLUtil
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
import cn.yimakeji.opero.ui.theme.Opero
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/** 网页做不了、要外壳做的系统能力（MainActivity 实现） */
interface WebEnv {
    /** 验证本人：系统指纹 / 面容 / 锁屏密码，过了再调 POST /api/app/verified；done(true) = 可以做危险操作了 */
    fun verify(title: String, subtitle: String?, done: (Boolean) -> Unit)
    /** 用系统浏览器 / 别的 App 打开 */
    fun openExternal(url: String)
    fun haptic()
    /** 系统语音识别；done(文字, 出错原因) */
    fun voice(lang: String, done: (String, String?) -> Unit)
    /** 网页的 <input type="file">：交给系统选文件 */
    fun chooseFiles(params: WebChromeClient.FileChooserParams, cb: ValueCallback<Array<Uri>>): Boolean
    /** 网页要麦克风 */
    fun askMic(req: PermissionRequest)
    /** 存到手机：图片进相册（Pictures/Opero），别的进「下载」（Download/Opero）；安卓 9 及以下让用户选存哪 */
    fun saveFile(name: String, bytes: ByteArray, mime: String)
    /** 交给系统分享（发微信、邮件…） */
    fun shareFile(name: String, bytes: ByteArray, mime: String)
    fun toast(msg: String)
    fun setBars(dark: Boolean)
    fun logout()
    fun shellChanged()
}

/**
 * App 里的网页（界面用网页的手机版，原生只做外壳能力，见 docs/规范/App外壳.md）：
 *   - 整页（embed = false）：POST /api/app/ticket { route } 换一张一分钟的票，打开整个网页；route 只认 chat/<会话>（点通知直达）。
 *   - 嵌入（embed = true）：{ route, embed: true }，只显示那一页（docs/api/README.md「嵌网页」）。
 * 进去就是登录状态（票种好网页的 cookie）。下载、分享交给系统（网页里 <a download> 走下载监听，或者 JS 桥 download / share）。
 */
class WebPage(val key: String, private var route: String, private val embed: Boolean, private val env: WebEnv, private val nav: Nav) {
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
    @Volatile private var ready = false
    /** 点通知要打开的会话：网页加载完再交给它 */
    private var pendingOpen: String? = null
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
        override fun download(url: String, name: String) = ui { fetch(url, name, null) { n, b, m -> env.saveFile(n, b, m) } }
        override fun share(url: String, name: String) = ui { fetch(url, name, null) { n, b, m -> env.shareFile(n, b, m) } }
    }

    private fun ui(f: () -> Unit) { main.post(f) }
    private fun js(code: String) { view?.evaluateJavascript(code, null) }

    /** 取文件（自己那套 Opero 的地址带 App 的会话令牌），再存 / 分享 */
    private fun fetch(url: String, name: String, mime: String?, then: (String, ByteArray, String) -> Unit) {
        if (url.startsWith("blob:")) { env.toast(t("这个文件还没传好")); return }
        if (!url.startsWith("data:") && !Api.isOwn(Api.abs(url))) { env.openExternal(url); return } // 别的网站的文件交给浏览器
        val n = name.ifBlank { URLUtil.guessFileName(url, null, mime) }
        val m = mime?.takeIf { it.isNotBlank() && it != "application/octet-stream" } ?: mimeOf(n)
        env.toast(t("正在下载…"))
        scope.launch {
            try { then(n, Api.bytes(url), m) } catch (e: ApiError) { env.toast(e.message ?: t("下载失败")) }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun webView(ctx: Context, dark: Boolean): WebView {
        view?.let { (it.parent as? ViewGroup)?.removeView(it); return it }
        val w = WebView(ctx).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.setSupportMultipleWindows(false)
            settings.userAgentString = "${settings.userAgentString} OperoApp/${BuildConfig.VERSION_NAME} ${if (dark) "dark" else "light"}"
            addJavascriptInterface(if (embed) ClosableBridge(host) else Bridge(host), "OperoNative")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, req: WebResourceRequest?): Boolean {
                    val u = req?.url?.toString() ?: return false
                    if (Api.isOwn(u)) return false
                    env.openExternal(u) // 别的网站交给系统
                    return true
                }
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) { current = url ?: ""; ready = false }
                override fun onPageFinished(view: WebView?, url: String?) {
                    current = url ?: ""
                    loading = false
                    ready = Api.isOwn(current)
                    if (ready) pendingOpen?.let { pendingOpen = null; openRoute(it) }
                }
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
            // 网页里点下载（<a download>、?dl=1 的地址）：外壳取下来存到手机，不交给浏览器（浏览器没有登录）
            setDownloadListener { url, _, disposition, mimetype, _ ->
                fetch(url, URLUtil.guessFileName(url, disposition, mimetype), mimetype) { n, b, m -> env.saveFile(n, b, m) }
            }
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
                val body = JSONObject().put("route", route).apply { if (embed) put("embed", true) }
                val r = Api.post("/api/app/ticket", body)
                if (!embed) route = "" // 点通知带的会话只用一次
                val url = r.optString("url")
                w.loadUrl(if (url.startsWith("http")) url else server + url)
            } catch (e: ApiError) {
                if (e.code != "DEVICE") error = t("连不上 {0}：{1}", Uri.parse(server).host ?: server, e.message ?: "")
                loading = false
            }
        }
    }

    /** 点通知：网页开着就交给网页打开那个会话（window.__operoNative.open('chat/<id>')），还没开好就带在票里 */
    fun openRoute(r: String) {
        when {
            ready && view != null -> js("window.__operoNative && window.__operoNative.open(${JSONObject.quote(r)})")
            view == null -> route = r          // 还没建 WebView：带在第一张票里
            else -> pendingOpen = r            // 正在加载：加载完再交给网页
        }
    }

    /**
     * 返回键：done(true) = 网页自己退了一层。
     *   - 嵌入页：先问网页（有弹窗关弹窗、有子页退子页），到顶了 done(false)
     *   - 整页：网页每打开一层（聊天、页面、面板、弹层）都记一步历史，能后退就后退
     */
    fun back(done: (Boolean) -> Unit) {
        val w = view
        if (w == null || error != null) { done(false); return }
        if (!embed) { if (w.canGoBack()) { w.goBack(); done(true) } else done(false); return }
        w.evaluateJavascript("(function(){try{return !!(window.__operoNative&&window.__operoNative.back&&window.__operoNative.back())}catch(e){return false}})()") { r ->
            done(r == "true")
        }
    }

    fun destroy() {
        view?.let { (it.parent as? ViewGroup)?.removeView(it); it.destroy() }
        view = null
    }

    private fun mimeOf(name: String): String =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
}

@Composable
fun WebScreen(page: WebPage, dark: Boolean, env: WebEnv) {
    val c = Opero.colors
    val err = page.error
    Box(Modifier.fillMaxSize().background(c.bg)) {
        AndroidView(factory = { ctx -> page.webView(ctx, dark) }, modifier = Modifier.fillMaxSize())
        if (err != null) ErrorScreen(err, onRetry = { page.load() }, onLogout = { env.logout() })
        else if (page.loading) CircularProgressIndicator(Modifier.align(Alignment.Center), color = c.primary)
    }
}
