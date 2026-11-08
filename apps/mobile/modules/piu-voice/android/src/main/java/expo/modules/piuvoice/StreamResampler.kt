package expo.modules.piuvoice

import kotlin.math.roundToInt

/**
 * Reamostrador de fluxo, mono 16 bits, com estado entre chamadas (pedaços de 20 ms seguidos não dão
 * estalo na emenda).
 * - Divisão inteira (16k→8k, 48k→16k): média de cada grupo de N amostras (filtro passa-baixa simples).
 * - Outros casos (8k→16k, 24k→16k...): interpolação linear (atraso de uma amostra de entrada).
 */
class StreamResampler(val inRate: Int, val outRate: Int) {
  init { require(inRate > 0 && outRate > 0) { "taxa inválida" } }

  private val decim = if (inRate > outRate && inRate % outRate == 0) inRate / outRate else 0
  private var accSum = 0
  private var accN = 0

  private val step = inRate.toDouble() / outRate
  /** Posição da próxima saída, no espaço em que 0 = última amostra do pedaço anterior. */
  private var phase = 0.0
  private var prev = 0

  fun process(input: ShortArray, len: Int = input.size): ShortArray {
    if (inRate == outRate) return input.copyOf(len)
    if (decim > 0) {
      val out = ShortArray((accN + len) / decim)
      var o = 0
      for (i in 0 until len) {
        accSum += input[i]
        if (++accN == decim) { out[o++] = (accSum / decim).toShort(); accSum = 0; accN = 0 }
      }
      return out
    }
    if (len == 0) return ShortArray(0)
    val out = ShortArray(((len - phase) / step).toInt() + 2)
    var o = 0
    var p = phase
    while (p < len) {
      val i = p.toInt()
      val f = p - i
      val a = if (i == 0) prev else input[i - 1].toInt()
      val b = input[i].toInt()
      out[o++] = (a + (b - a) * f).roundToInt().coerceIn(-32768, 32767).toShort()
      p += step
    }
    phase = p - len
    prev = input[len - 1].toInt()
    return if (o == out.size) out else out.copyOf(o)
  }
}
