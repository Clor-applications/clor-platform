package `in`.clor.attendance

import `in`.clor.attendance.data.Leave
import `in`.clor.attendance.data.Me
import `in`.clor.attendance.data.Month
import `in`.clor.attendance.data.json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The app reads the portal API's answers as the server sends them, with fields it does not know and nulls it does not expect. */
class ModelsTest {
    @Test
    fun readsToday() {
        val me = json.decodeFromString<Me>(
            """{"employee":{"name":"Asha Rao","code":"P101","department":null,"designation":"Weaver","photoUrl":null},
               "company":{"name":"Sundaram Textiles","code":"SUND-C101"},"today":"2026-10-19",
               "shift":{"name":"General","startTime":"09:00","endTime":"18:00","off":false,"holiday":null},
               "record":{"status":"PRESENT","checkInTime":"09:02","checkOutTime":null,"workedMinutes":0,"lateMinutes":2,"somethingNew":1},
               "punches":[{"time":"09:02","kind":"IN","phone":true,"site":"Head office"}],
               "phone":{"allowed":true,"next":"OUT","photoRetentionDays":30,"sites":[{"id":"s1","name":"Head office","latitude":12.9,"longitude":77.6,"radiusMeters":200}]},
               "approver":false,"privacy":{"version":"2026-10-19.abcd1234","read":false}}""",
        )
        assertEquals("Asha Rao", me.employee.name)
        assertEquals("OUT", me.phone.next)
        assertEquals(1, me.punches.size)
        assertFalse(me.privacy!!.read)
        assertNull(me.record!!.checkOutTime)
    }

    @Test
    fun readsAMonthAndLeave() {
        val m = json.decodeFromString<Month>(
            """{"month":"2026-10","days":[{"date":"2026-10-01","status":"PRESENT","checkIn":"09:00","checkOut":"18:00","workedMinutes":480,"lateMinutes":0,"earlyOutMinutes":0,"overtimeMinutes":0}],
               "totals":{"present":1,"halfDay":0,"absent":0,"leave":0,"late":0},
               "corrections":[{"id":"c1","date":"2026-10-02","checkIn":"09:00","checkOut":null,"reason":"Reader down","status":"PENDING","note":null}]}""",
        )
        assertEquals(480, m.days[0].workedMinutes)
        assertEquals("PENDING", m.corrections[0].status)
        val l = json.decodeFromString<Leave>(
            """{"year":2026,"today":"2026-10-19","types":[{"id":"t1","name":"Casual","code":"CL","isPaid":true,"allocated":null,"used":2,"pending":0.5,"available":9.5,"earned":12}],
               "requests":[{"id":"r1","leaveTypeName":"Casual","fromDate":"2026-10-20","toDate":"2026-10-20","days":0.5,"reason":"Doctor","status":"PENDING"}]}""",
        )
        assertEquals(9.5, l.types[0].available!!, 0.0)
        assertTrue(l.requests[0].days < 1)
    }
}
