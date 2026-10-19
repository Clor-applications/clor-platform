package `in`.clor.attendance

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.Reminders
import `in`.clor.attendance.data.Session
import `in`.clor.attendance.ui.ClorApp
import `in`.clor.attendance.ui.ClorTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val session = Session(applicationContext)
        val api = Api(session)
        Reminders.channel(applicationContext)
        if (session.signedIn()) Reminders.start(applicationContext)
        setContent { ClorTheme { ClorApp(api, session) } }
    }
}
