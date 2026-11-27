package cn.yimakeji.opero.i18n

import android.content.Context
import android.content.res.Resources
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

/**
 * 界面文字：和网页同一份字典（code/web/src/i18n，源文是简体中文），算法照 code/web/src/i18n/index.ts 的 t()。
 *   - 代码里直接写中文原文：t("登录")、t("连不上 {0}：{1}", host, err)。
 *   - 字典 = assets/i18n/web-<语言>.json（编译时从网页拷过来）+ app-<语言>.json（App 自己才有的，code/android/i18n/）。
 *   - 后台发来的中文（报错、卡片上的字）也能 t()：网页字典里大多都有。
 *   - 语言：Opero 设置里选的（settings.lang，所有端一样），没选 / 跟随系统就按手机系统语言。
 *   - 系统级的文字（通知渠道名、开机通知）还在 res/values-* /strings.xml，跟手机系统语言。
 */
object I18n {
    val LANGS = listOf("zh-CN", "zh-TW", "en", "ja", "de", "fr", "ar")

    /** 当前语言（zh-CN 不查字典） */
    var lang: String = "zh-CN"
        private set
    val rtl: Boolean get() = lang == "ar"

    /** 换了语言 +1：Compose 里读过 t() 的地方会跟着重画 */
    var version by mutableIntStateOf(0)
        private set

    private lateinit var app: Context
    private var dict: Map<String, String> = emptyMap()
    private var patterns: List<Pattern> = emptyList()
    private val cache = HashMap<String, String>()
    private val CJK = Regex("[㐀-鿿]")

    private class Pattern(val re: Regex, val order: List<Int>, val out: String)

    fun init(ctx: Context, pref: String?) {
        app = ctx.applicationContext
        use(resolve(pref))
    }

    /** Opero 设置里的语言变了（bootstrap / 实时推送里的 settings.lang） */
    fun setPref(pref: String?) {
        if (!::app.isInitialized) return
        val l = resolve(pref)
        if (l != lang) use(l)
    }

    private fun resolve(pref: String?): String {
        val p = if (pref == "zh") "zh-CN" else pref
        if (p != null && p in LANGS) return p
        return systemLang()
    }

    private fun systemLang(): String {
        val locales = Resources.getSystem().configuration.locales
        for (i in 0 until locales.size()) {
            val tag = locales[i].toLanguageTag().lowercase()
            if (Regex("^zh-(tw|hk|mo)|^zh-hant").containsMatchIn(tag)) return "zh-TW"
            if (tag.startsWith("zh")) return "zh-CN"
            for (c in listOf("en", "ja", "de", "fr", "ar")) if (tag == c || tag.startsWith("$c-")) return c
        }
        return "en"
    }

    @Synchronized private fun use(l: String) {
        val d = HashMap<String, String>()
        if (l != "zh-CN") {
            read("i18n/web-$l.json", d)
            read("i18n/app-$l.json", d)
        }
        dict = d
        patterns = compile(d)
        cache.clear()
        lang = l
        version++
    }

    private fun read(asset: String, into: MutableMap<String, String>) {
        try {
            val text = app.assets.open(asset).use { it.readBytes().toString(Charsets.UTF_8) }
            val o = JSONObject(text)
            for (k in o.keys()) into[k] = o.optString(k)
        } catch (_: Exception) { /* 没有这个文件：缺的句子显示中文原文 */ }
    }

    /** 带 {0} 的原文变成正则：「{0} 分钟前」→ ^(.+?) 分钟前$，原文越长越先对 */
    private fun compile(d: Map<String, String>): List<Pattern> {
        val out = ArrayList<Pattern>()
        val slot = Regex("\\{(\\d+)\\}")
        for ((k, v) in d) {
            if (!slot.containsMatchIn(k)) continue
            val order = ArrayList<Int>()
            val src = StringBuilder("^")
            var last = 0
            for (m in slot.findAll(k)) {
                if (m.range.first > last) src.append(Regex.escape(k.substring(last, m.range.first)))
                src.append("([\\s\\S]+?)")
                order.add(m.groupValues[1].toInt())
                last = m.range.last + 1
            }
            if (last < k.length) src.append(Regex.escape(k.substring(last)))
            src.append("$")
            try { out.add(Pattern(Regex(src.toString()), order, v)) } catch (_: Exception) { }
        }
        out.sortByDescending { it.re.pattern.length }
        return out
    }

    /** 一段中文换成当前语言；不认识的原样返回 */
    fun tr(src: String): String {
        if (lang == "zh-CN" || src.isEmpty() || !CJK.containsMatchIn(src)) return src
        synchronized(this) { cache[src]?.let { return it } }
        val lead = src.takeWhile { it.isWhitespace() }
        val trail = src.takeLastWhile { it.isWhitespace() }
        val core = src.trim()
        var out = dict[core]
        if (out == null) {
            for (p in patterns) {
                val m = p.re.matchEntire(core) ?: continue
                val vals = HashMap<Int, String>()
                p.order.forEachIndexed { i, n -> vals[n] = tr(m.groupValues[i + 1]) }
                out = p.out.replace(Regex("\\{(\\d+)\\}")) { r -> vals[r.groupValues[1].toInt()] ?: "" }
                break
            }
        }
        val res = if (out == null) src else lead + out + trail
        synchronized(this) {
            if (cache.size > 5000) cache.clear()
            cache[src] = res
        }
        return res
    }
}

/**
 * 界面文字：t("连不上 {0}：{1}", host, err)。先按原文（带 {0}）查字典，再把变量填进去。
 * 在 Compose 里调会订阅语言变化（读了 I18n.version）。
 */
fun t(src: String, vararg args: Any?): String {
    I18n.version // 读一下：语言变了 Compose 会重画
    val s = I18n.tr(src)
    if (args.isEmpty()) return s
    return s.replace(Regex("\\{(\\d+)\\}")) { m -> args.getOrNull(m.groupValues[1].toInt())?.toString() ?: m.value }
}
