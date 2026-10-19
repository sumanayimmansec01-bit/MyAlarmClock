package com.myalarmclock.timer

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * The alert plays on the alarm audio stream at the app's own volume, so it is
 * heard even when ringtone, media and notification sounds are all turned off.
 * The phone's alarm volume is put back right after the sound ends.
 */
object Sound {
    val NAMES = linkedMapOf("chime" to "กริ๊ง 2 โน้ต", "beep" to "บี๊บดิจิทัล")

    private const val RATE = 44_100
    private val main = Handler(Looper.getMainLooper())
    private var track: AudioTrack? = null

    fun play(ctx: Context, key: String, volumePercent: Int, vibrate: Boolean): Long {
        val data = pcm(key)
        val am = ctx.getSystemService(AudioManager::class.java)
        val previous = am.getStreamVolume(AudioManager.STREAM_ALARM)
        val max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        val target = (max * volumePercent / 100.0).roundToInt().coerceIn(1, max)
        val changed = previous != target && try {
            am.setStreamVolume(AudioManager.STREAM_ALARM, target, 0)
            true
        } catch (e: SecurityException) {
            false
        }

        track?.release()
        val t = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(data.size * 2)
            .build()
        t.write(data, 0, data.size)
        t.play()
        track = t

        val ms = data.size * 1000L / RATE
        main.postDelayed({
            t.release()
            if (track === t) track = null
            if (changed) runCatching { am.setStreamVolume(AudioManager.STREAM_ALARM, previous, 0) }
        }, ms + 300)

        if (vibrate) vibrate(ctx)
        return ms
    }

    private fun vibrate(ctx: Context) {
        val vibrator = if (Build.VERSION.SDK_INT >= 31) {
            ctx.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Vibrator::class.java)
        }
        val effect = VibrationEffect.createWaveform(longArrayOf(0, 400, 150, 400), -1)
        if (Build.VERSION.SDK_INT >= 33) {
            vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(
                effect,
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build(),
            )
        }
    }

    private fun pcm(key: String): ShortArray = when (key) {
        "beep" -> render(0.6) { buf ->
            listOf(0.0, 0.18, 0.36).forEach { square(buf, 1760.0, it, 0.12, 0.35) }
        }
        else -> render(1.7) { buf ->
            tone(buf, 880.0, 0.0, 1.2, 0.45)
            tone(buf, 1318.5, 0.28, 1.2, 0.45)
        }
    }

    private fun render(seconds: Double, draw: (FloatArray) -> Unit): ShortArray {
        val buf = FloatArray((seconds * RATE).toInt())
        draw(buf)
        return ShortArray(buf.size) { (buf[it].coerceIn(-1f, 1f) * 32767).toInt().toShort() }
    }

    /** A sine note with a quick attack that fades to silence over [decay] seconds. */
    private fun tone(buf: FloatArray, freq: Double, start: Double, decay: Double, peak: Double) {
        val from = (start * RATE).toInt()
        val n = (decay * RATE).toInt()
        val k = ln(10_000.0) / decay
        for (i in 0 until n) {
            val at = from + i
            if (at >= buf.size) break
            val t = i.toDouble() / RATE
            val env = if (t < 0.02) t / 0.02 else exp(-k * t)
            buf[at] += (peak * env * sin(2 * PI * freq * t)).toFloat()
        }
    }

    private fun square(buf: FloatArray, freq: Double, start: Double, length: Double, peak: Double) {
        val from = (start * RATE).toInt()
        val n = (length * RATE).toInt()
        for (i in 0 until n) {
            val at = from + i
            if (at >= buf.size) break
            val t = i.toDouble() / RATE
            val edge = minOf(1.0, minOf(i, n - i) / (0.004 * RATE))
            val s = if (sin(2 * PI * freq * t) >= 0) 1.0 else -1.0
            buf[at] += (peak * edge * s).toFloat()
        }
    }
}
