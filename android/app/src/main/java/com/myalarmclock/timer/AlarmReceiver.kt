package com.myalarmclock.timer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        when (intent.action) {
            TimerEngine.ACTION_ALARM -> {
                // Keep the CPU awake until the alert sound has finished playing.
                val pending = goAsync()
                val wakeLock = ctx.getSystemService(PowerManager::class.java)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MyAlarmClock:ring")
                    .apply { acquire(9_000) }
                val playMs = try { TimerEngine.onAlarm(ctx) } catch (t: Throwable) { 0L }
                Handler(Looper.getMainLooper()).postDelayed({
                    if (wakeLock.isHeld) wakeLock.release()
                    pending.finish()
                }, minOf(playMs + 500, 8_500))
            }
            TimerEngine.ACTION_PAUSE -> TimerEngine.pause(ctx)
            TimerEngine.ACTION_RESUME -> TimerEngine.resume(ctx)
            TimerEngine.ACTION_RESET -> TimerEngine.reset(ctx)
        }
    }
}
