package `in`.clor.attendance

import `in`.clor.attendance.ui.normalizeTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Times typed on a number pad (no ":" key) still read as times. */
class TimeTest {
    @Test
    fun readsWhatPeopleType() {
        assertEquals("09:10", normalizeTime("9.10"))
        assertEquals("18:10", normalizeTime("18.10"))
        assertEquals("09:10", normalizeTime("9:10"))
        assertEquals("09:10", normalizeTime("910"))
        assertEquals("09:10", normalizeTime("0910"))
        assertEquals("09:00", normalizeTime("9"))
        assertEquals("18:30", normalizeTime(" 18,30 "))
    }

    @Test
    fun refusesWhatIsNotATime() {
        assertNull(normalizeTime(""))
        assertNull(normalizeTime("25:00"))
        assertNull(normalizeTime("9.75"))
        assertNull(normalizeTime("12345"))
        assertNull(normalizeTime("ab"))
    }
}
