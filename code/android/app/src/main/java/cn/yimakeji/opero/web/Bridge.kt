package cn.yimakeji.opero.web

import android.webkit.JavascriptInterface
import cn.yimakeji.opero.BuildConfig
import cn.yimakeji.opero.data.Api
import org.json.JSONObject

/**
 * 网页调外壳：window.OperoNative.<方法>（协议见 docs/规范/App外壳.md 第 2 节、docs/api/README.md「嵌网页」，网页那边是 code/web/src/native.ts）。
 * 每个嵌入的网页一个 Bridge；这些方法在 WebView 的后台线程里被调，Host 负责切到主线程。
 * 只给自己那套 Opero 的页面用：别的网站的链接都交给系统浏览器打开，进不了这个 WebView。
 */
open class Bridge(protected val host: Host) {
    interface Host {
        /** 当前页面是不是自己那套 Opero */
        fun trusted(): Boolean
        fun verify(id: String, title: String, subtitle: String)
        fun setTheme(dark: Boolean)
        fun setBars(dark: Boolean, bg: Int, panel: Int)
        fun openExternal(url: String)
        fun haptic()
        fun unpair()
        fun relogin()
        fun shellChanged()
        /** 系统语音输入，结果回 window.__operoNative.onVoice(text) */
        fun voice(lang: String)
        /** 嵌入页里点到别的页面：有原生页开原生页（chat;emp=…），没有就再开一层嵌入页 */
        fun open(route: String)
        /** 嵌入页最外层点了关闭：退回 App 上一层 */
        fun close()
        /** 把文件存到手机（图片进相册，别的进「下载」） */
        fun download(url: String, name: String)
        /** 把文件交给系统分享 */
        fun share(url: String, name: String)
    }

    @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface fun verify(id: String, title: String, subtitle: String) { if (host.trusted()) host.verify(id, title, subtitle) }

    @JavascriptInterface fun setTheme(dark: Boolean) { if (host.trusted()) host.setTheme(dark) }

    /** 网页的风格：状态栏 / 底色跟着变；颜色是 #RRGGBB */
    @JavascriptInterface fun setBars(dark: Boolean, bg: String, panel: String) {
        if (!host.trusted()) return
        val re = Regex("^#[0-9A-Fa-f]{6}$")
        if (!re.matches(bg) || !re.matches(panel)) { host.setTheme(dark); return }
        host.setBars(dark, android.graphics.Color.parseColor(bg), android.graphics.Color.parseColor(panel))
    }

    /** 角标：安卓桌面跟着通知走，不用单独设（网页会调，留着不报错） */
    @JavascriptInterface fun setBadge(n: Int) { }

    @JavascriptInterface fun openExternal(url: String) { if (host.trusted() && (url.startsWith("http") || url.startsWith("mailto:") || url.startsWith("tg:") || url.startsWith("slack:"))) host.openExternal(url) }

    @JavascriptInterface fun haptic() { host.haptic() }

    @JavascriptInterface fun voice(lang: String) { if (host.trusted()) host.voice(lang) }

    /** 网页正在看的会话（chat/<编号>）：推送的就是它时不弹通知 */
    @JavascriptInterface fun setRoute(route: String?) { cn.yimakeji.opero.push.VisibleRoute.route = route?.ifBlank { null } }

    /** 下载：url 是文件地址（相对 / 绝对 / data:），name 是文件名；外壳带登录取下来存到手机 */
    @JavascriptInterface fun download(url: String, name: String) { if (host.trusted() && url.length <= 4_000_000) host.download(url, name) }

    /** 分享：同上，取下来交给系统分享面板（发微信、邮件…） */
    @JavascriptInterface fun share(url: String, name: String) { if (host.trusted() && url.length <= 4_000_000) host.share(url, name) }

    @JavascriptInterface fun unpair() { if (host.trusted()) host.unpair() }

    /** 网页的登录过期了（接口回 401）：用设备令牌重新要一张票再打开（被断开了就回原生登录页） */
    @JavascriptInterface fun relogin() { if (host.trusted()) host.relogin() }

    @JavascriptInterface fun open(route: String) { if (host.trusted() && route.length <= 400) host.open(route) }

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
}

/** 压在上面的嵌入页多一个 close（网页看到有它才显示「关闭」）；页签根上的页面用 [Bridge]，没有关闭 */
class ClosableBridge(host: Bridge.Host) : Bridge(host) {
    @JavascriptInterface fun close() { if (host.trusted()) host.close() }
}
