package cn.yimakeji.opero

import android.content.Context

/** 外壳的界面文字：res/values*/strings.xml（跟手机系统语言；网页里的文字跟网页的语言设置） */
object Tr {
    lateinit var ctx: Context
    fun s(id: Int, vararg args: Any): String = if (args.isEmpty()) ctx.getString(id) else ctx.getString(id, *args)
}
