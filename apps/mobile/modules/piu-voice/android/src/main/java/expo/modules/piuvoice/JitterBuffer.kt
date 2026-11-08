package expo.modules.piuvoice

import java.util.TreeMap

/**
 * Buffer anti-oscilação (jitter) por número de sequência; cada item = 20 ms de voz.
 *
 * - Começa (e recomeça depois de esvaziar) só com `target` pedaços guardados (60 ms).
 * - Mais de `max` pedaços (200 ms): descarta os mais antigos.
 * - Chegou atrasado (sequência já tocada) ou repetido: descarta.
 * - Buraco na sequência: a sequência da chamada é compartilhada com ping/pong (src/calls/callMedia.ts),
 *   então nem todo buraco é voz perdida. Com o buffer cheio (≥ alvo), pula o buraco; abaixo do alvo,
 *   toca 20 ms de silêncio no lugar (Missing), o que também devolve o buffer ao alvo.
 * - Sequência que volta muito para trás (o outro lado recomeçou a contagem): zera.
 */
class JitterBuffer<T>(val target: Int = 3, val max: Int = 10, private val resetWindow: Long = 500) {
  sealed class Out<out T> {
    data class Frame<T>(val seq: Long, val item: T) : Out<T>()
    /** Pedaço que devia vir agora e não veio: silêncio (ou PLC) de 20 ms. */
    object Missing : Out<Nothing>()
    /** Buffer vazio ou enchendo: silêncio. */
    object Silence : Out<Nothing>()
  }

  private val map = TreeMap<Long, T>()
  private var next: Long? = null
  private var buffering = true

  var droppedLate = 0L; private set
  var droppedOverflow = 0L; private set
  var concealed = 0L; private set
  var underflows = 0L; private set

  @get:Synchronized val size: Int get() = map.size

  @Synchronized fun push(seq: Long, item: T) {
    val n = next
    if (n != null && seq < n) {
      if (n - seq > resetWindow) clearInternal() else { droppedLate++; return }
    }
    if (map.containsKey(seq)) return
    map[seq] = item
    while (map.size > max) {
      map.pollFirstEntry()
      droppedOverflow++
      next = map.firstKey()
    }
  }

  @Synchronized fun pop(): Out<T> {
    if (map.isEmpty()) {
      if (!buffering) { buffering = true; underflows++ }
      return Out.Silence
    }
    if (buffering) {
      if (map.size < target) return Out.Silence
      buffering = false
      next = map.firstKey()
    }
    val first = map.firstKey()
    val n = next ?: first
    if (first == n || map.size >= target) {
      val item = map.remove(first)!!
      next = first + 1
      return Out.Frame(first, item)
    }
    next = n + 1
    concealed++
    return Out.Missing
  }

  @Synchronized fun clear() = clearInternal()

  private fun clearInternal() { map.clear(); next = null; buffering = true }
}
