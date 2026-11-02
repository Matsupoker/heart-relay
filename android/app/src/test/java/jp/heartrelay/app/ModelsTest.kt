package jp.heartrelay.app

import org.junit.Assert.*
import org.junit.Test

class ModelsTest {
    private val staffJson = """[
      {"id":"s01","name":"山田 太郎","role":"看護師","duties":["バイタル測定","入浴前チェック"],"active":true},
      {"id":"s02","name":"佐藤 花子","role":"運転手","duties":[],"active":false}
    ]"""

    private fun dj(id: String, created: String, ack: String? = null) = """{
      "id":"$id","message_id":"m1","staff_id":"s01","staff_name":"山田 太郎","staff_role":"看護師",
      "title":"T$id","body":"本文","action_required":"対応","reason":"理由","urgency":"high",
      "categories":["受診","送迎"],"created_at":"$created",
      "acknowledged_at":${if (ack == null) "null" else "\"$ack\""}}"""

    @Test fun parsesStaff() {
        val list = Json.staffList(staffJson)
        assertEquals(2, list.size)
        assertEquals("山田 太郎", list[0].name)
        assertEquals("看護師", list[0].role)
        assertEquals(listOf("バイタル測定", "入浴前チェック"), list[0].duties)
        assertFalse(list[1].active)
    }

    @Test fun parsesDelivery() {
        val d = Json.deliveryList("[${dj("d1", "2026-11-03T01:30:00.000Z")}]")[0]
        assertEquals("d1", d.id)
        assertEquals("high", d.urgency)
        assertEquals(listOf("受診", "送迎"), d.categories)
        assertNull(d.acknowledgedAt)
        assertFalse(d.isAcknowledged)
    }

    @Test fun parsesAckedDeliveryAndHealth() {
        val d = Json.deliveryList("[${dj("d1", "2026-11-03T01:30:00Z", "2026-11-03T02:05:00Z")}]")[0]
        assertTrue(d.isAcknowledged)
        assertEquals("11:05", TimeFmt.hhmm(d.acknowledgedAt))
        val h = Json.health("""{"ok":true,"analyzer":"mock","model":null,"time":"2026-11-03T00:00:00Z"}""")
        assertTrue(h.ok); assertEquals("mock", h.analyzer); assertNull(h.model)
    }

    @Test fun jstFormatting() {
        assertEquals("10:30", TimeFmt.hhmm("2026-11-03T01:30:00Z"))
        assertEquals("00:05", TimeFmt.hhmm("2026-11-02T15:05:00+00:00"))
        assertEquals("09:00", TimeFmt.hhmm("2026-11-03T09:00:00+09:00"))
        assertEquals("--:--", TimeFmt.hhmm("garbage"))
        assertEquals("--:--", TimeFmt.hhmm(null))
    }

    @Test fun errorMessage() {
        assertEquals("forbidden", Json.errorMessage("""{"error":"forbidden","code":"X"}"""))
        assertNull(Json.errorMessage("<html>"))
    }

    @Test fun sortUnackedFirstThenNewest() {
        val list = Json.deliveryList("[" + listOf(
            dj("a", "2026-11-03T01:00:00Z", "2026-11-03T01:10:00Z"),
            dj("b", "2026-11-03T02:00:00Z"),
            dj("c", "2026-11-03T03:00:00Z", "2026-11-03T03:05:00Z"),
            dj("d", "2026-11-03T01:30:00Z"),
        ).joinToString(",") + "]")
        assertEquals(listOf("b", "d", "c", "a"), DeliveryLogic.sortInbox(list).map { it.id })
    }

    @Test fun newUnseenOnlyUnackedAndUnseen() {
        val list = Json.deliveryList("[" + listOf(
            dj("a", "2026-11-03T01:00:00Z"),
            dj("b", "2026-11-03T02:00:00Z"),
            dj("c", "2026-11-03T03:00:00Z", "2026-11-03T03:05:00Z"),
        ).joinToString(",") + "]")
        assertEquals(listOf("b"), DeliveryLogic.newUnseen(list, setOf("a")).map { it.id })
        assertEquals(listOf("a", "b"), DeliveryLogic.newUnseen(list, emptySet()).map { it.id })
        assertTrue(DeliveryLogic.newUnseen(list, setOf("a", "b", "c")).isEmpty())
    }
}
