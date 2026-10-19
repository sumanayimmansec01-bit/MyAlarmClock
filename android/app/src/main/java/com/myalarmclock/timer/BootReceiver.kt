package com.myalarmclock.timer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Re-arms a running session after the phone restarts or the app is updated. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        TimerEngine.restore(context.applicationContext)
    }
}
