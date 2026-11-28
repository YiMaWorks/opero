package cn.yimakeji.opero.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.sp
import cn.yimakeji.opero.data.Live
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.chat.ChatScreen
import cn.yimakeji.opero.ui.common.OperoIcons
import cn.yimakeji.opero.ui.sessions.SessionListScreen
import cn.yimakeji.opero.ui.theme.Opero
import cn.yimakeji.opero.web.EmbedView
import cn.yimakeji.opero.web.WebEnv
import cn.yimakeji.opero.web.WebPage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** 底部页签：会话是原生的，其它先嵌网页（根页面名见 code/web/src/App.tsx 的 ROOTS） */
private data class Tab(val id: String, val label: String, val root: String?, val icon: () -> ImageVector)

private val TABS = listOf(
    Tab("chat", "会话", null) { OperoIcons.Chat },
    Tab("people", "员工", "employees") { OperoIcons.People },
    Tab("workspace", "项目", "workspaces") { OperoIcons.Workspace },
    Tab("apps", "应用", "apps") { OperoIcons.Apps },
    Tab("me", "我", "me") { OperoIcons.Me },
)

/** 压在页签上面的一层：原生聊天，或者一个嵌入页 */
sealed interface Screen {
    val key: String
    data class Chat(val sid: String) : Screen { override val key get() = "chat:$sid" }
    data class Web(val page: WebPage) : Screen { override val key get() = page.key }
}

/**
 * 界面的导航（MainActivity 拿着，转屏 / 重组都还在）：当前页签 + 压在上面的一摞（聊天、嵌入页）。
 * 页签根上的嵌入页按页签留着，切走再回来不重新加载。
 */
class Nav(private val env: WebEnv) : WebPage.Nav {
    var tab by mutableStateOf("chat")
    val stack = mutableStateListOf<Screen>()
    private val roots = HashMap<String, WebPage>()
    private var seq = 0
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun root(tab: String): WebPage? {
        val route = TABS.firstOrNull { it.id == tab }?.root ?: return null
        return roots.getOrPut(tab) { WebPage("tab:$tab", route, closable = false, env = env, nav = this) }
    }

    fun openChat(sid: String) {
        stack.removeAll { it is Screen.Chat && it.sid == sid }
        stack.add(Screen.Chat(sid))
    }

    /** 点通知：回到会话页签，打开那个会话 */
    fun openFromPush(sid: String) {
        clearStack()
        tab = "chat"
        openChat(sid)
    }

    /** 打开一个网页页面（route = `页面名;参数=值`）；`chat;emp=<员工>` 开原生聊天 */
    override fun open(route: String) {
        val (page, params) = Routes.parse(route)
        if (page == "chat") {
            val emp = params["emp"]
            val sid = params["sid"] ?: params["id"]
            when {
                sid != null -> openChat(sid)
                emp != null -> scope.launch { Live.sessionFor(emp)?.let { openChat(it) } }
            }
            return
        }
        stack.add(Screen.Web(WebPage("web:${seq++}", route, closable = true, env = env, nav = this)))
    }

    override fun close(key: String) {
        val s = stack.firstOrNull { it.key == key } ?: return
        stack.remove(s)
        (s as? Screen.Web)?.page?.destroy()
    }

    fun pop() {
        val s = stack.removeLastOrNull() ?: return
        (s as? Screen.Web)?.page?.destroy()
    }

    private fun clearStack() {
        stack.forEach { (it as? Screen.Web)?.page?.destroy() }
        stack.clear()
    }

    /** 退出登录：全清 */
    fun reset() {
        clearStack()
        roots.values.forEach { it.destroy() }
        roots.clear()
        tab = "chat"
    }

    /** 返回键：最上面一层先退（嵌入页先问网页）；页签根上的嵌入页退到顶 → 回会话页签 */
    fun back() {
        when (val top = stack.lastOrNull()) {
            is Screen.Chat -> pop()
            is Screen.Web -> top.page.back { handled -> if (!handled) close(top.key) }
            null -> root(tab)?.back { handled -> if (!handled) tab = "chat" } ?: run { tab = "chat" }
        }
    }

    val canBack: Boolean get() = stack.isNotEmpty() || tab != "chat"
}

@Composable
fun Home(nav: Nav, env: WebEnv, dark: Boolean) {
    val c = Opero.colors
    BackHandler(enabled = nav.canBack) { nav.back() }
    when (val top = nav.stack.lastOrNull()) {
        is Screen.Chat -> ChatScreen(top.sid, onBack = { nav.pop() }, onOpenRoute = { nav.open(it) }, onOpenChat = { nav.openChat(it) })
        is Screen.Web -> EmbedView(top.page, dark, env)
        null -> Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                val page = nav.root(nav.tab)
                if (page == null) SessionListScreen(onOpen = { nav.openChat(it) }) else EmbedView(page, dark, env)
            }
            NavigationBar(containerColor = c.panel, tonalElevation = androidx.compose.ui.unit.Dp(0f)) {
                for (tab in TABS) {
                    val n = if (tab.id == "chat") Live.unreadTotal else 0
                    NavigationBarItem(
                        selected = nav.tab == tab.id,
                        onClick = { nav.tab = tab.id },
                        icon = {
                            BadgedBox(badge = { if (n > 0) Badge(containerColor = c.danger) { Text(if (n > 99) "99+" else n.toString()) } }) {
                                Icon(tab.icon(), contentDescription = null)
                            }
                        },
                        label = { Text(t(tab.label), fontSize = 11.sp) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = c.primary, selectedTextColor = c.primary, indicatorColor = c.primarySoft,
                            unselectedIconColor = c.faint, unselectedTextColor = c.faint,
                        ),
                    )
                }
            }
        }
    }
}
