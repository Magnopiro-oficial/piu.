package expo.modules.piuvoice

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Áudio da chamada de voz do Piu (src/calls/callService.ts, `AudioEngine`). Sinais, cifra e rede ficam
 * no TypeScript; aqui só microfone, codec e alto-falante (./VoiceEngine.kt).
 *
 * Bytes passam como `Uint8Array` ↔ `ByteArray` direto pela JSI (sem base64). `start`/`stop`/rotas vão
 * para uma thread de controle (em ordem); `play`, `setMuted` e `levels` são síncronos e baratos.
 */
class PiuVoiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val control: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "piu-voice-control") }
  @Volatile private var listening = false
  @Volatile private var engine: VoiceEngine? = null

  @Synchronized private fun engine(): VoiceEngine = engine ?: VoiceEngine(context.applicationContext) { codec, bytes ->
    if (listening) sendEvent("onFrame", mapOf("codec" to codec.wire, "data" to bytes))
  }.also { engine = it }

  override fun definition() = ModuleDefinition {
    Name("PiuVoice")
    Events("onFrame")

    // A lista de codecs do sistema demora alguns ms na 1ª consulta: fora da thread do JS.
    OnCreate { control.execute { hasOpusEncoder } }

    OnStartObserving { listening = true }
    OnStopObserving { listening = false }

    Function("isAvailable") { true }

    Function("codec") { (engine?.localCodec ?: if (hasOpusEncoder) Codec.OPUS else Codec.PCMU).wire }

    AsyncFunction("start") { promise: Promise ->
      control.execute {
        try {
          val e = engine()
          e.start { control.execute { e.applyRoute() } }
          // Microfone aberto: sobe o serviço em primeiro plano da chamada, se o JS já pediu (./PiuCallService.kt).
          PiuCallService.retry(context.applicationContext)
          promise.resolve(null)
        } catch (_: NoPermission) {
          promise.reject(CodedException("PERMISSION", "Sem permissão de microfone.", null))
        } catch (e: CodedException) {
          promise.reject(e)
        } catch (e: Exception) {
          promise.reject(CodedException("ERR_AUDIO", e.message ?: "Falha ao abrir o áudio da chamada.", e))
        }
      }
    }

    Function("stop") { control.execute { engine?.stop() }; Unit }

    Function("play") { codec: String, payload: ByteArray, seq: Double ->
      engine?.play(Codec.of(codec), payload, seq.toLong())
      Unit
    }

    Function("setMuted") { m: Boolean -> engine().muted = m; Unit }

    Function("setSpeaker") { on: Boolean -> control.execute { engine().setSpeaker(on) }; Unit }

    Function("levels") {
      val e = engine
      mapOf("mine" to (e?.mine?.value ?: 0f).toDouble(), "theirs" to (e?.theirs?.value ?: 0f).toDouble())
    }

    OnDestroy {
      control.execute { engine?.stop() }
      control.shutdown()
      try { control.awaitTermination(2, TimeUnit.SECONDS) } catch (_: InterruptedException) {}
    }
  }
}
