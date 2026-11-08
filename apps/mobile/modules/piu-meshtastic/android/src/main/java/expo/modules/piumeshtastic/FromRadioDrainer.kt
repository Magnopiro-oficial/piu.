package expo.modules.piumeshtastic

/**
 * Lê FromRadio repetidamente até vir vazio, emitindo cada leitura não vazia. Pedidos de drenagem que
 * chegam durante uma drenagem (FromNum notificou de novo) viram mais uma rodada no fim, sem leituras
 * paralelas. `maxReads` evita laço infinito com rádio defeituoso. Mesma thread da [GattQueue].
 */
class FromRadioDrainer(
  private val read: ((Result<ByteArray?>) -> Unit) -> Unit,
  private val emit: (ByteArray) -> Unit,
  private val maxReads: Int = 512,
) {
  private var running = false
  private var again = false
  private var count = 0
  private val waiters = mutableListOf<(Throwable?) -> Unit>()

  val draining: Boolean get() = running

  /** Pede uma drenagem; `onDone` (opcional) é chamado quando a fila do rádio esvaziar ou falhar. */
  fun request(onDone: ((Throwable?) -> Unit)? = null) {
    onDone?.let { waiters += it }
    if (running) { again = true; return }
    running = true
    count = 0
    step()
  }

  /** Desconectou: encerra e avisa quem esperava. */
  fun reset(error: Throwable) {
    running = false; again = false
    flush(error)
  }

  private fun step() {
    if (count >= maxReads) return end(GattError("ERR_DRAIN", "FromRadio não esvaziou após $maxReads leituras"))
    count++
    read { r ->
      if (!running) return@read
      val e = r.exceptionOrNull()
      if (e != null) return@read end(e)
      val bytes = r.getOrNull()
      if (bytes == null || bytes.isEmpty()) {
        if (again) { again = false; count = 0; step() } else end(null)
      } else {
        emit(bytes)
        step()
      }
    }
  }

  private fun end(e: Throwable?) {
    running = false; again = false
    flush(e)
  }

  private fun flush(e: Throwable?) {
    val w = waiters.toList(); waiters.clear()
    w.forEach { it(e) }
  }
}
