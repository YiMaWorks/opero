package cn.yimakeji.opero.push

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import cn.yimakeji.opero.OperoApp
import cn.yimakeji.opero.data.Api
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/** 开机、App 升级后：配对着就把常驻连接拉起来 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val ok = intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED || intent.action == "android.intent.action.QUICKBOOT_POWERON"
        if (!ok) return
        OperoApp.ensureStore(ctx)
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) cn.yimakeji.opero.update.Updater.cleanup(ctx)
        PushService.start(ctx)
        Watchdog.schedule(ctx)
    }
}

/** 通知上的「我知道了」：不打开 App，直接确认严重告警（POST /api/app/alarms/<编号>/ack），停掉铃声 */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != ACTION_ACK) return
        val alarm = intent.getLongExtra(EXTRA_ALARM, 0)
        Notifier.cancel(ctx, intent.getIntExtra(EXTRA_NID, 0))
        if (alarm <= 0) return
        OperoApp.ensureStore(ctx)
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val msg = try { Api.post("/api/app/alarms/$alarm/ack"); "已确认，不会再响" } catch (e: Exception) { "确认失败：${e.message ?: "网络不通"}，打开 App 再试" }
            Handler(Looper.getMainLooper()).post { Toast.makeText(ctx.applicationContext, msg, Toast.LENGTH_SHORT).show() }
            pending.finish()
        }
    }

    companion object {
        const val ACTION_ACK = "cn.yimakeji.opero.ACK_ALARM"
        const val EXTRA_ALARM = "alarm"
        const val EXTRA_NID = "nid"
        fun ackIntent(ctx: Context, alarm: Long, nid: Int): PendingIntent {
            val i = Intent(ctx, ActionReceiver::class.java).setAction(ACTION_ACK).putExtra(EXTRA_ALARM, alarm).putExtra(EXTRA_NID, nid)
            return PendingIntent.getBroadcast(ctx, nid, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }
}

/** 看门狗：每 15 分钟（省电时会推迟）——常驻连接被系统杀了就拉起来，顺便补取漏掉的提醒（后台存 24 小时） */
class Watchdog(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        OperoApp.ensureStore(applicationContext)
        if (!PushService.canRun()) return Result.success()
        if (!PushState.running.value) {
            PushService.start(applicationContext)
            try { PushClient.pollOnce(0).forEach { Notifier.show(applicationContext, it) } } catch (_: Exception) { }
        }
        return Result.success()
    }

    companion object {
        private const val NAME = "opero-push-watchdog"
        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<Watchdog>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            try { WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req) } catch (_: Exception) { }
        }
        fun cancel(ctx: Context) { try { WorkManager.getInstance(ctx).cancelUniqueWork(NAME) } catch (_: Exception) { } }
    }
}
