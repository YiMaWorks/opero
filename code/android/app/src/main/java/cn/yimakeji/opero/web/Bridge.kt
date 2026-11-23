package cn.yimakeji.opero.web

import android.webkit.JavascriptInterface
import cn.yimakeji.opero.BuildConfig
import cn.yimakeji.opero.data.Api
import org.json.JSONObject

/**
 * 网页调外壳：window.OperoNative.<方法>（协议见 docs/规范/App外壳.md 第 2 节，网页那边是 code/web/src/native.ts）。
 * 这些方法在 WebView 的后台线程里被调，统一交给 MainActivity 到主线程做。
 * 只给自己那套 Opero 的页面和外壳自带的连接页用：别的网站的链接都交给系统浏览器打开，进不了这个 WebView。
 */
class Bridge(private val host: Host) {
    interface Host {
        /** 当前页面是不是可信的（自己那套 Opero 或外壳自带的页面） */
        fun trusted(): Boolean
        fun verify(id: String, title: String, subtitle: String)
        fun setTheme(dark: Boolean)
        fun setBars(dark: Boolean, bg: Int, panel: Int)
        fun openExternal(url: String)
        fun haptic()
        fun unpair()
        fun relogin()
        fun pair(server: String, code: String)
        fun shellChanged()
    }

    @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface fun verify(id: String, title: String, subtitle: String) { if (host.trusted()) host.verify(id, title, subtitle) }

    @JavascriptInterface fun setTheme(dark: Boolean) { if (host.trusted()) host.setTheme(dark) }

    /** 网页的风格（20 套 + 自己配色）：状态栏 / 导航栏、底色跟着变；颜色是 #RRGGBB */
    @JavascriptInterface fun setBars(dark: Boolean, bg: String, panel: String) {
        if (!host.trusted()) return
        val re = Regex("^#[0-9A-Fa-f]{6}$")
        if (!re.matches(bg) || !re.matches(panel)) { host.setTheme(dark); return }
        host.setBars(dark, android.graphics.Color.parseColor(bg), android.graphics.Color.parseColor(panel))
    }

    /** 安卓桌面角标跟着通知走，这里先记下（以后给支持角标的桌面用） */
    @JavascriptInterface fun setBadge(n: Int) { badge = n }

    @JavascriptInterface fun openExternal(url: String) { if (host.trusted() && (url.startsWith("http") || url.startsWith("mailto:") || url.startsWith("tg:") || url.startsWith("slack:"))) host.openExternal(url) }

    @JavascriptInterface fun haptic() { host.haptic() }

    /** 正在看的会话（chat/<编号>）：推送的就是它时不弹通知 */
    @JavascriptInterface fun setRoute(route: String?) { cn.yimakeji.opero.push.VisibleRoute.route = route?.ifBlank { null } }

    @JavascriptInterface fun unpair() { if (host.trusted()) host.unpair() }

    /** 网页的登录过期了（接口回 401）：外壳用设备令牌重新要一张票再打开 */
    @JavascriptInterface fun relogin() { if (host.trusted()) host.relogin() }

    /** 外壳自带的连接页调：连接你的 Opero（code 是网页「我 → 账号安全 → 接手机」给的配对码，可以不填） */
    @JavascriptInterface fun pair(server: String, code: String) { if (host.trusted()) host.pair(server, code) }

    /** 「这台手机」的设置（网页的设置页在 App 里多一组）：指纹解锁、离开多久要解锁、推送、严重告警一直响 */
    @JavascriptInterface fun getShell(): String {
        val s = Api.store
        return JSONObject().apply {
            put("version", BuildConfig.VERSION_NAME)
            put("server", s.server ?: "")
            put("paired", s.deviceToken != null)
            put("lockOn", s.lockOn)
            put("lockAfter", s.lockAfter)
            put("pushEnabled", s.pushEnabled)
            put("insistent", s.insistent)
        }.toString()
    }

    @JavascriptInterface fun setShell(json: String) {
        if (!host.trusted()) return
        val o = try { JSONObject(json) } catch (_: Exception) { return }
        val s = Api.store
        if (o.has("lockOn")) s.lockOn = o.optBoolean("lockOn")
        if (o.has("lockAfter")) s.lockAfter = o.optInt("lockAfter", 60)
        if (o.has("pushEnabled")) s.pushEnabled = o.optBoolean("pushEnabled")
        if (o.has("insistent")) s.insistent = o.optBoolean("insistent")
        host.shellChanged()
    }

    companion object { @Volatile var badge = 0 }
}
