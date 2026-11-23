package cn.yimakeji.opero.push

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import cn.yimakeji.opero.data.Api
import cn.yimakeji.opero.data.ApiError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * 常驻连接：前台服务里一直长轮询（没新的就等 25 秒），有提醒马上弹。
 * 断网 / 出错按 2、4、8…60 秒重试，网络恢复马上重连；设备令牌被作废（401）就停。
 * 开机（BootReceiver）、打开 App、看门狗（Watchdog，每 15 分钟）都会把它拉起来。
 */
class PushService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    private val netUp = Channel<Unit>(Channel.CONFLATED)
    private var netCb: ConnectivityManager.NetworkCallback? = null
    private var shownConnected: Boolean? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        goForeground(false)
        PushState.running.value = true
        try {
            val cm = getSystemService(ConnectivityManager::class.java)
            netCb = object : ConnectivityManager.NetworkCallback() { override fun onAvailable(network: Network) { netUp.trySend(Unit) } }
            cm.registerDefaultNetworkCallback(netCb!!)
        } catch (_: Exception) { }
    }

    private fun goForeground(connected: Boolean) {
        if (shownConnected == connected) return
        shownConnected = connected
        val n = Notifier.service(this, connected)
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(Notifier.SERVICE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(Notifier.SERVICE_ID, n)
        } catch (_: Exception) {
            stopSelf() // 后台不让起前台服务（安卓 12+）：等用户打开 App 再拉起
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!canRun()) { stopSelf(); return START_NOT_STICKY }
        if (job?.isActive != true) job = scope.launch { loop() }
        return START_STICKY
    }

    private suspend fun loop() {
        var backoff = 2_000L
        var registered = false
        while (scope.isActive) {
            if (!canRun()) break
            try {
                if (!registered) { PushClient.register(); registered = true }
                val items = PushClient.pollOnce(25)
                goForeground(true)
                items.forEach { Notifier.show(this, it) }
                backoff = 2_000L
            } catch (e: Exception) {
                PushState.connected.value = false
                PushState.lastError.value = e.message
                goForeground(false)
                if (e is ApiError && e.status == 401) { Api.store.clearPairing(); break } // 网页里把这台手机断开了
                withTimeoutOrNull(backoff) { netUp.receive() }
                backoff = (backoff * 2).coerceAtMost(60_000L)
            }
        }
        stopSelf()
    }

    override fun onDestroy() {
        PushState.running.value = false
        PushState.connected.value = false
        try { netCb?.let { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } } catch (_: Exception) { }
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        fun canRun(): Boolean = try { Api.store.deviceToken != null && Api.store.pushEnabled } catch (_: Exception) { false }

        fun start(ctx: Context) {
            if (!canRun()) return
            try { ContextCompat.startForegroundService(ctx, Intent(ctx, PushService::class.java)) } catch (_: Exception) { }
        }
        fun stop(ctx: Context) {
            try { ctx.stopService(Intent(ctx, PushService::class.java)) } catch (_: Exception) { }
            NotificationManagerCompat.from(ctx).cancel(Notifier.SERVICE_ID)
        }
    }
}
