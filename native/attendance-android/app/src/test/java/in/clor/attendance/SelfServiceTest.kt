package `in`.clor.attendance

import `in`.clor.attendance.data.ApiError
import `in`.clor.attendance.data.AttendanceAsk
import `in`.clor.attendance.data.DetailFields
import `in`.clor.attendance.data.DetailsSaved
import `in`.clor.attendance.data.Kinds
import `in`.clor.attendance.data.LeaveAsk
import `in`.clor.attendance.data.LeavePreview
import `in`.clor.attendance.data.LeaveRequest
import `in`.clor.attendance.data.LeaveSent
import `in`.clor.attendance.data.Me
import `in`.clor.attendance.data.MyDetails
import `in`.clor.attendance.data.MyRequests
import `in`.clor.attendance.data.RequestRules
import `in`.clor.attendance.data.RestrictedHolidays
import `in`.clor.attendance.data.Usage
import `in`.clor.attendance.data.attendanceAsk
import `in`.clor.attendance.data.attendanceAskProblem
import `in`.clor.attendance.data.bodyOf
import `in`.clor.attendance.data.canCancelLeave
import `in`.clor.attendance.data.canShorten
import `in`.clor.attendance.data.dayBefore
import `in`.clor.attendance.data.detailsSavedWords
import `in`.clor.attendance.data.errorWords
import `in`.clor.attendance.data.json
import `in`.clor.attendance.data.previewLines
import `in`.clor.attendance.data.readAnswer
import `in`.clor.attendance.data.requestWords
import `in`.clor.attendance.data.sentWords
import `in`.clor.attendance.data.usageLine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Attendance requests, the leave preview and change, restricted holidays and My details, as the portal sends and takes them. */
class SelfServiceTest {
    @Test
    fun readsRequestRulesAndUsage() {
        val r = json.decodeFromString<RequestRules>(
            """{"month":"2026-10","rules":{"MISSED_PUNCH":{"on":true,"quotaPerMonth":3,"hoursPerMonth":null,"maxMinutes":0,"backDays":30,"approval":null},
               "WFH":{"on":true,"quotaPerMonth":4,"hoursPerMonth":null,"maxMinutes":0,"backDays":7,"approval":"MANAGER"},
               "PERMISSION":{"on":true,"quotaPerMonth":null,"hoursPerMonth":4,"maxMinutes":120,"backDays":7,"approval":null}},
               "kinds":[{"kind":"MISSED_PUNCH","name":"Missed punch"},{"kind":"WFH","name":"Work from home"},{"kind":"PERMISSION","name":"Permission"}],
               "usage":{"WFH":{"kind":"WFH","month":"2026-10","unit":"days","used":2,"pending":1,"quota":4,"left":1},
                        "ON_DUTY":{"kind":"ON_DUTY","month":"2026-10","unit":"days","used":0,"pending":0,"quota":null,"left":null},
                        "PERMISSION":{"kind":"PERMISSION","month":"2026-10","unit":"hours","used":1.5,"pending":0,"quota":4,"left":2.5,"hoursUsed":1.5},
                        "MISSED_PUNCH":{"kind":"MISSED_PUNCH","month":"2026-10","unit":"requests","used":1,"pending":0,"quota":3,"left":2}},
               "reasons":["FORGOT_PUNCH","READER_DOWN","ON_DUTY","WRONG_SHIFT","OTHER"]}""",
        )
        assertEquals(listOf("MISSED_PUNCH", "WFH", "PERMISSION"), r.kinds.map { it.kind })
        assertEquals(120, r.rules["PERMISSION"]!!.maxMinutes)
        assertEquals("Work-from-home days this month: 2 of 4 used, 1 waiting, 1 left.", usageLine(r.usage["WFH"]!!))
        assertEquals("On-duty days this month: 0 used, no limit.", usageLine(r.usage["ON_DUTY"]!!))
        assertEquals("Permission hours this month: 1.5 of 4 used, 2.5 left.", usageLine(r.usage["PERMISSION"]!!))
        assertEquals("Missed-punch requests this month: 1 of 3 used, 2 left.", usageLine(r.usage["MISSED_PUNCH"]!!))
    }

