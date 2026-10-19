package `in`.clor.attendance.data

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/**
 * One fresh, precise position, read at the moment of a punch and never kept by
 * the phone. The caller has the location permission already.
 */
object Locator {
    @SuppressLint("MissingPermission")
    suspend fun current(context: Context): Location? {
        val client = LocationServices.getFusedLocationProviderClient(context)
        val cancel = CancellationTokenSource()
        return withTimeoutOrNull(20_000) {
            client.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancel.token).await()
        }.also { if (it == null) cancel.cancel() }
    }
}
