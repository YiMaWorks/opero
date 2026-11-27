package cn.yimakeji.opero

import android.content.Context

/** 系统级的文字（通知渠道名、锁屏这些）：res/values-<语言>/strings.xml，跟手机系统语言；App 界面文字用 i18n/I18n.kt 的 t() */
object Tr {
    lateinit var ctx: Context
    fun s(id: Int, vararg args: Any): String = if (args.isEmpty()) ctx.getString(id) else ctx.getString(id, *args)
}
