package com.myalarmclock.timer

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * The timer never relies on the app staying alive. Each round end is an exact
 * system alarm (setAlarmClock), which Android delivers even in Doze, after the
 * app is swiped away, and is re-armed after a reboot by BootReceiver.
 */
object TimerEngine {
    const val ACTION_ALARM = "com.myalarmclock.timer.ALARM"
    const val ACTION_PAUSE = "com.myalarmclock.timer.PAUSE"
    const val ACTION_RESUME = "com.myalarmclock.timer.RESUME"
    const val ACTION_RESET = "com.myalarmclock.timer.RESET"

    /** A round end found this late (e.g. phone was switched off) is passed silently. */
    private const val MAX_LATE_RING_MS = 5 * 60_000L

    fun start(ctx: Context) {
        val s = Store(ctx)
        val rounds = s.rounds
        if (rounds.isEmpty()) return
        val endAt = System.currentTimeMillis() + rounds[0] * 1000L
        s.saveRun(Status.RUNNING, idx = 0, endAt = endAt, remainingMs = 0, runRounds = rounds)
        schedule(ctx, endAt)
        Notifier.show(ctx)
    }

    fun pause(ctx: Context) {
        val s = Store(ctx)
        if (s.status != Status.RUNNING) return
        cancel(ctx)
        s.saveRun(Status.PAUSED, remainingMs = maxOf(0L, s.endAt - System.currentTimeMillis()))
        Notifier.show(ctx)
    }

    fun resume(ctx: Context) {
        val s = Store(ctx)
        if (s.status != Status.PAUSED) return
        val endAt = System.currentTimeMillis() + s.remainingMs
        s.saveRun(Status.RUNNING, endAt = endAt)
        schedule(ctx, endAt)
        Notifier.show(ctx)
    }

    fun reset(ctx: Context) {
        cancel(ctx)
        Store(ctx).saveRun(Status.IDLE, idx = 0, endAt = 0, remainingMs = 0)
        Notifier.clear(ctx)
    }

    /** Called when a round-end alarm fires. Returns how long the alert sound plays, in ms. */
    fun onAlarm(ctx: Context, ringIfLate: Boolean = true): Long {
        val s = Store(ctx)
        if (s.status != Status.RUNNING) return 0
        val now = System.currentTimeMillis()
        if (now < s.endAt - 1000) {
            // Woken early (clock change or a stale alarm): just re-arm.
            schedule(ctx, s.endAt)
            return 0
        }
        val step = Plan.afterRoundEnd(s.runRounds, s.idx, s.endAt, now)
        val lastEnd = if (step.finished) step.endAt else step.endAt - s.runRounds[step.idx] * 1000L
        if (step.finished) {
            s.saveRun(Status.FINISHED, idx = step.idx, endAt = step.endAt)
        } else {
            s.saveRun(Status.RUNNING, idx = step.idx, endAt = step.endAt)
            schedule(ctx, step.endAt)
        }
        Notifier.show(ctx)
        val late = now - lastEnd
        return if (ringIfLate || late <= MAX_LATE_RING_MS) Sound.play(ctx, s.sound, s.volume, s.vibrate) else 0
    }

    /** After a reboot or an app update the system has dropped our alarms; put them back. */
    fun restore(ctx: Context) {
        val s = Store(ctx)
        when (s.status) {
            Status.RUNNING ->
                if (System.currentTimeMillis() >= s.endAt) onAlarm(ctx, ringIfLate = false)
                else { schedule(ctx, s.endAt); Notifier.show(ctx) }
            Status.PAUSED -> Notifier.show(ctx)
            else -> {}
        }
    }

    fun canRingExactly(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < 31) return true
        return ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    }

    private fun schedule(ctx: Context, at: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val pi = alarmIntent(ctx)
        try {
            if (canRingExactly(ctx)) {
                am.setAlarmClock(AlarmManager.AlarmClockInfo(at, Notifier.openApp(ctx)), pi)
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            }
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    private fun cancel(ctx: Context) {
        ctx.getSystemService(AlarmManager::class.java).cancel(alarmIntent(ctx))
    }

    private fun alarmIntent(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, 1,
            Intent(ctx, AlarmReceiver::class.java).setAction(ACTION_ALARM),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun actionIntent(ctx: Context, action: String): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, action.hashCode(),
            Intent(ctx, AlarmReceiver::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
}
