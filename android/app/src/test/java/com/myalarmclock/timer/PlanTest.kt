package com.myalarmclock.timer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlanTest {
    private val min = 60_000L
    private val fourForty = List(4) { 2400 }

    @Test fun firstRoundEndsOnTimeStartsSecond() {
        val step = Plan.afterRoundEnd(fourForty, 0, 40 * min, 40 * min)
        assertEquals(Plan.Step(1, 80 * min, false), step)
    }

    @Test fun lastRoundEndFinishes() {
        val step = Plan.afterRoundEnd(fourForty, 3, 160 * min, 160 * min + 300)
        assertEquals(Plan.Step(3, 160 * min, true), step)
    }

    @Test fun lateAlarmSkipsRoundsThatAlreadyEnded() {
        // alarm for round 1 delivered 50 minutes late: round 2 is over too
        val step = Plan.afterRoundEnd(fourForty, 0, 40 * min, 90 * min)
        assertEquals(Plan.Step(2, 120 * min, false), step)
    }

    @Test fun veryLateAlarmFinishesSession() {
        val step = Plan.afterRoundEnd(fourForty, 0, 40 * min, 500 * min)
        assertEquals(Plan.Step(3, 160 * min, true), step)
    }

    @Test fun parsesEntries() {
        assertEquals(2400, Plan.parseEntry("40"))
        assertEquals(90, Plan.parseEntry("1.5"))
        assertEquals(125, Plan.parseEntry("2:05"))
        assertNull(Plan.parseEntry("0"))
        assertNull(Plan.parseEntry("5:75"))
        assertNull(Plan.parseEntry("abc"))
    }

    @Test fun parsesLists() {
        assertEquals(listOf(2400, 2400, 2400, 2400), Plan.parseList("40, 40 40,40"))
        assertNull(Plan.parseList("40, x"))
        assertNull(Plan.parseList("  "))
    }

    @Test fun formats() {
        assertEquals("40:00", Plan.clock(2400))
        assertEquals("2:40:00", Plan.clock(9600))
        assertEquals("00:00", Plan.clock(-5))
        assertEquals("40 นาที", Plan.roundLabel(2400))
        assertEquals("1:30 นาที", Plan.roundLabel(90))
    }
}
