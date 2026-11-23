package cn.yimakeji.opero

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import cn.yimakeji.opero.data.Api
import cn.yimakeji.opero.data.ApiError
import cn.yimakeji.opero.lock.AppLock
import cn.yimakeji.opero.push.Notifier
import cn.yimakeji.opero.push.PushClient
import cn.yimakeji.opero.push.PushService
import cn.yimakeji.opero.update.Updater
import cn.yimakeji.opero.web.Bridge
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Opero App 就这一个界面：WebView 打开你自己那套 Opero 的网页（界面全在网页里，加功能不用发 App）。
 * 外壳只管网页做不了的（照 KidLock 安卓）：常驻推送、指纹（解锁 App / 验证本人）、点通知直达会话、选文件 / 拍照、麦克风、App 内更新。
 *
 * 打开时：
 *   - 没连过 → 外壳自带的「连接你的 Opero」页（assets/pair.html）
 *   - 配对过（有设备令牌）→ POST /api/app/ticket 要一张一次性的票，打开票地址（后台种好登录 cookie 再跳到首页）
 *   - 只填了地址没配对（现在的界面原型没有后台）→ 直接打开地址，收不到推送
 */
class MainActivity : FragmentActivity(), Bridge.Host {
    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private var lockView: View? = null
    @Volatile private var currentUrl: String = ""
    @Volatile private var dark = false
    private var pendingRoute: String? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }
    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        pendingPermission?.let { if (ok) it.grant(it.resources) else it.deny() }
        pendingPermission = null
    }
    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        OperoApp.ensureStore(this)
        dark = Api.store.dark
        applyBars()
        Notifier.ensureChannels(this)
        buildViews()
        handle(intent)
        if (savedInstanceState == null) AppLock.onColdStart()
        lifecycleScope.launch { AppLock.locked.collect { showLock(it) } }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            // 网页每打开一层（聊天、页面、面板、弹层）都记一步历史，返回只关最上面一层；到底了退到桌面
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else moveTaskToBack(true) }
        })
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else start()
        checkUpdate()
    }

    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web.saveState(outState) }
    override fun onStart() { super.onStart(); AppLock.onStart() }
    override fun onStop() { super.onStop(); AppLock.onStop() }
    override fun onResume() {
        super.onResume()
        // 开了指纹解锁：最近任务里不显示内容（安卓 13+）
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!Api.store.lockOn)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handle(intent) }
    override fun onDestroy() { web.destroy(); super.onDestroy() }

    // ───── 界面 ─────

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildViews() {
        root = FrameLayout(this)
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.setSupportMultipleWindows(false)
            settings.userAgentString = "${settings.userAgentString} OperoApp/${BuildConfig.VERSION_NAME} ${if (dark) "dark" else "light"}"
            setBackgroundColor(bgColor())
            addJavascriptInterface(Bridge(this@MainActivity), "OperoNative")
            webViewClient = Client()
            webChromeClient = Chrome()
            setDownloadListener { url, _, _, _, _ -> openExternal(url) }
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.setBackgroundColor(panelColor())
        // 状态栏、导航栏、键盘让出来（edge-to-edge 下 adjustResize 不管用，自己按 insets 留边）
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
    }

    // 网页告诉过风格就用网页的颜色（setBars），没有就用默认的紫晶 / 石板
    @Volatile private var bgC: Int? = null
    @Volatile private var panelC: Int? = null
    private fun bgColor() = bgC ?: Color.parseColor(if (dark) "#0F1117" else "#F4F5F8")
    private fun panelColor() = panelC ?: Color.parseColor(if (dark) "#171A23" else "#FFFFFF")

    private fun applyBars() {
        val style = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }

    /** 锁屏：盖在网页上面，验过才拿掉 */
    private fun showLock(on: Boolean) {
        if (!on) { lockView?.let { root.removeView(it) }; lockView = null; return }
        if (lockView != null) return
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(bgColor())
            isClickable = true
            addView(ImageView(context).apply { setImageResource(R.drawable.ic_mark) })
            addView(TextView(context).apply {
                text = "Opero 已锁定"; textSize = 17f; setTextColor(Color.parseColor(if (dark) "#F2F3F4" else "#101826"))
                gravity = Gravity.CENTER; setPadding(0, dp(16), 0, dp(24))
            })
            addView(Button(context).apply { text = "解锁"; setOnClickListener { unlock() } })
        }
        lockView = box
        root.addView(box, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        unlock()
    }

    private fun unlock() {
        if (AppLock.unavailable(this) != null) { AppLock.unlocked(); return } // 手机没设锁屏：不锁死人
        AppLock.prompt(this, "解锁 Opero", null, onOk = { AppLock.unlocked() }, onFail = { })
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    // ───── 打开哪里 ─────

    private fun start() {
        val s = Api.store
        val server = s.server
        when {
            server == null -> loadPair()
            s.deviceToken == null -> web.loadUrl(server + (pendingRoute?.let { "/#/$it" } ?: "/"))
            else -> openWithTicket(server)
        }
    }

    private fun loadPair(error: String? = null) {
        val q = Uri.Builder().appendQueryParameter("server", Api.store.server ?: BuildConfig.DEFAULT_SERVER)
            .apply { if (error != null) appendQueryParameter("error", error) }.build().encodedQuery
        web.loadUrl("file:///android_asset/pair.html?$q")
    }

    private fun openWithTicket(server: String) {
        lifecycleScope.launch {
            try {
                val r = Api.post("/api/app/ticket", JSONObject().put("route", pendingRoute ?: ""))
                pendingRoute = null
                val url = r.optString("url")
                web.loadUrl(if (url.startsWith("http")) url else server + url)
                PushService.start(this@MainActivity)
            } catch (e: ApiError) {
                when {
                    e.status == 401 -> { Api.store.clearPairing(); loadPair("这台手机已经在网页里断开了，重新配对一下") }
                    e.status == 404 -> web.loadUrl(server) // 后台还没有外壳接口（界面原型）：直接打开
                    else -> loadPair("连不上 ${Uri.parse(server).host}：${e.message}")
                }
            }
        }
    }

    /** 点通知打开（operoapp://open?route=… 或通知带的 route）：网页开着就直接交给网页，没开就等打开后再交 */
    private fun handle(i: Intent?) {
        if (i == null) return
        val route = i.getStringExtra(Notifier.EXTRA_ROUTE) ?: i.data?.takeIf { it.scheme == "operoapp" }?.getQueryParameter("route")
        i.removeExtra(Notifier.EXTRA_ROUTE); i.data = null
        if (route == null || !Regex("^[\\w/?=&.-]{1,120}$").matches(route)) return
        if (::web.isInitialized && isOpero(currentUrl)) deliverRoute(route) else pendingRoute = route
    }

    private fun deliverRoute(route: String) {
        web.evaluateJavascript("window.__operoNative && window.__operoNative.open(${JSONObject.quote(route)})", null)
    }

    private fun isOpero(url: String): Boolean {
        val server = Api.store.server ?: return false
        val h = Uri.parse(server)
        val u = Uri.parse(url)
        return u.scheme == h.scheme && u.host == h.host && u.port == h.port
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, req: WebResourceRequest?): Boolean {
            val u = req?.url?.toString() ?: return false
            if (isOpero(u) || u.startsWith("file:///android_asset/")) return false
            openExternal(u) // 别的网站（邮件 / Slack 原消息、文档链接）交给系统
            return true
        }
        override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) { currentUrl = url ?: "" }
        override fun onPageFinished(view: WebView?, url: String?) {
            if (url == null) return
            currentUrl = url
            if (isOpero(url)) pendingRoute?.let { pendingRoute = null; deliverRoute(it) }
        }
        override fun onReceivedError(view: WebView?, req: WebResourceRequest?, err: WebResourceError?) {
            if (req == null || !req.isForMainFrame || req.url.toString().startsWith("file:")) return
            loadPair("打不开 ${req.url.host}：${err?.description ?: "网络不通"}")
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(view: WebView?, cb: ValueCallback<Array<Uri>>?, params: FileChooserParams?): Boolean {
            if (cb == null || params == null) return false
            fileCallback?.onReceiveValue(null)
            fileCallback = cb
            return try { AppLock.skipNext(); pickFiles.launch(params.createIntent()); true } catch (_: Exception) { fileCallback = null; false }
        }
        override fun onPermissionRequest(req: PermissionRequest?) {
            if (req == null) return
            runOnUiThread {
                val wantsMic = PermissionRequest.RESOURCE_AUDIO_CAPTURE in req.resources
                if (!isOpero(req.origin.toString()) || !wantsMic) { req.deny(); return@runOnUiThread }
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) req.grant(req.resources)
                else { pendingPermission = req; askMic.launch(Manifest.permission.RECORD_AUDIO) }
            }
        }
    }

    // ───── Bridge.Host（网页调过来的，都切回主线程） ─────

    override fun trusted(): Boolean = isOpero(currentUrl) || currentUrl.startsWith("file:///android_asset/")

    override fun verify(id: String, title: String, subtitle: String) = runOnUiThread {
        AppLock.verify(this, title, subtitle,
            onOk = { lifecycleScope.launch { callback(id, reportVerified()) } },
            onFail = { err -> callback(id, false, err) })
    }

    /** 告诉后台「这台手机刚验过本人」（后台按这次登录记 30 分钟）；后台还没这个接口（原型）也算过 */
    private suspend fun reportVerified(): Boolean = try {
        if (Api.store.deviceToken != null) Api.post("/api/app/verified")
        true
    } catch (e: ApiError) { e.status == 404 } catch (_: Exception) { false }

    private fun callback(id: String, ok: Boolean, err: String? = null) {
        web.evaluateJavascript("window.__operoNative && window.__operoNative.onVerify(${JSONObject.quote(id)}, $ok, ${if (err == null) "undefined" else JSONObject.quote(err)})", null)
    }

    override fun setTheme(dark: Boolean) = runOnUiThread {
        if (this.dark == dark) return@runOnUiThread
        this.dark = dark
        Api.store.dark = dark
        applyBars()
        root.setBackgroundColor(panelColor())
        web.setBackgroundColor(bgColor())
    }

    override fun setBars(dark: Boolean, bg: Int, panel: Int) = runOnUiThread {
        bgC = bg; panelC = panel
        this.dark = dark
        Api.store.dark = dark
        applyBars()
        root.setBackgroundColor(panel)
        web.setBackgroundColor(bg)
    }

    override fun openExternal(url: String) = runOnUiThread {
        try { AppLock.skipNext(); startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
    }

    override fun haptic() = runOnUiThread { web.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS) }

    override fun unpair() = runOnUiThread {
        lifecycleScope.launch {
            PushClient.unregister()
            Api.store.clearPairing()
            PushService.stop(this@MainActivity)
            CookieManager.getInstance().removeAllCookies(null)
            loadPair()
        }
    }

    override fun relogin() = runOnUiThread { Api.store.server?.let { if (Api.store.deviceToken != null) openWithTicket(it) } }

    override fun shellChanged() = runOnUiThread {
        if (PushService.canRun()) PushService.start(this) else PushService.stop(this)
    }

    /** 连接页：有配对码就配对（拿设备令牌，能收推送）；没有就只记地址、直接打开 */
    override fun pair(server: String, code: String) = runOnUiThread {
        val base = server.trim().trimEnd('/').let { if (it.startsWith("http")) it else "https://$it" }
        if (Uri.parse(base).host.isNullOrBlank()) { pairResult(false, "地址不对"); return@runOnUiThread }
        lifecycleScope.launch {
            try {
                if (code.isNotBlank()) {
                    val r = Api.call("POST", "/api/app/pair", JSONObject().apply {
                        put("code", code.trim())
                        put("deviceId", Api.store.deviceId)
                        put("name", "${Build.MANUFACTURER} ${Build.MODEL}")
                        put("platform", "android")
                        put("appVersion", BuildConfig.VERSION_NAME)
                    }, server = base, auth = false)
                    val token = r.optString("deviceToken")
                    if (token.isBlank()) throw ApiError(0, null, "配对码不对或者过期了")
                    Api.store.server = base
                    Api.store.deviceToken = token
                    if (Build.VERSION.SDK_INT >= 33) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
                    openWithTicket(base)
                } else {
                    Api.store.server = base
                    Api.store.deviceToken = null
                    web.loadUrl(base)
                }
            } catch (e: ApiError) {
                pairResult(false, if (e.status == 404) "这套 Opero 还不支持配对（界面原型），先不填配对码直接连" else e.message ?: "连不上")
            }
        }
    }

    private fun pairResult(ok: Boolean, msg: String) {
        web.evaluateJavascript("window.__operoPair && window.__operoPair($ok, ${JSONObject.quote(msg)})", null)
    }

    // ───── 更新 ─────

    private fun checkUpdate() {
        if (Api.store.deviceToken == null) return
        lifecycleScope.launch {
            val l = try { Updater.check() } catch (_: Exception) { null } ?: return@launch
            android.app.AlertDialog.Builder(this@MainActivity)
                .setTitle("Opero App 有新版本 ${l.name}")
                .setMessage(l.notes.ifBlank { "外壳更新（界面在网页里，平时不用更新 App）" })
                .setPositiveButton("更新") { _, _ ->
                    lifecycleScope.launch {
                        try { val f = Updater.download(this@MainActivity, l); AppLock.skipNext(); Updater.install(this@MainActivity, f) }
                        catch (e: Exception) { android.widget.Toast.makeText(this@MainActivity, e.message ?: "下载失败", android.widget.Toast.LENGTH_LONG).show() }
                    }
                }
                .apply { if (!l.must) setNegativeButton("以后再说", null) }
                .setCancelable(!l.must)
                .show()
        }
    }
}
