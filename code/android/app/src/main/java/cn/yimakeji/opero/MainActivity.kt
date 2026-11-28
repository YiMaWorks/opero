package cn.yimakeji.opero

import android.Manifest
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
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
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.lock.AppLock
import cn.yimakeji.opero.push.Notifier
import cn.yimakeji.opero.push.PushClient
import cn.yimakeji.opero.push.PushService
import cn.yimakeji.opero.ui.login.LoginScreen
import cn.yimakeji.opero.ui.theme.OperoTheme
import cn.yimakeji.opero.update.Updater
import cn.yimakeji.opero.web.WebEnv
import cn.yimakeji.opero.web.WebPage
import cn.yimakeji.opero.web.WebScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Opero App 唯一的 Activity。界面用网页的手机版（和网页一模一样，网页更新 App 里马上就有），原生只做网页做不了的
 * （docs/规范/App外壳.md）：
 *   - 没登录 → 原生登录页（ui/login：地址 → 账号密码 / 配对码 → 两步验证）
 *   - 登录了 → 整页网页（web/WebPage.kt：用票免登录打开）
 *   - 被断开（任何接口 401 DEVICE）→ 回登录页并说明；连不上 → 出错页（重试 / 退出登录）
 * 外壳能力（[WebEnv]）：常驻推送、点通知直达会话、指纹验证本人 / 解锁、语音识别、选文件、麦克风、下载存到手机、系统分享、外链、App 内更新。
 * 以前做的原生会话列表 / 聊天在 code/android/native-ui/（不参与编译，以后某一页要换原生时再拿回来）。
 */
class MainActivity : FragmentActivity(), WebEnv {
    private lateinit var root: FrameLayout
    private var lockView: View? = null

