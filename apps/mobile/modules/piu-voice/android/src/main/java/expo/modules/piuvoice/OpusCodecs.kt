package expo.modules.piuvoice

import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import java.nio.ByteBuffer
import java.nio.ByteOrder

internal const val OPUS_MIME = "audio/opus"

/** Codificador Opus do sistema (Android 10+, `c2.android.opus.encoder`)? */
internal val hasOpusEncoder: Boolean by lazy {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@lazy false
  try {
    MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
      info.isEncoder && info.supportedTypes.any { it.equals(OPUS_MIME, ignoreCase = true) }
    }
  } catch (_: Exception) { false }
}

/**
 * Opus pelo MediaCodec: PCM 16 kHz mono, pedaços de 20 ms (320 amostras), ~20 kbps. O primeiro buffer
 * de saída é a configuração (CSD, BUFFER_FLAG_CODEC_CONFIG): descartado; saem só pacotes Opus crus.
 */
internal class OpusEncoder(private val sampleRate: Int = 16000, bitrate: Int = 20_000) : AutoCloseable {
  private val codec: MediaCodec = MediaCodec.createEncoderByType(OPUS_MIME)
  private val info = MediaCodec.BufferInfo()
  private var ptsUs = 0L

  init {
    try {
      val fmt = MediaFormat.createAudioFormat(OPUS_MIME, sampleRate, 1).apply {
        setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, sampleRate / 50 * 2 * 2)
      }
      codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
    } catch (e: Exception) { codec.release(); throw e }
  }

  /** Um pedaço de PCM; cada pacote pronto vai para `out` (pode sair com um pedaço de atraso). */
  fun encode(pcm: ShortArray, len: Int, out: (ByteArray) -> Unit) {
    val idx = codec.dequeueInputBuffer(10_000)
    if (idx >= 0) {
      val buf = codec.getInputBuffer(idx)!!
      buf.clear()
      buf.order(ByteOrder.nativeOrder()).asShortBuffer().put(pcm, 0, len)
      codec.queueInputBuffer(idx, 0, len * 2, ptsUs, 0)
      ptsUs += len * 1_000_000L / sampleRate
    }
    while (true) {
      val o = codec.dequeueOutputBuffer(info, 0)
      if (o == MediaCodec.INFO_TRY_AGAIN_LATER) break
      if (o < 0) continue // formato/buffers mudaram
      if ((info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && info.size > 0) {
        val ob = codec.getOutputBuffer(o)!!
        ob.position(info.offset); ob.limit(info.offset + info.size)
        val bytes = ByteArray(info.size)
        ob.get(bytes)
        out(bytes)
      }
      codec.releaseOutputBuffer(o, false)
    }
  }

  override fun close() {
    try { codec.stop() } catch (_: Exception) {}
    try { codec.release() } catch (_: Exception) {}
  }
}

/**
 * Decodificador Opus do MediaCodec (existe desde a API 21) com csd-0/1/2 (./OpusHeader.kt). Decodifica
 * pacotes de qualquer codificador Opus (celular a 16 kHz, Desktop a 48 kHz pelo WebCodecs). O decodificador
 * do sistema costuma entregar 48 kHz: lê o formato de saída e reamostra para `outRate`.
 */
internal class OpusDecoder(private val outRate: Int = 16000) : AutoCloseable {
  private val codec: MediaCodec = MediaCodec.createDecoderByType(OPUS_MIME)
  private val info = MediaCodec.BufferInfo()
  private var ptsUs = 0L
  private var inRate = 48000
  private var channels = 1
  private var resampler = StreamResampler(inRate, outRate)

  init {
    try {
      val fmt = MediaFormat.createAudioFormat(OPUS_MIME, 48000, 1)
      OpusHeader.csd(1).forEachIndexed { i, b -> fmt.setByteBuffer("csd-$i", ByteBuffer.wrap(b)) }
      codec.configure(fmt, null, null, 0)
      codec.start()
      try { readFormat(codec.outputFormat) } catch (_: Exception) {} // alguns só informam depois
    } catch (e: Exception) { codec.release(); throw e }
  }

  private fun readFormat(f: MediaFormat) {
    val r = if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) f.getInteger(MediaFormat.KEY_SAMPLE_RATE) else inRate
    val c = if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) f.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else channels
    channels = c.coerceAtLeast(1)
    if (r > 0 && r != inRate) { inRate = r; resampler = StreamResampler(inRate, outRate) }
  }

  /** Um pacote → PCM a `outRate` (vazio se o decodificador ainda não entregou nada). */
  fun decode(packet: ByteArray): ShortArray {
    val idx = codec.dequeueInputBuffer(10_000)
    if (idx >= 0) {
      val buf = codec.getInputBuffer(idx)!!
      buf.clear()
      buf.put(packet)
      codec.queueInputBuffer(idx, 0, packet.size, ptsUs, 0)
      ptsUs += 20_000
    }
    var acc = ShortArray(0)
    var waitedUs = 0L
    while (true) {
      // Espera um pouco pela saída deste pacote; depois só recolhe o que já estiver pronto.
      val timeout = if (acc.isEmpty() && waitedUs < 15_000) 3_000L else 0L
      val o = codec.dequeueOutputBuffer(info, timeout)
      when {
        o == MediaCodec.INFO_TRY_AGAIN_LATER -> { if (timeout == 0L) break; waitedUs += timeout }
        o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> readFormat(codec.outputFormat)
        o < 0 -> {}
        else -> {
          if (info.size > 0) {
            val ob = codec.getOutputBuffer(o)!!
            ob.position(info.offset); ob.limit(info.offset + info.size)
            val sb = ob.order(ByteOrder.nativeOrder()).asShortBuffer()
            val raw = ShortArray(sb.remaining()).also { sb.get(it) }
            val pcm = resampler.process(downmix(raw))
            acc = if (acc.isEmpty()) pcm else acc + pcm
          }
          codec.releaseOutputBuffer(o, false)
        }
      }
    }
    return acc
  }

  private fun downmix(raw: ShortArray): ShortArray {
    if (channels == 1) return raw
    val n = raw.size / channels
    return ShortArray(n) { i ->
      var s = 0
      for (c in 0 until channels) s += raw[i * channels + c]
      (s / channels).toShort()
    }
  }

  override fun close() {
    try { codec.stop() } catch (_: Exception) {}
    try { codec.release() } catch (_: Exception) {}
  }
}
