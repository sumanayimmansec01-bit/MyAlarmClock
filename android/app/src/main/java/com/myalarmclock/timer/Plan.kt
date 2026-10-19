package com.myalarmclock.timer

/** Pure timing rules, kept free of Android classes so they can be unit tested. */
object Plan {
    data class Step(val idx: Int, val endAt: Long, val finished: Boolean)

    /**
     * Where the timer stands at [now], given that round [idx] was due to end at [endAt].
     * Rounds that also ended while the phone could not react are skipped over,
     * so a late alarm still rings only once.
     */
    fun afterRoundEnd(rounds: List<Int>, idx: Int, endAt: Long, now: Long): Step {
        var i = idx
        var end = endAt
        while (i + 1 < rounds.size && end + rounds[i + 1] * 1000L <= now) {
            i++
            end += rounds[i] * 1000L
        }
        return if (i + 1 >= rounds.size) Step(i, end, true)
        else Step(i + 1, end + rounds[i + 1] * 1000L, false)
    }

    /** "30" → 1800, "1.5" → 90, "2:05" → 125; null when the entry is not a valid length. */
    fun parseEntry(text: String): Int? {
        val s = text.trim()
        Regex("""^(\d{1,3}):(\d{1,2})$""").matchEntire(s)?.let {
            val m = it.groupValues[1].toInt()
            val sec = it.groupValues[2].toInt()
            val total = m * 60 + sec
            return if (sec < 60 && total > 0) total else null
        }
        if (Regex("""^\d+(\.\d+)?$""").matches(s)) {
            val total = Math.round(s.toDouble() * 60).toInt()
            return if (total in 1..24 * 3600) total else null
        }
        return null
    }

    /** "40, 40 40" → [2400, 2400, 2400]; null if any entry is invalid or nothing was typed. */
    fun parseList(text: String): List<Int>? {
        val parts = text.split(Regex("""[,\s]+""")).filter { it.isNotBlank() }
        if (parts.isEmpty()) return null
        val values = parts.map { parseEntry(it) ?: return null }
        return values
    }

    fun clock(sec: Long): String {
        val s = maxOf(0L, sec)
        val h = s / 3600
        val m = (s % 3600) / 60
        val r = s % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, r) else "%02d:%02d".format(m, r)
    }

    fun roundLabel(sec: Int): String {
        val m = sec / 60
        val s = sec % 60
        return if (s == 0) "$m นาที" else "%d:%02d นาที".format(m, s)
    }
}