    private var loggedIn by mutableStateOf(false)
    private var notice by mutableStateOf<String?>(null)
    private var dark by mutableStateOf(false)
    /** 登录后的整页网页；退出登录时销毁 */
    private var page by mutableStateOf<WebPage?>(null)
    /** 点通知带进来、网页还没开好时先记着 */
    private var pendingRoute: String? = null

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingMic: PermissionRequest? = null
    private var voiceDone: ((String, String?) -> Unit)? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }
    /** 安卓 9 及以下存文件：让用户选存哪（不用存储权限） */
    private var pendingSave: ByteArray? = null
    private val createDoc = registerForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        val bytes = pendingSave
        pendingSave = null
        if (uri == null || bytes == null) return@registerForActivityResult
        lifecycleScope.launch {
            val ok = try { withContext(Dispatchers.IO) { contentResolver.openOutputStream(uri)?.use { it.write(bytes) } != null } } catch (_: Exception) { false }
            toast(if (ok) t("已保存") else t("保存失败"))
        }
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

    private val webNav = object : WebPage.Nav {
        // 整页网页自己管页面，用不到；网页要是调了就交给它自己打开
        override fun open(route: String) { page?.openRoute(route) }
        override fun close(key: String) { }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        OperoApp.ensureStore(this)
        loggedIn = Api.store.loggedIn
        dark = Api.store.dark
        bars(dark)
        Notifier.ensureChannels(this)
        handle(intent)
        if (loggedIn) openPage()
        buildViews()
        if (savedInstanceState == null) AppLock.onColdStart()
        lifecycleScope.launch { AppLock.locked.collect { showLock(it) } }
        lifecycleScope.launch { Api.signedOut.collect { signedOut(it) } }
        // 返回键：网页能退就退一层（聊天 → 会话列表、关面板、关弹层），退到底了回桌面
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val p = page
                if (!loggedIn || p == null) { moveTaskToBack(true); return }
                p.back { went -> if (!went) moveTaskToBack(true) }
            }
        })
        if (loggedIn) { PushService.start(this); checkUpdate() }
    }

    override fun onStart() { super.onStart(); AppLock.onStart() }
    override fun onStop() { super.onStop(); AppLock.onStop() }
    override fun onResume() {
        super.onResume()
        // 开了指纹解锁：最近任务里不显示内容（安卓 13+）
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!Api.store.lockOn)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handle(intent) }
    override fun onDestroy() { page?.destroy(); super.onDestroy() }

    // ───── 界面 ─────

    private fun buildViews() {
        root = FrameLayout(this)
        val compose = ComposeView(this).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                // 登录页跟手机的深浅色；登录后跟网页报过来的（Opero 设置的风格）
                val d = if (loggedIn) dark else isSystemInDarkTheme()
                OperoTheme(dark = d) {
                    val p = page
                    if (!loggedIn || p == null) LoginScreen(notice, onDone = { onLoggedIn() })
                    else key(p) { WebScreen(p, d, this@MainActivity) } // 重新登录是新的一页：重建 WebView
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
        root.setBackgroundColor(Color.parseColor(if (dark) "#171A23" else "#FFFFFF"))
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

    /** 整页网页：用票打开，点通知带进来的会话一起交给它 */
    private fun openPage() {
        page?.destroy()
        page = WebPage("main", pendingRoute ?: "", embed = false, env = this, nav = webNav)
        pendingRoute = null
    }

    /** 登录好了：要通知权限、开常驻连接、打开网页 */
    private fun onLoggedIn() {
        notice = null
        openPage()
        loggedIn = true
        if (Build.VERSION.SDK_INT >= 33) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
        lifecycleScope.launch { try { PushClient.register() } catch (_: Exception) { } }
        PushService.start(this)
        checkUpdate()
    }

    private fun closePage() {
        page?.destroy()
        page = null
        CookieManager.getInstance().removeAllCookies(null)
    }

    /** 被断开（401 DEVICE，Api 已经清掉令牌）：网页的登录也清掉，回登录页 */
    private fun signedOut(msg: String) {
        PushService.stop(this)
        closePage()
        notice = msg
        loggedIn = false
    }

    override fun logout() {
        lifecycleScope.launch {
            Account.logout()
            PushService.stop(this@MainActivity)
            closePage()
            notice = null
            loggedIn = false
        }
    }

    /** 点通知打开（operoapp://open?route=chat/<会话> 或通知带的 route）：交给网页打开那个会话 */
    private fun handle(i: Intent?) {
        if (i == null) return
        val route = i.getStringExtra(Notifier.EXTRA_ROUTE) ?: i.data?.takeIf { it.scheme == "operoapp" }?.getQueryParameter("route")
        i.removeExtra(Notifier.EXTRA_ROUTE); i.data = null
        if (route == null || !Regex("^[\\w/?=&;.-]{1,160}$").matches(route) || !Api.store.loggedIn) return
        val p = page
        if (p != null) p.openRoute(route) else pendingRoute = route
    }

    // ───── WebEnv ─────

    override fun toast(msg: String) { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }

    override fun verify(title: String, subtitle: String?, done: (Boolean) -> Unit) {
        AppLock.verify(this, title, subtitle,
            onOk = {
                lifecycleScope.launch {
                    val ok = try { Api.post("/api/app/verified"); true } catch (_: Exception) { false }
                    if (!ok) toast(t("验证失败"))
                    done(ok)
                }
            },
            onFail = { err -> if (err != null) toast(err); done(false) })
    }

    override fun openExternal(url: String) {
        try { AppLock.skipNext(); startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
    }

    override fun saveFile(name: String, bytes: ByteArray, mime: String) {
        val safe = name.replace(Regex("[/\\\\:*?\"<>|]"), "_").ifBlank { "file" }
        if (Build.VERSION.SDK_INT < 29) {
            pendingSave = bytes
            AppLock.skipNext()
            try { createDoc.launch(safe) } catch (_: Exception) { pendingSave = null; toast(t("保存失败")) }
            return
        }
        val image = mime.startsWith("image/")
        lifecycleScope.launch {
            val ok = try {
                withContext(Dispatchers.IO) {
                    val values = ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, safe)
                        put(MediaStore.MediaColumns.MIME_TYPE, mime)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, (if (image) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS) + "/Opero")
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                    val coll = if (image) MediaStore.Images.Media.EXTERNAL_CONTENT_URI else MediaStore.Downloads.EXTERNAL_CONTENT_URI
                    val uri = contentResolver.insert(coll, values) ?: return@withContext false
                    contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    contentResolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                    true
                }
            } catch (_: Exception) { false }
            toast(if (!ok) t("保存失败") else if (image) t("已存到相册") else t("已存到「下载」"))
        }
    }

    override fun shareFile(name: String, bytes: ByteArray, mime: String) {
        lifecycleScope.launch {
            try {
                val f = withContext(Dispatchers.IO) {
                    val dir = File(cacheDir, "open").apply { mkdirs() }
                    File(dir, name.replace(Regex("[/\\\\]"), "_").ifBlank { "file" }).apply { writeBytes(bytes) }
                }
                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                val send = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                AppLock.skipNext()
                startActivity(Intent.createChooser(send, name))
            } catch (_: Exception) {
                toast(t("分享没成功"))
            }
        }
    }

    override fun haptic() { window.decorView.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS) }

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

    /** 状态栏 / 导航栏跟着网页的深浅色（网页按 Opero 设置的风格报过来） */
    override fun setBars(dark: Boolean) {
        if (this.dark == dark) return
        this.dark = dark
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
