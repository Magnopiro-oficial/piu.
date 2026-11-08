package expo.modules.piuvoice

import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * Nível de voz 0..1 para a animação: RMS do pedaço em dBFS, normalizado entre `floorDb` (0) e
 * `ceilDb` (1); sobe rápido (constante ~10 ms) e cai com constante ~150 ms. Atualizado a cada pedaço
 * (thread de áudio) e lido de qualquer thread (`value` é volátil).
 */
class LevelMeter(
  frameMs: Double = 20.0,
  attackMs: Double = 10.0,
  releaseMs: Double = 150.0,
  private val floorDb: Double = -60.0,
  private val ceilDb: Double = -12.0,
) {
  private val attack = 1 - exp(-frameMs / attackMs)
  private val release = 1 - exp(-frameMs / releaseMs)

  @Volatile var value: Float = 0f
    private set

  fun update(pcm: ShortArray, off: Int = 0, len: Int = pcm.size - off): Float {
    val target = normalize(rms(pcm, off, len))
    val v = value
    value = (v + (target - v) * (if (target > v) attack else release)).toFloat().coerceIn(0f, 1f)
    return value
  }

  fun reset() { value = 0f }

  fun normalize(rms: Double): Double {
    if (rms <= 0.0) return 0.0
    val db = 20 * log10(rms / 32768.0)
    return ((db - floorDb) / (ceilDb - floorDb)).coerceIn(0.0, 1.0)
  }

  companion object {
    fun rms(pcm: ShortArray, off: Int = 0, len: Int = pcm.size - off): Double {
      if (len <= 0) return 0.0
      var sum = 0.0
      for (i in off until off + len) { val s = pcm[i].toDouble(); sum += s * s }
      return sqrt(sum / len)
    }
  }
}
