package `in`.clor.attendance.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.media.ExifInterface
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * A new photo for My details, made small on the phone before it is sent, the
 * same way the web portal makes it (apps/attendance/src/portal/portalApi.js
 * `shrinkPhoto`): the longer side at most 640 px, never enlarged, JPEG at
 * quality 0.75. The server (services/people/selfService.ts) takes a JPEG, PNG
 * or WebP data URL of at most 300 000 characters, and HR decides it.
 */
object PhotoRules {
    const val MAX_SIDE = 640
    const val QUALITY = 75
    /** Tried once more, at the same size, when a busy picture is still over the server's limit. */
    const val FALLBACK_QUALITY = 60
    /** The server's limit on the whole data URL (PHOTO_MAX). */
    const val SERVER_MAX = 300_000
    const val PREFIX = "data:image/jpeg;base64,"

    /** The size the picture is drawn at: scaled so the longer side is at most [maxSide], never up, each side at least 1. */
    fun targetSize(width: Int, height: Int, maxSide: Int = MAX_SIDE): Pair<Int, Int> {
        require(width > 0 && height > 0) { "No picture." }
        val scale = min(1.0, maxSide.toDouble() / max(width, height))
        return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
    }

    /**
     * How much to thin the picture while reading it, so a 12-megapixel camera
     * shot is never held whole in memory: the largest power of two that still
     * leaves the longer side at or above [maxSide].
     */
    fun sampleSize(width: Int, height: Int, maxSide: Int = MAX_SIDE): Int {
        var s = 1
        while (max(width, height) / (s * 2) >= maxSide) s *= 2
        return s
    }

    /** The JPEG as the data URL the web sends. */
    fun dataUrl(jpeg: ByteArray): String = PREFIX + java.util.Base64.getEncoder().encodeToString(jpeg)

    /** What stops the photo being sent, in words, or null. The server checks it again. */
    fun problem(dataUrl: String): String? = when {
        !dataUrl.startsWith(PREFIX) || dataUrl.length <= PREFIX.length -> "That photo could not be read. Choose another."
        dataUrl.length > SERVER_MAX -> "That photo is too large to send. Choose another, or take a new one."
        else -> null
    }

    /** EXIF orientation as the turn and mirror needed to show the picture upright. */
    fun turn(orientation: Int): Pair<Float, Boolean> = when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f to false
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f to false
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f to false
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> 0f to true
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> 180f to true
        ExifInterface.ORIENTATION_TRANSPOSE -> 90f to true
        ExifInterface.ORIENTATION_TRANSVERSE -> 270f to true
        else -> 0f to false
    }
}

class PhotoUnreadable(message: String) : Exception(message)

object Photos {
    /** A fresh file in the app's cache for the camera to write to, and the link the camera app is given. */
    fun cameraTarget(context: Context): Uri {
        val dir = File(context.cacheDir, "photos").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "new-photo-${System.currentTimeMillis()}.jpg")
        return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }

    /** Clears the camera's picture once it has been made small (or given up on): only the small copy is kept, in memory. */
    fun clearCamera(context: Context) {
        File(context.cacheDir, "photos").listFiles()?.forEach { it.delete() }
    }

    /**
     * Reads the picture at [uri], turns it upright, draws it on white (a PNG's
     * clear parts would otherwise go black) at [PhotoRules.targetSize] and
     * returns the JPEG data URL and its bytes. Call off the main thread.
     */
    fun shrink(context: Context, uri: Uri): Pair<String, ByteArray> {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: throw PhotoUnreadable("That photo could not be opened. Choose another.")
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw PhotoUnreadable("That file is not a picture. Choose a photo.")
        val opts = BitmapFactory.Options().apply { inSampleSize = PhotoRules.sampleSize(bounds.outWidth, bounds.outHeight) }
        val read = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: throw PhotoUnreadable("That photo could not be read. Choose another.")
        val orientation = runCatching { resolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } }.getOrNull() ?: ExifInterface.ORIENTATION_NORMAL
        val (degrees, mirror) = PhotoRules.turn(orientation)
        val upright = if (degrees != 0f || mirror) {
            val m = Matrix().apply { if (mirror) postScale(-1f, 1f); postRotate(degrees) }
            Bitmap.createBitmap(read, 0, 0, read.width, read.height, m, true).also { if (it !== read) read.recycle() }
        } else read
        val (w, h) = PhotoRules.targetSize(upright.width, upright.height)
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(out).apply {
            drawColor(Color.WHITE)
            drawBitmap(upright, null, Rect(0, 0, w, h), Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        }
        upright.recycle()
        fun jpeg(quality: Int) = ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()
        var bytes = jpeg(PhotoRules.QUALITY)
        if (PhotoRules.dataUrl(bytes).length > PhotoRules.SERVER_MAX) bytes = jpeg(PhotoRules.FALLBACK_QUALITY)
        out.recycle()
        val url = PhotoRules.dataUrl(bytes)
        PhotoRules.problem(url)?.let { throw PhotoUnreadable(it) }
        return url to bytes
    }
}
