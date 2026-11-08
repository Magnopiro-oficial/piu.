package expo.modules.piuvoice

/**
 * G.711 µ-law (PCMU), 8 kHz: o codec de reserva da chamada para celulares sem codificador Opus
 * (Android 7–9). 20 ms = 160 bytes. Bit a bit igual a src/calls/pcmu.ts (o Desktop decodifica lá).
 */
object MuLaw {
  private const val BIAS = 0x84
  private const val CLIP = 32635

  fun encodeSample(pcm: Int): Int {
    var s = pcm.coerceIn(-32768, 32767)
    val sign = if (s < 0) 0x80 else 0
    if (sign != 0) s = -s
    if (s > CLIP) s = CLIP
    s += BIAS
    var exp = 7
    var mask = 0x4000
    while ((s and mask) == 0 && exp > 0) { exp--; mask = mask shr 1 }
    val mant = (s shr (exp + 3)) and 0x0f
    return (sign or (exp shl 4) or mant).inv() and 0xff
  }

  fun decodeSample(u: Int): Int {
    val x = u.inv() and 0xff
    val sign = x and 0x80
    val exp = (x shr 4) and 0x07
    val mant = x and 0x0f
    val s = (((mant shl 3) + BIAS) shl exp) - BIAS
    return if (sign != 0) -s else s
  }

  private val DECODE = ShortArray(256) { decodeSample(it).toShort() }

  /** PCM 16 bits → µ-law (1 byte por amostra). */
  fun encode(pcm: ShortArray, off: Int = 0, len: Int = pcm.size - off): ByteArray =
    ByteArray(len) { encodeSample(pcm[off + it].toInt()).toByte() }

  /** µ-law → PCM 16 bits. */
  fun decode(u: ByteArray): ShortArray = ShortArray(u.size) { DECODE[u[it].toInt() and 0xff] }
}