    @Test
    fun anAskCarriesOnlyWhatItsKindTakes() {
        val duty = attendanceAsk(Kinds.ON_DUTY, "2026-10-28", "2026-10-28", "FIRST", " Peenya ", "09:00", "18:00", " Client visit ", "FORGOT_PUNCH")
        assertEquals(AttendanceAsk(kind = "ON_DUTY", date = "2026-10-28", reason = "Client visit", halfDay = "FIRST", place = "Peenya"), duty)
        /* No times, no reason code, no last day the same as the first: the body leaves them out. */
        val body = bodyOf(duty)
        assertEquals(setOf("kind", "date", "reason", "halfDay", "place"), body.keys)

        val wfh = attendanceAsk(Kinds.WFH, "2026-10-28", "2026-10-30", "FIRST", "x", null, null, "Plumber", null)
        assertEquals("2026-10-30", wfh.toDate)
        assertNull("a half day is one day", wfh.halfDay)
        assertNull(wfh.place)

        val missed = attendanceAsk(Kinds.MISSED, "2026-10-20", "2026-10-22", "FIRST", "x", "09:10", null, "Reader down", "READER_DOWN")
        assertNull(missed.toDate)
        assertNull(missed.halfDay)
        assertEquals("09:10", missed.checkIn)
        assertEquals("READER_DOWN", missed.reasonCode)
        assertEquals(setOf("kind", "date", "reason", "checkIn", "reasonCode"), bodyOf(missed).keys)

        val perm = attendanceAsk(Kinds.PERMISSION, "2026-10-28", null, null, null, "15:00", "16:30", "Bank", "OTHER")
        assertNull(perm.reasonCode)
        assertNull(attendanceAskProblem(perm))
    }

    @Test
    fun saysWhatStopsAnAsk() {
        assertEquals("Where will you be? Give the place.", attendanceAskProblem(attendanceAsk(Kinds.ON_DUTY, "2026-10-28", null, null, "  ", null, null, "Visit", null)))
        assertEquals("Give the hours: from and to.", attendanceAskProblem(attendanceAsk(Kinds.PERMISSION, "2026-10-28", null, null, null, "15:00", null, "Bank", null)))
        assertEquals("The end is before the start.", attendanceAskProblem(attendanceAsk(Kinds.PERMISSION, "2026-10-28", null, null, null, "16:00", "15:00", "Bank", null)))
        assertTrue(attendanceAskProblem(attendanceAsk(Kinds.MISSED, "2026-10-28", null, null, null, null, null, "Forgot", null))!!.startsWith("Give the in time"))
        assertEquals("Say why.", attendanceAskProblem(attendanceAsk(Kinds.WFH, "2026-10-28", null, null, null, null, null, "  a ", null)))
        assertNull(attendanceAskProblem(attendanceAsk(Kinds.WFH, "2026-10-28", null, null, null, null, null, "Plumber", null)))
    }

    @Test
    fun readsTheRequestListWithTheNewKinds() {
        val r = json.decodeFromString<MyRequests>(
            """{"requests":[
               {"id":"a1","kind":"request","requestKind":"ON_DUTY","kindName":"On duty","date":"2026-10-28","toDate":"2026-10-29","halfDay":null,"place":"Peenya","minutes":null,
                "checkIn":null,"checkOut":null,"reason":"Client","status":"PENDING","note":null,"createdAt":"2026-10-27T05:00:00.000Z","withHr":false,"canChange":true,"canCancel":true,"steps":[],"next":"Your manager"},
               {"id":"a2","kind":"request","requestKind":"PERMISSION","kindName":"Permission","date":"2026-10-21","toDate":null,"minutes":90,"checkIn":"15:00","checkOut":"16:30",
                "reason":"Bank","status":"APPROVED","createdAt":"2026-10-20T05:00:00.000Z","canChange":false,"canCancel":false},
               {"id":"a3","kind":"correction","requestKind":"MISSED_PUNCH","kindName":"Missed punch","date":"2026-10-20","checkIn":"09:10","checkOut":null,"status":"PENDING","createdAt":"2026-10-20T05:00:00.000Z","canChange":true,"canCancel":true},
               {"id":"a4","kind":"request","requestKind":"WFH","date":"2026-10-30","halfDay":"SECOND","status":"PENDING","createdAt":"2026-10-20T05:00:00.000Z"}],
               "reasons":["FORGOT_PUNCH"]}""",
        )
        val (duty, perm, missed, wfh) = r.requests
        assertTrue(duty.canCancel)
        assertEquals("28 Oct – 29 Oct · Peenya", requestWords(duty))
        assertEquals("21 Oct · 15:00–16:30, 1 hour 30 min", requestWords(perm))
        assertEquals("20 Oct · in 09:10", requestWords(missed))
        assertEquals("30 Oct · second half", requestWords(wfh))
    }

