package expo.modules.piuvoice

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Configuração do decodificador Opus do MediaCodec (documentação do MediaCodec, "CSD buffers"):
 * - csd-0: cabeçalho de identificação OpusHead (RFC 7845, 19 bytes);
 * - csd-1: atraso do codec (pre-skip) em nanossegundos, 8 bytes little endian;
 * - csd-2: seek pre-roll em nanossegundos, 8 bytes little endian.
 * O pre-skip vem em amostras a 48 kHz (sempre, qualquer que seja a taxa original).
 */
object OpusHeader {
  const val PRE_SKIP = 312
  const val INPUT_RATE = 16000
  const val SEEK_PREROLL_NS = 80_000_000L

  fun head(channels: Int = 1, preSkip: Int = PRE_SKIP, inputRate: Int = INPUT_RATE): ByteArray =
    ByteBuffer.allocate(19).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("OpusHead".toByteArray(Charsets.US_ASCII))
      put(1)                       // versão
      put(channels.toByte())
      putShort(preSkip.toShort())
      putInt(inputRate)            // taxa original (informativa)
      putShort(0)                  // ganho de saída
      put(0)                       // mapping family 0 (mono/estéreo)
    }.array()

  fun codecDelayNs(preSkip: Int = PRE_SKIP): Long = preSkip * 1_000_000_000L / 48_000

  fun longLE(v: Long): ByteArray = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(v).array()

  /** [csd-0, csd-1, csd-2]. */
  fun csd(channels: Int = 1): List<ByteArray> =
    listOf(head(channels), longLE(codecDelayNs()), longLE(SEEK_PREROLL_NS))
}
