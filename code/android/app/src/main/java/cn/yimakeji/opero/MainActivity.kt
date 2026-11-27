package cn.yimakeji.opero

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import cn.yimakeji.opero.data.Account
import cn.yimakeji.opero.data.Api
import cn.yimakeji.opero.data.Live
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.lock.AppLock
import cn.yimakeji.opero.push.Notifier
import cn.yimakeji.opero.push.PushClient
import cn.yimakeji.opero.push.PushService
import cn.yimakeji.opero.ui.ErrorScreen
import cn.yimakeji.opero.ui.Home
import cn.yimakeji.opero.ui.Nav
import cn.yimakeji.opero.ui.common.LocalHost
import cn.yimakeji.opero.ui.login.LoginScreen
import cn.yimakeji.opero.ui.theme.OperoTheme
import cn.yimakeji.opero.update.Updater
import cn.yimakeji.opero.web.WebEnv
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Opero App 唯一的 Activity：整页 Compose（docs/多端架构.md「逐步原生化」）。
 *   - 没登录 → 原生登录页（ui/login）
 *   - 登录了 → 主界面（ui/Home.kt）：会话列表、聊天是原生的；员工 / 项目 / 应用 / 我 和别的页面嵌网页（web/EmbedPage.kt）
 *   - 被断开（任何接口 401 DEVICE）→ 回登录页并说明；开机拉不到数据 → 出错页（重试 / 退出登录）
 * 这里还实现原生页面和嵌入页要用的系统能力（[WebEnv]）：指纹验证本人、语音识别、选文件、麦克风、打开文件 / 外链、锁屏、App 内更新。
 */
class MainActivity : FragmentActivity(), WebEnv {
    private lateinit var root: FrameLayout
    private var lockView: View? = null