    @Test
    fun readsALeavePreviewAcrossTheYearEnd() {
        val p = json.decodeFromString<LeavePreview>(
            """{"ok":true,"type":{"id":"t1","name":"Casual","isPaid":true,"isPrivate":false,"allowHalfDay":true,"sandwich":false,"negativeDays":0},
               "total":3,"split":true,
               "parts":[{"year":2026,"label":"2026","from":"2026-12-30","to":"2026-12-31","days":2,"balance":{"before":4,"after":2,"negativeDays":0},
                         "dates":[{"date":"2026-12-30","counted":true,"why":null},{"date":"2026-12-31","counted":true,"why":null}]},
                        {"year":2027,"label":"2027","from":"2027-01-01","to":"2027-01-03","days":1,"balance":{"before":12,"after":11,"negativeDays":0},
                         "dates":[{"date":"2027-01-01","counted":true,"why":null},{"date":"2027-01-02","counted":false,"why":"Weekly off"},{"date":"2027-01-03","counted":false,"why":"Holiday: New Year"}]}],
               "problems":[],"reasonNeeded":true}""",
        )
        assertTrue(p.split)
        assertTrue(p.type!!.allowHalfDay)
        val lines = previewLines(p)
        assertEquals("3 days of leave.", lines[0])
        assertTrue(lines[1].contains("saved as two requests"))
        assertEquals("2026: 30 Dec – 31 Dec, 2 days", lines[2])
        assertEquals("2027: 1 Jan – 3 Jan, 1 day", lines[3])
        assertTrue(lines.contains("2 Jan not counted: Weekly off"))
        assertTrue(lines.contains("2027: 11 left after this"))
    }

    @Test
    fun readsAPreviewThatStopsTheRequest() {
        val p = json.decodeFromString<LeavePreview>(
            """{"ok":false,"type":{"id":"t2","name":"Sick","isPaid":true,"isPrivate":true,"allowHalfDay":false},"total":0.5,"split":false,
               "parts":[{"year":2026,"label":"2026","from":"2026-10-28","to":"2026-10-28","days":0.5,"balance":{"before":0,"after":-0.5},"dates":[]}],
               "problems":[{"code":"NO_BALANCE","message":"Only 0 days of Sick are left this year; this is 0.5."}],"reasonNeeded":false}""",
        )
        assertFalse(p.reasonNeeded)
        assertTrue(p.type!!.isPrivate)
        assertEquals("NO_BALANCE", p.problems.single().code)
        assertEquals("Half a day of leave.", previewLines(p).first())
    }

    @Test
    fun aLeaveAskSendsSplitAndEditingOnlyWhenSet() {
        assertEquals(setOf("leaveTypeId", "fromDate", "toDate", "reason"), bodyOf(LeaveAsk("t1", "2026-10-28", "2026-10-28", "Doctor")).keys)
        assertEquals(setOf("leaveTypeId", "fromDate", "toDate", "reason", "split"), bodyOf(LeaveAsk("t1", "2026-12-30", "2027-01-02", "Trip", split = true)).keys)
        /* No reason (a private type, or a preview): left out, and the server takes it as "". */
        assertEquals(setOf("leaveTypeId", "fromDate", "toDate", "halfDay", "editing"), bodyOf(LeaveAsk("t1", "2026-10-28", "2026-10-28", "", "FIRST", editing = "r1")).keys)
    }

    @Test
    fun saysWhatWasSent() {
        val split = json.decodeFromString<LeaveSent>(
            """{"request":{"id":"r1","leaveTypeName":"Casual","fromDate":"2026-12-30","toDate":"2026-12-31","days":2,"status":"PENDING","groupId":"lg_1"},
               "requests":[{"id":"r1","leaveTypeName":"Casual","fromDate":"2026-12-30","toDate":"2026-12-31","days":2,"status":"PENDING","groupId":"lg_1"},
                           {"id":"r2","leaveTypeName":"Casual","fromDate":"2027-01-01","toDate":"2027-01-01","days":1,"status":"PENDING","groupId":"lg_1"}]}""",
        )
        assertEquals(2, split.all.size)
        assertEquals("Asked for 3 days of Casual, as two requests, one per leave year: 30 Dec – 31 Dec, 2 days; 1 Jan, 1 day.", sentWords(split))
        val one = json.decodeFromString<LeaveSent>("""{"request":{"id":"r3","leaveTypeName":"Sick","fromDate":"2026-10-28","toDate":"2026-10-28","days":0.5,"halfDay":"FIRST","status":"APPROVED"}}""")
        assertEquals("Asked for half a day of Sick, approved by the leave rule.", sentWords(one))
        assertEquals("Changed: half a day of Sick. It waits for a decision again.", sentWords(one.copy(request = one.request.copy(status = "PENDING")), changed = true))
    }

    @Test
    fun cameBackEarlyAndCancelFollowTheWeb() {
        val on = LeaveRequest(id = "r", fromDate = "2026-10-26", toDate = "2026-10-30", days = 5.0, status = "APPROVED")
        assertTrue(canShorten(on, "2026-10-27"))
        assertFalse("not started", canShorten(on, "2026-10-25"))
        assertFalse("its last day", canShorten(on, "2026-10-30"))
        assertFalse("a half day", canShorten(on.copy(halfDay = "FIRST"), "2026-10-27"))
        assertFalse("waiting", canShorten(on.copy(status = "PENDING"), "2026-10-27"))
        assertEquals("2026-10-29", dayBefore(on.toDate))
        assertTrue(canCancelLeave(on.copy(status = "PENDING"), "2026-10-27"))
        assertFalse("approved and started", canCancelLeave(on, "2026-10-27"))
        assertTrue("approved, still ahead", canCancelLeave(on, "2026-10-25"))
    }

