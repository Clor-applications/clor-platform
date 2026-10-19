package `in`.clor.attendance

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.Reminders
import `in`.clor.attendance.data.Session
import `in`.clor.attendance.ui.ClorApp
import `in`.clor.attendance.ui.Appearance
import `in`.clor.attendance.ui.ClorTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val session = Session(applicationContext)
        val api = Api(session)
        Reminders.channel(applicationContext)
        if (session.signedIn()) Reminders.start(applicationContext)
        val prefs = getSharedPreferences("display", MODE_PRIVATE)
        setContent {
            var appearance by remember { mutableStateOf(runCatching { Appearance.valueOf(prefs.getString("appearance", "AUTO")!!) }.getOrDefault(Appearance.AUTO)) }
            ClorTheme(appearance) {
                ClorApp(api, session, appearance) { a ->
                    appearance = a
                    prefs.edit().putString("appearance", a.name).apply()
                }
            }
        }
    }
}
