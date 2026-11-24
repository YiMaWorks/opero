package cn.yimakeji.opero

import android.app.Application
import android.content.Context
import cn.yimakeji.opero.data.Api
import cn.yimakeji.opero.data.Store
import cn.yimakeji.opero.push.Notifier
import cn.yimakeji.opero.push.PushService
import cn.yimakeji.opero.push.Watchdog

class OperoApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ensureStore(this)
        Notifier.ensureChannels(this)
        PushService.start(this)
        Watchdog.schedule(this)
    }

    companion object {
        /** 开机广播、通知按钮、看门狗可能比 Application 先跑到：用之前先确保有 */
        fun ensureStore(ctx: Context) {
            Tr.ctx = ctx.applicationContext
            val ready = try { Api.store; true } catch (_: UninitializedPropertyAccessException) { false }
            if (!ready) Api.store = Store(ctx.applicationContext)
        }
    }
}
