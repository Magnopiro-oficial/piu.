package expo.modules.piuvoice

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.ToneGenerator
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Process
import android.util.Log
import androidx.core.content.ContextCompat

internal enum class Codec(val wire: String) {
  OPUS("opus"), PCMU("pcmu");
  companion object { fun of(s: String) = if (s == "pcmu") PCMU else OPUS }
}

internal class Packet(val codec: Codec, val payload: ByteArray)

internal class NoPermission : Exception("Sem permissão de microfone (RECORD_AUDIO).")
internal class AudioUnavailable(msg: String) : Exception(msg)

private const val TAG = "PiuVoice"
private const val RATE = 16000
private const val FRAME = RATE / 50 // 320 amostras = 20 ms
/** Volume dos tons de quem liga (0–100, relativo ao volume da chamada): discreto. */
private const val TONE_VOLUME = 70
/** Tom de falha: ~2 toques de ocupado. A tela de fim da falha dura mais (callMachine `failScreenMs`). */
private const val FAIL_TONE_MS = 2000

/**
 * Áudio da chamada de voz: microfone (VOICE_COMMUNICATION + AEC/NS/AGC) → pedaços de 20 ms codificados
 * (Opus pelo MediaCodec ou PCMU) → `onFrame`; pedaços que chegam → buffer anti-jitter → decodificação →
 * AudioTrack. Captura e reprodução em threads próprias. `start`/`stop`/rotas são chamados numa thread
 * só (a de controle do módulo); `play`, `setMuted` e os níveis, de qualquer thread.
 *
 * A "sessão" (modo de comunicação, foco e rota) abre com a voz ou antes, com o tom de quem liga
 * (`tone`): o "chamando" sai pelo mesmo fone/alto-falante da chamada, sem abrir o microfone.
 */
internal class VoiceEngine(private val ctx: Context, private val onFrame: (Codec, ByteArray) -> Unit) {
  val localCodec: Codec get() = encoderCodec ?: (if (hasOpusEncoder) Codec.OPUS else Codec.PCMU)

  private val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val jitter = JitterBuffer<Packet>(target = 3, max = 10)
  val mine = LevelMeter()
  val theirs = LevelMeter()

  @Volatile private var running = false
  @Volatile var muted = false
  private var speaker = false

  private var started = false
  private var sessionOpen = false
  private var toneGen: ToneGenerator? = null
  private var record: AudioRecord? = null
  private var track: AudioTrack? = null
  private val effects = mutableListOf<AudioEffect>()
  @Volatile private var encoderCodec: Codec? = null
  private var captureThread: Thread? = null
  private var playThread: Thread? = null
  private var savedMode = AudioManager.MODE_NORMAL
  private var savedSpeaker = false
  private var scoOn = false
  private var focusRequest: AudioFocusRequest? = null
  private val focusListener = AudioManager.OnAudioFocusChangeListener { /* a chamada segue */ }
  private var deviceCallback: AudioDeviceCallback? = null

  // ── ciclo de vida ──────────────────────────────────────────────────────────────────────────────

  @SuppressLint("MissingPermission")
  fun start(onDevicesChanged: () -> Unit) {
    if (started) return
    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) throw NoPermission()
    started = true
    try {
      stopTone() // atendeu: o "chamando" para antes da voz
      openSession()

      val recMin = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val rec = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, RATE, AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT, maxOf(recMin, FRAME * 2 * 4))
      record = rec
      if (rec.state != AudioRecord.STATE_INITIALIZED) throw AudioUnavailable("Microfone indisponível.")
      attachEffects(rec.audioSessionId)

      val outMin = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val tr = AudioTrack.Builder()
        .setAudioAttributes(AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build())
        .setAudioFormat(AudioFormat.Builder()
          .setSampleRate(RATE)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .build())
        .setTransferMode(AudioTrack.MODE_STREAM)
        .setBufferSizeInBytes(maxOf(outMin, FRAME * 2 * 2))
        .build()
      track = tr
      if (tr.state != AudioTrack.STATE_INITIALIZED) throw AudioUnavailable("Saída de áudio indisponível.")

