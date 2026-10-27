package `in`.clor.attendance

import `in`.clor.attendance.data.MyDetails
import `in`.clor.attendance.data.PhotoRules
import `in`.clor.attendance.data.changeBody
import `in`.clor.attendance.data.json
import `in`.clor.attendance.data.photoWaiting
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A new photo for My details: made small as the web makes it, and sent the way the web sends it. */
class PhotoTest {
    @Test
    fun aBigPhotoIsScaledSoTheLongerSideIs640() {
        assertEquals(640 to 480, PhotoRules.targetSize(4000, 3000))
        assertEquals(480 to 640, PhotoRules.targetSize(3000, 4000))
        assertEquals(640 to 360, PhotoRules.targetSize(1920, 1080))
        assertEquals(640 to 640, PhotoRules.targetSize(1080, 1080))
        // Rounded as the web's Math.round: 4032 x 3024 → 640 x 480; 1000 x 333 → 640 x 213.
        assertEquals(640 to 480, PhotoRules.targetSize(4032, 3024))
        assertEquals(640 to 213, PhotoRules.targetSize(1000, 333))
    }

    @Test
    fun aSmallPhotoIsNeverEnlarged() {
        assertEquals(320 to 240, PhotoRules.targetSize(320, 240))
        assertEquals(640 to 100, PhotoRules.targetSize(640, 100))
        assertEquals(1 to 1, PhotoRules.targetSize(1, 1))
    }

    @Test
    fun aVeryThinPhotoKeepsAtLeastOnePixel() {
        assertEquals(640 to 1, PhotoRules.targetSize(10000, 2))
    }

    @Test
    fun readingThinsTheBigPictureButNeverBelowTheTarget() {
        assertEquals(4, PhotoRules.sampleSize(4000, 3000)) // 1000 px read, then drawn at 640
        assertEquals(1, PhotoRules.sampleSize(1200, 900)) // half would be 600, under 640
        assertEquals(2, PhotoRules.sampleSize(1280, 960))
        assertEquals(1, PhotoRules.sampleSize(500, 400))
        val s = PhotoRules.sampleSize(4032, 3024)
        assertTrue(4032 / s >= PhotoRules.MAX_SIDE)
    }

    @Test
    fun theRulesMatchTheWebAndTheServer() {
        assertEquals(640, PhotoRules.MAX_SIDE)
        assertEquals(75, PhotoRules.QUALITY)
        assertEquals(300_000, PhotoRules.SERVER_MAX)
    }

    @Test
    fun aPhotoIsAJpegDataUrlUnderTheServerLimit() {
        val url = PhotoRules.dataUrl(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte()))
        assertEquals("data:image/jpeg;base64,/9j/4A==", url)
        assertTrue(Regex("^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$").matches(url))
        assertNull(PhotoRules.problem(url))
        assertEquals("That photo is too large to send. Choose another, or take a new one.", PhotoRules.problem(PhotoRules.PREFIX + "A".repeat(300_000)))
        assertNotNull(PhotoRules.problem(PhotoRules.PREFIX))
        assertNotNull(PhotoRules.problem("data:image/gif;base64,R0lG"))
    }

    @Test
    fun theRequestBodyCarriesThePhotoAsPhotoUrl() {
        val url = "data:image/jpeg;base64,/9j/4A=="
        assertEquals("""{"photoUrl":"$url"}""", changeBody(emptyMap(), url).toString())
        val both = changeBody(mapOf("city" to "Pune", "phone" to ""), url)
        assertEquals(setOf("city", "phone", "photoUrl"), both.keys)
        assertEquals(url, both["photoUrl"]!!.jsonPrimitive.content)
        assertEquals("", both["phone"]!!.jsonPrimitive.content)
        assertEquals("""{"city":"Pune"}""", changeBody(mapOf("city" to "Pune")).toString())
    }

    @Test
    fun anOpenPhotoRequestShowsAsWaitingForHr() {
        val d = json.decodeFromString<MyDetails>(
            """{"fields":{},"hasPhoto":true,"requests":[
               {"id":"a","kind":"PROFILE_CHANGE","status":"APPROVED","statusLabel":"Approved","asked":[{"field":"photoUrl","label":"Photo","value":null}]},
               {"id":"b","kind":"PROFILE_CHANGE","status":"WAITING","statusLabel":"Waiting","asked":[{"field":"city","label":"City","value":"Pune"}]},
               {"id":"c","kind":"PROFILE_CHANGE","status":"WAITING","statusLabel":"Waiting","asked":[{"field":"photoUrl","label":"Photo","value":null}]}
            ]}""",
        )
        assertEquals("c", d.photoWaiting()?.id)
        val decided = d.copy(requests = d.requests.filter { it.id != "c" })
        assertNull(decided.photoWaiting())
        val moreInfo = d.copy(requests = listOf(d.requests[2].copy(status = "MORE_INFO")))
        assertEquals("c", moreInfo.photoWaiting()?.id)
    }
}
