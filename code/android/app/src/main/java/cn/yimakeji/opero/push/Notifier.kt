package cn.yimakeji.opero.push

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.AudioAttributes
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import cn.yimakeji.opero.MainActivity
import cn.yimakeji.opero.R
import cn.yimakeji.opero.data.Api

/**
 * 通知栏（类别按 Opero 的「少红点」规则收成 3 种）：
 *   decide 要你决定（卡片等你点、危险操作要你确认）= 高优先级，横幅 + 声音
 *   alarm  严重告警（生产挂了）= 闹钟铃声、长震、一直响到你点「我知道了」
 *   info   知道就行（做完了、设成「每条都提醒」的员工的消息）= 普通
 *   哪个员工推什么由后台按员工的「提醒」设置定（只提醒要我决定的 / 每条 / 不提醒），外壳只管怎么响
 */
object Notifier {
    const val CH_DECIDE = "opero_decide"
    const val CH_ALARM = "opero_alarm"
    const val CH_INFO = "opero_info"
    const val CH_SERVICE = "opero_service"
    const val SERVICE_ID = 1
    const val EXTRA_ROUTE = "route"

    private const val BRAND = "#5B4FE9"
    private const val RED = "#E5484D"

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val note = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        val alarm = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        nm.createNotificationChannels(listOf(
            NotificationChannel(CH_DECIDE, "要你决定", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "员工等你点卡片、危险操作要你确认"
                enableVibration(true); vibrationPattern = longArrayOf(0, 250, 150, 250)
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), note)
            },
            NotificationChannel(CH_ALARM, "严重告警", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "生产出大问题：一直响到你点「我知道了」"
                enableVibration(true); vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 600)
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarm)
                enableLights(true); lightColor = Color.parseColor(RED)
            },
            NotificationChannel(CH_INFO, "知道就行", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "做完了、你设成「每条都提醒」的员工的消息"
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), note)
            },
            NotificationChannel(CH_SERVICE, "保持连接", NotificationManager.IMPORTANCE_MIN).apply {
                description = "和你的 Opero 保持连接（这一条常驻，可以在系统设置里折叠）"; setShowBadge(false)
            },
        ))
    }

    fun canPost(ctx: Context): Boolean =
        NotificationManagerCompat.from(ctx).areNotificationsEnabled() &&
            (android.os.Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

    fun openIntent(ctx: Context, route: String?, requestCode: Int): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            if (route != null) putExtra(EXTRA_ROUTE, route)
        }
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** 同一条不弹两次；告警用告警编号（重复推的覆盖上一条） */
    fun notifyId(p: PushItem): Int = if (p.alarm != null) alarmNotifyId(p.alarm) else ("op" + p.id).hashCode()
    fun alarmNotifyId(alarm: Long): Int = ("opa$alarm").hashCode()

    fun build(ctx: Context, p: PushItem): Notification {
        val ch = when (p.kind) { "alarm" -> CH_ALARM; "decide" -> CH_DECIDE; else -> CH_INFO }
        val nid = notifyId(p)
        val b = NotificationCompat.Builder(ctx, ch)
            .setSmallIcon(R.drawable.ic_stat_opero)
            .setColor(Color.parseColor(if (p.kind == "alarm") RED else BRAND))
            .setContentTitle(p.title)
            .setContentText(p.body?.lineSequence()?.firstOrNull { it.isNotBlank() } ?: "")
            .setStyle(NotificationCompat.BigTextStyle().bigText(p.body ?: ""))
            .setAutoCancel(true)
            .setPriority(if (ch == CH_INFO) NotificationCompat.PRIORITY_DEFAULT else NotificationCompat.PRIORITY_HIGH)
            .setCategory(when (p.kind) { "alarm" -> NotificationCompat.CATEGORY_ALARM; "decide" -> NotificationCompat.CATEGORY_REMINDER; else -> NotificationCompat.CATEGORY_MESSAGE })
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setGroup("opero_${p.kind}")
            .setContentIntent(openIntent(ctx, p.route, nid))
        if (p.alarm != null) b.addAction(0, "我知道了", ActionReceiver.ackIntent(ctx, p.alarm, nid))
        if (p.kind == "decide" && p.route != null) b.addAction(0, "去看看", openIntent(ctx, p.route, nid + 1))
        val n = b.build()
        if (p.kind == "alarm" && p.alarm != null && Api.store.insistent) n.flags = n.flags or Notification.FLAG_INSISTENT
        return n
    }

    /** 弹到通知栏；clear = 已经处理 / 已恢复：把还在响的那条收掉 */
    fun show(ctx: Context, p: PushItem) {
        if (p.kind == "clear") { p.alarm?.let { cancel(ctx, alarmNotifyId(it)) }; return }
        if (p.route != null && p.route == VisibleRoute.route) return // 正开着这个会话，不用再弹
        if (!canPost(ctx)) return
        ensureChannels(ctx)
        try { NotificationManagerCompat.from(ctx).notify(notifyId(p), build(ctx, p)) } catch (_: SecurityException) { }
    }

    fun cancel(ctx: Context, id: Int) { try { NotificationManagerCompat.from(ctx).cancel(id) } catch (_: Exception) { } }

    fun service(ctx: Context, connected: Boolean): Notification {
        ensureChannels(ctx)
        return NotificationCompat.Builder(ctx, CH_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_opero)
            .setColor(Color.parseColor(BRAND))
            .setContentTitle(if (connected) "已连上你的 Opero" else "连接中断，正在重试…")
            .setContentText("要你决定的事、严重告警会第一时间提醒你")
            .setOngoing(true).setSilent(true).setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openIntent(ctx, null, 0))
            .build()
    }
}

/** 正在前台看的会话（网页通过 OperoNative.setRoute 告诉外壳）：推的就是这个会话时不弹 */
object VisibleRoute { @Volatile var route: String? = null }
