package `in`.clor.attendance.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import `in`.clor.attendance.MainActivity
import `in`.clor.attendance.R
import java.time.LocalTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Notifications without a push server: every 15 minutes (Android's shortest
 * period for background work) and whenever the app is opened, while signed in
 * and online, the phone asks CLOR how today stands and what changed, and says
 * so when it matters —
 *  - the shift has started and there is no punch (only if phone punching is on);
 *  - the shift ended an hour ago and the last punch is an "in";
 *  - a leave, correction or field punch of mine was decided;
 *  - more is waiting for me to approve than when I last looked.
 * Each is said once (remembered per day / per request). Nothing is sent anywhere.
 */
object Reminders {
    private const val CHANNEL = "attendance"
    private const val WORK = "clor-reminders"

    fun start(context: Context) {
        val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<Check>(15, TimeUnit.MINUTES).setConstraints(online).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
        /* And once now, so opening the app brings news at once. */
        WorkManager.getInstance(context).enqueueUniqueWork("$WORK-now", androidx.work.ExistingWorkPolicy.REPLACE, androidx.work.OneTimeWorkRequestBuilder<Check>().setConstraints(online).build())
    }

    fun stop(context: Context) = WorkManager.getInstance(context).cancelUniqueWork(WORK)

    fun channel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Attendance", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Punch reminders and decisions on your requests" })
        }
    }

    fun allowed(context: Context) =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun show(context: Context, id: Int, title: String, text: String) {
        if (!allowed(context)) return
        channel(context)
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(id, n) }
    }

    class Check(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
        override suspend fun doWork(): Result {
            val session = Session(applicationContext)
            if (!session.signedIn()) return Result.success()
            val api = Api(session)
            val seen = applicationContext.getSharedPreferences("reminders", Context.MODE_PRIVATE)
            return try {
                val me = api.me()
                /* Shift times are India time, whatever zone the phone is set to. */
                val now = LocalTime.now(ZoneId.of("Asia/Kolkata"))
                val shiftDay = !me.shift.off && me.shift.holiday == null && me.shift.startTime.isNotEmpty()
                if (shiftDay && me.phone.allowed) {
                    val start = runCatching { LocalTime.parse(me.shift.startTime) }.getOrNull()
                    val end = runCatching { LocalTime.parse(me.shift.endTime) }.getOrNull()
                    val inKey = "in:${me.today}"
                    if (start != null && me.punches.isEmpty() && now.isAfter(start.minusMinutes(5)) && now.isBefore(start.plusHours(3)) && !seen.contains(inKey)) {
                        show(applicationContext, 1, "Punch in", "Your ${me.shift.name} shift started at ${me.shift.startTime}. You have not punched in yet.")
                        seen.edit().putBoolean(inKey, true).apply()
                    }
                    val outKey = "out:${me.today}"
                    val lastIn = me.punches.lastOrNull()?.kind == "IN"
                    if (end != null && lastIn && end.isAfter(start ?: LocalTime.MIN) && now.isAfter(end.plusHours(1)) && !seen.contains(outKey)) {
                        show(applicationContext, 2, "Punch out", "Your shift ended at ${me.shift.endTime} and your last punch is an in.")
                        seen.edit().putBoolean(outKey, true).apply()
                    }
                }
                /* Decisions on my leave, corrections and field punches: once each. */
                val u = api.updates()
                val first = !seen.getBoolean("primed", false)
                u.decided.forEach { d ->
                    if (!seen.contains(d.key)) {
                        /* The first run only learns what was already decided; it does not announce the past. */
                        if (!first) show(applicationContext, d.key.hashCode(), "Decided", d.text)
                        seen.edit().putBoolean(d.key, true).apply()
                    }
                }
                /* For approvers: say so when more is waiting than last time. */
                val before = seen.getInt("waiting", 0)
                if (!first && u.waitingForMe > before) {
                    show(applicationContext, 3, "Waiting for you", "${u.waitingForMe} request${if (u.waitingForMe == 1) "" else "s"} from your team to approve.")
                }
                seen.edit().putInt("waiting", u.waitingForMe).putBoolean("primed", true).apply()
                Result.success()
            } catch (e: SignedOut) {
                Result.success()
            } catch (e: Exception) {
                Result.retry()
            }
        }
    }
}