      jitter.clear(); mine.reset(); theirs.reset()
      applyRoute()
      deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = onDevicesChanged()
        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = onDevicesChanged()
      }.also { am.registerAudioDeviceCallback(it, null) }

      running = true
      rec.startRecording()
      tr.play()
      captureThread = Thread(::captureLoop, "piu-voice-capture").apply { start() }
      playThread = Thread(::playLoop, "piu-voice-play").apply { start() }
    } catch (e: Exception) {
      stop()
      throw e
    }
  }

  /** Libera tudo (tom incluído); idempotente. */
  fun stop() {
    stopTone()
    if (started) stopMedia()
    closeSession()
  }

  private fun stopMedia() {
    started = false
    running = false
    listOf(captureThread, playThread).forEach { t ->
      try { t?.join(500) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
    }
    captureThread = null; playThread = null
    record?.let { r -> try { if (r.recordingState == AudioRecord.RECORDSTATE_RECORDING) r.stop() } catch (_: Exception) {}; r.release() }
    record = null
    effects.forEach { try { it.release() } catch (_: Exception) {} }
    effects.clear()
    track?.let { t -> try { t.pause(); t.flush(); t.stop() } catch (_: Exception) {}; t.release() }
    track = null
    encoderCodec = null
    jitter.clear(); mine.reset(); theirs.reset()
    deviceCallback?.let { try { am.unregisterAudioDeviceCallback(it) } catch (_: Exception) {} }
    deviceCallback = null
  }

  /** Modo de comunicação, foco e rota: abre com o tom ou com a voz, o que vier primeiro. */
  private fun openSession() {
    if (sessionOpen) return
    sessionOpen = true
    savedMode = am.mode
    @Suppress("DEPRECATION")
    savedSpeaker = am.isSpeakerphoneOn
    requestFocus()
    am.mode = AudioManager.MODE_IN_COMMUNICATION
    applyRoute()
  }

  private fun closeSession() {
    if (!sessionOpen) return
    sessionOpen = false
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice()
      else {
        @Suppress("DEPRECATION")
        if (scoOn) { am.isBluetoothScoOn = false; am.stopBluetoothSco() }
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = savedSpeaker
      }
    } catch (e: Exception) { Log.w(TAG, "restaurar rota", e) }
    scoOn = false
    speaker = false // a próxima sessão começa no fone (o JS manda a rota antes do tom/voz)
    try { am.mode = savedMode } catch (_: Exception) {}
    abandonFocus()
  }

  // ── entrada da rede e controles ───────────────────────────────────────────────────────────────

  fun play(codec: Codec, payload: ByteArray, seq: Long) {
    if (!running || payload.isEmpty()) return
    jitter.push(seq, Packet(codec, payload))
  }

  fun setSpeaker(on: Boolean) {
    speaker = on
    if (sessionOpen) applyRoute()
  }

  /**
   * Tom de quem liga, sintetizado pelo aparelho (sem arquivo): "ringback" = chamando, em loop até o
   * próximo pedido; "fail" = ocupado curto; outro = silêncio (e solta a sessão se a voz não abriu).
   * Ao atender, o JS não manda silêncio: o `start` para o tom e segue na mesma sessão (sem estalo).
   */
  fun tone(kind: String) {
    stopTone()
    when (kind) {
      "ringback" -> playTone(ToneGenerator.TONE_SUP_RINGTONE, 0)
      "fail" -> playTone(ToneGenerator.TONE_SUP_BUSY, FAIL_TONE_MS)
      else -> if (!started) closeSession()
    }
  }

  private fun playTone(type: Int, ms: Int) {
    if (started) return // voz aberta: nada de tom por cima
    try {
      openSession()
      val g = ToneGenerator(AudioManager.STREAM_VOICE_CALL, TONE_VOLUME)
      toneGen = g
      if (ms > 0) g.startTone(type, ms) else g.startTone(type)
    } catch (e: Exception) { Log.w(TAG, "tom da chamada", e) } // ToneGenerator lança se o áudio estiver ocupado
  }

  private fun stopTone() {
    val g = toneGen ?: return
    toneGen = null
    try { g.stopTone() } catch (_: Exception) {}
    g.release()
  }

  /** Alto-falante; senão Bluetooth (SCO/LE) se houver fone; senão fone com fio; senão o do aparelho. */
  fun applyRoute() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val devices = am.availableCommunicationDevices
        fun find(vararg types: Int): AudioDeviceInfo? {
          for (t in types) devices.firstOrNull { it.type == t }?.let { return it }
          return null
        }
        val pick = if (speaker) find(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER)
        else find(AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
          AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET,
          AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
        if (pick != null && am.communicationDevice?.id != pick.id) am.setCommunicationDevice(pick)
      } else {
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = speaker
        @Suppress("DEPRECATION")
        val bt = !speaker && am.isBluetoothScoAvailableOffCall &&
          am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
        @Suppress("DEPRECATION")
        if (bt && !scoOn) { am.startBluetoothSco(); am.isBluetoothScoOn = true; scoOn = true }
        else if (!bt && scoOn) { am.isBluetoothScoOn = false; am.stopBluetoothSco(); scoOn = false }
      }
    } catch (e: Exception) { Log.w(TAG, "rota de áudio", e) } // SecurityException sem BLUETOOTH_CONNECT etc.
  }

  // ── threads ───────────────────────────────────────────────────────────────────────────────────

  private fun captureLoop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val rec = record ?: return
    val frame = ShortArray(FRAME)
    var encoder: OpusEncoder? = null
    if (hasOpusEncoder) {
      try { encoder = OpusEncoder(RATE, 20_000) } catch (e: Exception) { Log.w(TAG, "Opus indisponível, usando PCMU", e) }
    }
    encoderCodec = if (encoder != null) Codec.OPUS else Codec.PCMU
    val down = StreamResampler(RATE, 8000)
    try {
      while (running) {
        var got = 0
        while (got < FRAME && running) {
          val n = rec.read(frame, got, FRAME - got)
          if (n <= 0) { if (n < 0) Log.w(TAG, "AudioRecord.read=$n"); Thread.sleep(if (n < 0) 20L else 2L); continue }
          got += n
        }
        if (!running) break
        if (muted) { mine.reset(); continue }
        mine.update(frame)
        val enc = encoder
        if (enc != null) {
          try { enc.encode(frame, FRAME) { onFrame(Codec.OPUS, it) } }
          catch (e: Exception) {
            Log.w(TAG, "codificador Opus falhou, usando PCMU", e)
            enc.close(); encoder = null; encoderCodec = Codec.PCMU
          }
        } else {
          onFrame(Codec.PCMU, MuLaw.encode(down.process(frame)))
        }
      }
    } catch (_: InterruptedException) {
    } catch (e: Exception) {
      Log.e(TAG, "captura", e)
    } finally {
      encoder?.close()
      mine.reset()
    }
  }

  private fun playLoop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val tr = track ?: return
    val silence = ShortArray(FRAME)
    var opus: OpusDecoder? = null
    val up = StreamResampler(8000, RATE)
    try {
      while (running) {
        var pcm: ShortArray = silence
        when (val o = jitter.pop()) {
          is JitterBuffer.Out.Frame -> {
            val p = o.item
            pcm = when (p.codec) {
              Codec.PCMU -> up.process(MuLaw.decode(p.payload))
              Codec.OPUS -> try {
                (opus ?: OpusDecoder(RATE).also { opus = it }).decode(p.payload)
              } catch (e: Exception) {
                Log.w(TAG, "decodificador Opus", e)
                opus?.close(); opus = null
                silence
              }
            }
            if (pcm.isEmpty()) pcm = silence
          }
          else -> {} // perdido ou buffer enchendo: 20 ms de silêncio
        }
        theirs.update(pcm)
        var off = 0
        while (off < pcm.size && running) {
          val n = tr.write(pcm, off, pcm.size - off) // bloqueia: é o que dá o ritmo de 20 ms
          if (n < 0) { Log.w(TAG, "AudioTrack.write=$n"); Thread.sleep(20); break }
          off += n
        }
      }
    } catch (_: InterruptedException) {
    } catch (e: Exception) {
      Log.e(TAG, "reprodução", e)
    } finally {
      opus?.close()
      theirs.reset()
    }
  }

  // ── efeitos e foco ────────────────────────────────────────────────────────────────────────────

  private fun attachEffects(session: Int) {
    fun add(available: Boolean, make: () -> AudioEffect?) {
      if (!available) return
      try { make()?.let { it.enabled = true; effects += it } } catch (e: Exception) { Log.w(TAG, "efeito", e) }
    }
    add(AcousticEchoCanceler.isAvailable()) { AcousticEchoCanceler.create(session) }
    add(NoiseSuppressor.isAvailable()) { NoiseSuppressor.create(session) }
    add(AutomaticGainControl.isAvailable()) { AutomaticGainControl.create(session) }
  }

  private fun requestFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build())
        .setOnAudioFocusChangeListener(focusListener)
        .build()
      focusRequest = req
      am.requestAudioFocus(req)
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(focusListener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    }
  }

  private fun abandonFocus() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) focusRequest?.let { am.abandonAudioFocusRequest(it) }
      else {
        @Suppress("DEPRECATION")
        am.abandonAudioFocus(focusListener)
      }
    } catch (_: Exception) {}
    focusRequest = null
  }
}
