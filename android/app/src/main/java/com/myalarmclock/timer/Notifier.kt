package com.myalarmclock.timer

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The countdown in the notification is drawn by the system (a chronometer),
 * so the app itself does no work while the screen is off.
 */
object Notifier {
    private const val CH_RUNNING = "running"
    private const val CH_DONE = "done"
    private const val ID = 1

    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_RUNNING, "กำลังจับเวลา", NotificationManager.IMPORTANCE_LOW)
                .apply { setShowBadge(false) }
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_DONE, "ครบทุกรอบ", NotificationManager.IMPORTANCE_DEFAULT)
                .apply { setSound(null, null); enableVibration(false) }
        )
    }

    fun openApp(ctx: Context): PendingIntent =
        PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun show(ctx: Context) {
        val s = Store(ctx)
        val total = s.runRounds.size
        val round = "รอบ ${s.idx + 1} จาก $total"
        val n = when (s.status) {
            Status.RUNNING -> builder(ctx, CH_RUNNING)
                .setContentTitle(round)
                .setContentText("ครบรอบนี้ ${clock(s.endAt)}")
                .setWhen(s.endAt)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setOngoing(true)
                .addAction(action(ctx, "หยุดชั่วคราว", TimerEngine.ACTION_PAUSE))
                .build()
            Status.PAUSED -> builder(ctx, CH_RUNNING)
                .setContentTitle("หยุดชั่วคราว • $round")
                .setContentText("เหลือ ${Plan.clock(s.remainingMs / 1000)}")
                .setShowWhen(false)
                .setOngoing(true)
                .addAction(action(ctx, "ทำต่อ", TimerEngine.ACTION_RESUME))
                .addAction(action(ctx, "รีเซ็ต", TimerEngine.ACTION_RESET))
                .build()
            Status.FINISHED -> builder(ctx, CH_DONE)
                .setContentTitle("ครบทุกรอบแล้ว")
                .setContentText("$total รอบ เสร็จเมื่อ ${clock(s.endAt)}")
                .setAutoCancel(true)
                .build()
            Status.IDLE -> { clear(ctx); return }
        }
        post(ctx, n)
    }

    fun clear(ctx: Context) {
        ctx.getSystemService(NotificationManager::class.java).cancel(ID)
    }

    fun canPost(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun post(ctx: Context, n: Notification) {
        if (!canPost(ctx)) return
        channels(ctx)
        try {
            ctx.getSystemService(NotificationManager::class.java).notify(ID, n)
        } catch (e: SecurityException) {
            // Notifications were turned off; the alarm itself still rings.
        }
    }

    private fun builder(ctx: Context, channel: String) =
        Notification.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentIntent(openApp(ctx))
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)

    private fun action(ctx: Context, title: String, action: String) =
        Notification.Action.Builder(
            Icon.createWithResource(ctx, R.drawable.ic_stat), title,
            TimerEngine.actionIntent(ctx, action),
        ).build()

    fun clock(ms: Long): String =
        SimpleDateFormat("HH:mm", Locale("th", "TH")).format(Date(ms)) + " น."
}