    @Test
    fun readsRestrictedHolidays() {
        val r = json.decodeFromString<RestrictedHolidays>(
            """{"year":2026,"quota":2,"picked":1,"left":1,"holidays":[{"id":"h1","date":"2026-03-04","name":"Holi","picked":true,"past":true},{"id":"h2","date":"2026-11-15","name":"Guru Nanak Jayanti","picked":false,"past":false}]}""",
        )
        assertEquals(1, r.left)
        assertTrue(r.holidays[0].past)
        assertFalse(r.holidays[1].picked)
    }

    @Test
    fun readsMyDetailsAndSendsOnlyWhatChanged() {
        val d = json.decodeFromString<MyDetails>(
            """{"fields":{"firstName":"Asha","lastName":"Rao","phone":"9800000010","personalEmail":null,"city":"Bengaluru","pincode":"560001","dateOfBirth":"1990-04-21","gender":"FEMALE","maritalStatus":null},
               "labels":{"firstName":"First name","lastName":"Last name","phone":"Phone","personalEmail":"Personal email","city":"City","pincode":"PIN code","dateOfBirth":"Date of birth","gender":"Gender"},
               "hasPhoto":false,"savesAtOnce":["phone","personalEmail","emergencyContactName","emergencyContactPhone","emergencyContactRelation"],"hrDecidesWithinDays":3,
               "terms":{"designation":"Weaver","department":"Looms","hours":"Full-time","manager":"Ravi K","joinedOn":"2024-06-01","probationEndsOn":null,"confirmedOn":"2024-12-01"},
               "requests":[{"id":"q1","kind":"PROFILE_CHANGE","title":"Asha Rao: city change","status":"MORE_INFO","statusLabel":"More information asked for",
                            "asked":[{"field":"city","label":"City","value":"Mysuru"}],"comment":{"text":"Send an address proof.","by":"Meena","at":"2026-10-20T05:00:00Z"},
                            "replies":[],"createdAt":"2026-10-19T05:00:00Z","canReply":true,"canWithdraw":true}],"waiting":[]}""",
        )
        assertTrue(d.rule().startsWith("Phone, personal email and emergency contact save at once."))
        assertEquals("Ravi K", d.terms!!.manager)
        assertTrue(d.requests.single().canReply)
        assertEquals("Female", DetailFields.shown("gender", d.fields["gender"]))
        assertEquals("21 Apr 1990", DetailFields.shown("dateOfBirth", d.fields["dateOfBirth"]))
        assertEquals("—", DetailFields.shown("personalEmail", null))

        val form = DetailFields.ORDER.associateWith { d.fields[it].orEmpty() }.toMutableMap()
        assertTrue("nothing typed, nothing sent", DetailFields.changed(d.fields, form).isEmpty())
        form["phone"] = " 9800000011 "
        form["city"] = "Mysuru"
        form["pincode"] = ""
        assertEquals(mapOf("phone" to "9800000011", "city" to "Mysuru", "pincode" to ""), DetailFields.changed(d.fields, form))

        assertEquals(
            "Saved: phone. Sent to HR: city, pin code. You will see the answer under My requests.",
            detailsSavedWords(json.decodeFromString<DetailsSaved>("""{"saved":["phone"],"requested":["city","pincode"],"request":{"id":"x","status":"WAITING","title":"t"}}"""), d),
        )
        assertEquals("Nothing changed.", detailsSavedWords(json.decodeFromString<DetailsSaved>("""{"saved":[],"requested":null,"request":null}"""), d))
    }

    @Test
    fun anUnreadableAnswerIsAPlainErrorNotACrash() {
        try {
            readAnswer<Me>("<html>Bad gateway</html>")
            fail("should not read")
        } catch (e: ApiError) {
            assertEquals("BAD_ANSWER", e.code)
            assertTrue(e.message!!.contains("could not read"))
        }
        assertEquals("The end is before the start." to "BAD_DATES", errorWords(400, """{"error":"The end is before the start.","code":"BAD_DATES"}"""))
        assertEquals("CLOR could not answer just now (502). Try again in a moment." to null, errorWords(502, "<html>Bad gateway</html>"))
        assertEquals("Something went wrong (404)." to null, errorWords(404, ""))
        assertEquals(Usage(kind = "WFH"), readAnswer<Usage>("""{"kind":"WFH","somethingNew":true}"""))
    }
}
