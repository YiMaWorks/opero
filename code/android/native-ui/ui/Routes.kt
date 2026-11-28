package cn.yimakeji.opero.ui

import android.net.Uri
import cn.yimakeji.opero.data.Employee
import cn.yimakeji.opero.data.Live

/**
 * 网页的页面地址（嵌网页的 route）：`页面名;参数=值;参数=值`，参数值 URL 编码（code/web/src/router.ts 的 seg / unseg）。
 * 页面名见 code/web/src/pages/index.tsx。
 */
object Routes {
    fun seg(page: String, params: Map<String, String?> = emptyMap()): String =
        Uri.encode(page) + params.entries.filter { it.value != null }.joinToString("") { ";${Uri.encode(it.key)}=${Uri.encode(it.value)}" }

    fun parse(route: String): Pair<String, Map<String, String>> {
        val parts = route.split(";")
        val params = parts.drop(1).mapNotNull { p ->
            val i = p.indexOf('=')
            if (i <= 0) null else Uri.decode(p.substring(0, i)) to Uri.decode(p.substring(i + 1))
        }.toMap()
        return Uri.decode(parts.first()) to params
    }

    /** 员工底部菜单 → 页面（code/web/src/menus.ts 的 MENU_REGISTRY；没登记的网页显示「打不开」） */
    fun menu(menu: String, e: Employee): String = when (menu) {
        "问题清单" -> seg("issues")
        "日志扫描" -> seg("triggers")
        "查生产库" -> seg("data")
        "发布记录" -> seg("releases")
        "应用" -> seg("releases", mapOf("tab" to "apps"))
        "改动记录", "预览" -> seg("workspace", mapOf("id" to e.workspace))
        "服务器" -> seg("servers")
        "收件箱" -> seg("inbox")
        "消息渠道" -> seg("channels")
        "知识库" -> seg("knowledge")
        "流程" -> seg("flows")
        "员工" -> seg("employees")
        "设置" -> seg("system")
        "插件" -> seg("plugins")
        else -> seg("placeholder", mapOf("title" to menu))
    }

    /** 菜单上显示的名字：「改动记录」显示成项目名 */
    fun menuLabel(menu: String, e: Employee): String =
        if (menu == "改动记录") Live.workspaceOf(e)?.name ?: menu else menu
}
