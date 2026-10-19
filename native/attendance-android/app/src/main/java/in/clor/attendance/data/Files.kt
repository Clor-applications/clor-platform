package `in`.clor.attendance.data

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import java.io.File

/**
 * Saving a document or my-data file to the phone's Downloads, and opening it.
 * Android 10 and later: through MediaStore, no permission needed. Android 8–9:
 * the storage permission (asked first) and a FileProvider link to open it.
 */
object Files {
    fun bytesOfDataUrl(dataUrl: String): ByteArray = Base64.decode(dataUrl.substringAfter(","), Base64.DEFAULT)

    fun safeName(title: String, mime: String): String {
        val base = title.replace(Regex("[^A-Za-z0-9._ -]"), "_").trim().ifEmpty { "document" }.take(80)
        val ext = when (mime) {
            "application/pdf" -> ".pdf"
            "image/jpeg" -> ".jpg"
            "image/png" -> ".png"
            "application/json" -> ".json"
            else -> ""
        }
        return if (ext.isNotEmpty() && !base.lowercase().endsWith(ext)) base + ext else base
    }

    /** Writes to Downloads; returns a link another app can open. */
    fun saveToDownloads(context: Context, name: String, mime: String, bytes: ByteArray): Uri {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("Could not save to Downloads.")
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("Could not save to Downloads.")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            return uri
        }
        @Suppress("DEPRECATION")
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).apply { mkdirs() }
        val file = File(dir, name)
        file.writeBytes(bytes)
        return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }

    fun open(context: Context, uri: Uri, mime: String) {
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}