    private var loggedIn by mutableStateOf(false)
    private var notice by mutableStateOf<String?>(null)
    private val nav = Nav(this)

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingMic: PermissionRequest? = null
    private var voiceDone: ((String, String?) -> Unit)? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }
    private val askMicPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        pendingMic?.let { if (ok) it.grant(it.resources) else it.deny() }
        pendingMic = null
    }
    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private val askVoice = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val text = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: ""
        voiceDone?.invoke(text, null)
        voiceDone = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        OperoApp.ensureStore(this)
        loggedIn = Api.store.loggedIn
        bars(Api.store.dark)
        Notifier.ensureChannels(this)
        buildViews()
        handle(intent)
        if (savedInstanceState == null) AppLock.onColdStart()
        lifecycleScope.launch { AppLock.locked.collect { showLock(it) } }
        lifecycleScope.launch { Api.signedOut.collect { signedOut(it) } }
        lifecycleScope.launch { Live.toasts.collect { Toast.makeText(this@MainActivity, it, Toast.LENGTH_SHORT).show() } }
        // 页面里的返回（BackHandler）先处理；都退到底了就回桌面
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { moveTaskToBack(true) }
        })
        if (loggedIn) { PushService.start(this); checkUpdate() }
    }

    override fun onStart() { super.onStart(); AppLock.onStart(); Live.resume() }
    override fun onStop() { super.onStop(); AppLock.onStop(); Live.pause() }
    override fun onResume() {
        super.onResume()
        // 开了指纹解锁：最近任务里不显示内容（安卓 13+）
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!Api.store.lockOn)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handle(intent) }

    // ───── 界面 ─────

    private fun buildViews() {
        root = FrameLayout(this)
        val compose = ComposeView(this).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                val dark = when (Live.theme) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
                LaunchedEffect(dark) { setBars(dark) }
                OperoTheme(dark = dark) {
                    CompositionLocalProvider(LocalHost provides this@MainActivity) {
                        val err = Live.bootError
                        when {
                            !loggedIn -> LoginScreen(notice, onDone = { onLoggedIn() })
                            err != null && !Live.ready -> ErrorScreen(err, onRetry = { Live.retry() }, onLogout = { logout() })
                            else -> Home(nav, this@MainActivity, dark)
                        }
                    }
                }
            }
        }
        root.addView(compose, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // 状态栏、导航栏、键盘让出来（edge-to-edge 下自己按 insets 留边）
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(sys.left, sys.top, sys.right, maxOf(sys.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
    }

    private fun bars(dark: Boolean) {
        val style = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
        if (::root.isInitialized) root.setBackgroundColor(Color.parseColor(if (dark) "#171A23" else "#FFFFFF"))
    }

    /** 锁屏：盖在最上面，验过才拿掉 */
    private fun showLock(on: Boolean) {
        if (!on) { lockView?.let { root.removeView(it) }; lockView = null; return }
        if (lockView != null) return
        val dark = Api.store.dark
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor(if (dark) "#0F1117" else "#F4F5F8"))
            isClickable = true
            addView(ImageView(context).apply { setImageResource(R.drawable.ic_mark) })
            addView(TextView(context).apply {
                text = Tr.s(R.string.locked); textSize = 17f; setTextColor(Color.parseColor(if (dark) "#F2F3F4" else "#101826"))
                gravity = Gravity.CENTER; setPadding(0, dp(16), 0, dp(24))
            })
            addView(Button(context).apply { text = Tr.s(R.string.unlock); setOnClickListener { unlock() } })
        }
        lockView = box
        root.addView(box, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        unlock()
    }

    private fun unlock() {
        if (AppLock.unavailable(this) != null) { AppLock.unlocked(); return } // 手机没设锁屏：不锁死人
        AppLock.prompt(this, Tr.s(R.string.unlock_title), null, onOk = { AppLock.unlocked() }, onFail = { })
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    // ───── 登录状态 ─────

    /** 登录好了：要通知权限、开常驻连接、拉数据 */
    private fun onLoggedIn() {
        notice = null
        loggedIn = true
        if (Build.VERSION.SDK_INT >= 33) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
        lifecycleScope.launch { try { PushClient.register() } catch (_: Exception) { } }
        PushService.start(this)
        Live.resume()
        checkUpdate()
    }

    /** 被断开（401 DEVICE，Api 已经清掉令牌）：清数据、网页的登录也清掉，回登录页 */
    private fun signedOut(msg: String) {
        PushService.stop(this)
        Live.clear()
        nav.reset()
        CookieManager.getInstance().removeAllCookies(null)
        notice = msg
        loggedIn = false
    }

    override fun logout() {
        lifecycleScope.launch {
            Account.logout()
            PushService.stop(this@MainActivity)
            Live.clear()
            nav.reset()
            CookieManager.getInstance().removeAllCookies(null)
            notice = null
            loggedIn = false
        }
    }

    /** 点通知打开（operoapp://open?route=chat/<会话> 或通知带的 route）：打开那个会话 */
    private fun handle(i: Intent?) {
        if (i == null) return
        val route = i.getStringExtra(Notifier.EXTRA_ROUTE) ?: i.data?.takeIf { it.scheme == "operoapp" }?.getQueryParameter("route")
        i.removeExtra(Notifier.EXTRA_ROUTE); i.data = null
        if (route == null || !Regex("^[\\w/?=&;.-]{1,160}$").matches(route) || !Api.store.loggedIn) return
        when {
            route.startsWith("chat/") -> nav.openFromPush(route.removePrefix("chat/").substringBefore('?'))
            else -> nav.open(route)
        }
    }

    // ───── AppHost / WebEnv ─────

    override fun verify(title: String, subtitle: String?, done: (Boolean) -> Unit) {
        AppLock.verify(this, title, subtitle,
            onOk = {
                lifecycleScope.launch {
                    val ok = try { Api.post("/api/app/verified"); true } catch (_: Exception) { false }
                    if (!ok) Live.toast(t("验证失败"))
                    done(ok)
                }
            },
            onFail = { err -> if (err != null) Live.toast(err); done(false) })
    }

    override fun openExternal(url: String) {
        try { AppLock.skipNext(); startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
    }

    override fun openFile(name: String, bytes: ByteArray, mime: String) {
        lifecycleScope.launch {
            try {
                val f = withContext(Dispatchers.IO) {
                    val dir = File(cacheDir, "open").apply { mkdirs() }
                    File(dir, name.replace(Regex("[/\\\\]"), "_")).apply { writeBytes(bytes) }
                }
                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                AppLock.skipNext()
                startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), name))
            } catch (_: Exception) {
                Live.toast(t("这台手机上没有能打开它的 App"))
            }
        }
    }

    override fun haptic() { window.decorView.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS) }

    override fun skipLock() { AppLock.skipNext() }

    override fun voice(lang: String, done: (String, String?) -> Unit) {
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang.ifBlank { "zh-CN" })
            .putExtra(RecognizerIntent.EXTRA_PROMPT, Tr.s(R.string.speak))
        try { voiceDone = done; AppLock.skipNext(); askVoice.launch(i) } catch (_: Exception) { voiceDone = null; done("", "none") }
    }

    override fun chooseFiles(params: WebChromeClient.FileChooserParams, cb: ValueCallback<Array<Uri>>): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = cb
        return try { AppLock.skipNext(); pickFiles.launch(params.createIntent()); true } catch (_: Exception) { fileCallback = null; false }
    }

    override fun askMic(req: PermissionRequest) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) req.grant(req.resources)
        else { pendingMic = req; askMicPerm.launch(Manifest.permission.RECORD_AUDIO) }
    }

    /** 状态栏 / 导航栏跟着深浅色（原生页面按 Opero 设置的 theme 算，嵌入的网页报过来的也走这里） */
    private var barsDark: Boolean? = null
    override fun setBars(dark: Boolean) {
        if (barsDark == dark) return
        barsDark = dark
        Api.store.dark = dark
        bars(dark)
    }

    override fun shellChanged() {
        if (PushService.canRun()) PushService.start(this) else PushService.stop(this)
    }

    // ───── 更新 ─────

    private fun checkUpdate() {
        if (Api.store.deviceToken == null) return
        lifecycleScope.launch {
            val l = try { Updater.check() } catch (_: Exception) { null } ?: return@launch
            android.app.AlertDialog.Builder(this@MainActivity)
                .setTitle(Tr.s(R.string.update_title, l.name))
                .setMessage(l.notes.ifBlank { Tr.s(R.string.update_note) })
                .setPositiveButton(Tr.s(R.string.update)) { _, _ ->
                    lifecycleScope.launch {
                        try { val f = Updater.download(this@MainActivity, l); AppLock.skipNext(); Updater.install(this@MainActivity, f) }
                        catch (e: Exception) { Toast.makeText(this@MainActivity, e.message ?: Tr.s(R.string.download_failed), Toast.LENGTH_LONG).show() }
                    }
                }
                .apply { if (!l.must) setNegativeButton(Tr.s(R.string.later), null) }
                .setCancelable(!l.must)
                .show()
        }
    }
}
