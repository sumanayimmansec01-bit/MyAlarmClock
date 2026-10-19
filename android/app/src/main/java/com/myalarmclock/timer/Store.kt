package com.myalarmclock.timer

import android.content.Context

enum class Status { IDLE, RUNNING, PAUSED, FINISHED }

/** Everything the timer needs survives process death and reboots here. */
class Store(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("timer", Context.MODE_PRIVATE)

    var rounds: List<Int>
        get() = prefs.getString("rounds", null)?.let(::parse) ?: listOf(2400, 2400, 2400, 2400)
        set(v) = prefs.edit().putString("rounds", v.joinToString(",")).apply()

    /** The rounds of the session in progress, frozen when it started. */
    val runRounds: List<Int> get() = parse(prefs.getString("runRounds", "") ?: "")
    val status: Status
        get() = runCatching { Status.valueOf(prefs.getString("status", "IDLE")!!) }.getOrDefault(Status.IDLE)
    val idx: Int get() = prefs.getInt("idx", 0)
    val endAt: Long get() = prefs.getLong("endAt", 0L)
    val remainingMs: Long get() = prefs.getLong("remainingMs", 0L)

    var sound: String
        get() = prefs.getString("sound", "chime")!!.takeIf { it in Sound.NAMES } ?: "chime"
        set(v) = prefs.edit().putString("sound", v).apply()
    var volume: Int
        get() = prefs.getInt("volume", 80)
        set(v) = prefs.edit().putInt("volume", v).apply()
    var vibrate: Boolean
        get() = prefs.getBoolean("vibrate", true)
        set(v) = prefs.edit().putBoolean("vibrate", v).apply()

    /** Running state is written synchronously: the process may be killed right after. */
    fun saveRun(
        status: Status,
        idx: Int = this.idx,
        endAt: Long = this.endAt,
        remainingMs: Long = this.remainingMs,
        runRounds: List<Int> = this.runRounds,
    ) {
        prefs.edit()
            .putString("status", status.name)
            .putInt("idx", idx)
            .putLong("endAt", endAt)
            .putLong("remainingMs", remainingMs)
            .putString("runRounds", runRounds.joinToString(","))
            .commit()
    }

    private fun parse(s: String): List<Int> = s.split(",").mapNotNull { it.trim().toIntOrNull() }.filter { it > 0 }
}
