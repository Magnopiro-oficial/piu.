package expo.modules.piumeshtastic

/** Cancela um timeout agendado. */
fun interface Cancel { fun cancel() }

/** Agenda `fn` depois de `ms` (Handler no app, falso nos testes). */
fun interface Scheduler { fun schedule(ms: Long, fn: () -> Unit): Cancel }

class GattError(val code: String, message: String) : Exception(message)

/**
 * Fila serializada de operações GATT: o Android só aceita uma por vez e só avisa o fim pelo callback.
 * `start` dispara a operação (retorna false se a pilha recusou); o callback chama [complete]/[fail].
 * Cada operação tem timeout; ao estourar, falha com code TIMEOUT e a próxima começa.
 * Não é thread-safe: use sempre da mesma thread (no módulo, a thread do Handler).
 */
class GattQueue(private val scheduler: Scheduler) {
  class Op(
    val name: String,
    val timeoutMs: Long,
    val start: () -> Boolean,
    val done: (Result<ByteArray?>) -> Unit,
  )

  private val pending = ArrayDeque<Op>()
  private var current: Op? = null
  private var timer: Cancel? = null

  val busy: Boolean get() = current != null
  val size: Int get() = pending.size + (if (current != null) 1 else 0)
  val currentName: String? get() = current?.name

  fun enqueue(op: Op) {
    pending.addLast(op)
    if (current == null) next()
  }

  /** Fim com sucesso da operação atual (ignorado se não há nenhuma, ex.: callback atrasado). */
  fun complete(value: ByteArray? = null) = finish(Result.success(value))

  fun fail(error: Throwable) = finish(Result.failure(error))

  /** Falha a atual e todas as pendentes (desconexão). */
  fun clear(error: Throwable) {
    timer?.cancel(); timer = null
    val all = listOfNotNull(current) + pending
    current = null
    pending.clear()
    all.forEach { it.done(Result.failure(error)) }
  }

  private fun finish(r: Result<ByteArray?>) {
    val op = current ?: return
    timer?.cancel(); timer = null
    current = null
    op.done(r)
    next()
  }

  private fun next() {
    while (current == null) {
      val op = pending.removeFirstOrNull() ?: return
      current = op
      timer = scheduler.schedule(op.timeoutMs) {
        if (current === op) finish(Result.failure(GattError("TIMEOUT", "${op.name}: tempo esgotado")))
      }
      val ok = try { op.start() } catch (e: Exception) { false }
      if (!ok && current === op) {
        timer?.cancel(); timer = null
        current = null
        op.done(Result.failure(GattError("ERR_GATT", "${op.name}: o Android recusou a operação")))
      }
    }
  }
}
