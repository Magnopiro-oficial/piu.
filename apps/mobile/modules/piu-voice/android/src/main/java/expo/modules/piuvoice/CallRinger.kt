package expo.modules.piuvoice

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Toque do sistema e vibração da chamada recebida. Respeita o aparelho: silencioso não toca nem vibra,
 * vibrar só vibra, e com Não perturbe ligado fica quieto (o Piu não sabe quais contatos a pessoa deixou
 * passar). Usa os atributos de toque de chamada: o sistema deixa vibrar com o app em segundo plano.
 * Chamar na thread principal.
 */
internal class CallRinger(private val ctx: Context) {
  private val main = Handler(Looper.getMainLooper())
  private var tone: Ringtone? = null
  private var vibrator: Vibrator? = null

  // Android 8: o Ringtone não repete sozinho; toca de novo quando acaba.
  private val replay = object : Runnable {
    override fun run() {
      val t = tone ?: return
      try { if (!t.isPlaying) t.play() } catch (_: Exception) {}
      main.postDelayed(this, 1500)
    }
  }

  val ringing get() = tone != null || vibrator != null

  fun start(pattern: LongArray) {
    if (ringing) return
    val nm = ctx.getSystemService(NotificationManager::class.java)
    if (nm != null && nm.currentInterruptionFilter > NotificationManager.INTERRUPTION_FILTER_ALL) return
    val mode = ctx.getSystemService(AudioManager::class.java)?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL
    if (mode == AudioManager.RINGER_MODE_SILENT) return
    vibrate(pattern)
    if (mode == AudioManager.RINGER_MODE_NORMAL) ring()
  }

  fun stop() {
    main.removeCallbacks(replay)
    tone?.let { try { it.stop() } catch (_: Exception) {} }
    tone = null
    vibrator?.let { try { it.cancel() } catch (_: Exception) {} }
    vibrator = null
  }

  private fun ring() {
    // URI padrão (settings/system/ringtone): o sistema resolve o toque escolhido, sem permissão de arquivos.
    val t = RingtoneManager.getRingtone(ctx, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)) ?: return
    t.audioAttributes = RING_ATTRS
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) t.isLooping = true
    try { t.play() } catch (_: Exception) { return }
    tone = t
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) main.postDelayed(replay, 1500)
  }

  @Suppress("DEPRECATION")
  private fun vibrate(pattern: LongArray) {
    val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
      ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
    if (v == null || !v.hasVibrator() || pattern.isEmpty()) return
    try {
      when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
          v.vibrate(VibrationEffect.createWaveform(pattern, 0), VibrationAttributes.createForUsage(VibrationAttributes.USAGE_RINGTONE))
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> v.vibrate(VibrationEffect.createWaveform(pattern, 0), RING_ATTRS)
        else -> v.vibrate(pattern, 0, RING_ATTRS)
      }
      vibrator = v
    } catch (_: Exception) {}
  }

  companion object {
    private val RING_ATTRS: AudioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
  }
}
