package expo.modules.piutransport

import java.nio.ByteBuffer

/**
 * Blocos do Bluetooth LE, iguais aos do iPhone (ver README e src/transport/frames.ts).
 * Cabeçalho de 8 bytes big-endian: id (UInt32), índice (UInt16), total (UInt16).
 * id 0 é o `hello`: bloco único com o nome curto do nó em UTF-8 (até 64 bytes).
 */
internal object BleFrames {
  const val HEADER = 8
  const val HELLO_ID = 0L
  const val MAX_HELLO = 64
  const val MAX_ENVELOPE = 32 * 1024
  const val MAX_PARTIAL = 64
  const val PARTIAL_TIMEOUT_MS = 60_000L

  private fun frame(id: Long, index: Int, count: Int, body: ByteArray, from: Int, to: Int): ByteArray {
    val buf = ByteBuffer.allocate(HEADER + (to - from)) // ByteBuffer é big-endian por padrão
    buf.putInt(id.toInt())
    buf.putShort(index.toShort())
    buf.putShort(count.toShort())
    buf.put(body, from, to - from)
    return buf.array()
  }

  /** Divide `data` em blocos de no máximo `mtu` bytes (cabeçalho incluído). */
  fun split(data: ByteArray, mtu: Int, id: Long): List<ByteArray> {
    val size = maxOf(1, mtu - HEADER)
    val count = maxOf(1, (data.size + size - 1) / size)
    require(count <= 0xFFFF) { "envelope grande demais para o MTU" }
    return (0 until count).map { i ->
      val start = i * size
      frame(id, i, count, data, start, minOf(start + size, data.size))
    }
  }

  fun hello(name: String): ByteArray {
    val bytes = name.toByteArray(Charsets.UTF_8).let { if (it.size > MAX_HELLO) it.copyOf(MAX_HELLO) else it }
    return frame(HELLO_ID, 0, 1, bytes, 0, bytes.size)
  }

  sealed class Result {
    class Envelope(val data: ByteArray) : Result()
    class Hello(val name: String) : Result()
  }

  /** Remontagem por `remetente + id`, com teto de memória (proteção contra vizinho malicioso). Não é thread-safe. */
  class Reassembler {
    private class Entry(val count: Int, val started: Long) {
      val parts = HashMap<Int, ByteArray>()
      var bytes = 0
    }

    private val partial = LinkedHashMap<String, Entry>()

    fun push(from: String, chunk: ByteArray, now: Long = System.currentTimeMillis()): Result? {
      if (chunk.size < HEADER) return null
      val b = ByteBuffer.wrap(chunk)
      val id = b.int.toLong() and 0xFFFFFFFFL
      val index = b.short.toInt() and 0xFFFF
      val count = b.short.toInt() and 0xFFFF
      if (count == 0 || index >= count) return null
      val body = chunk.copyOfRange(HEADER, chunk.size)
      if (id == HELLO_ID) {
        if (count != 1 || body.isEmpty() || body.size > MAX_HELLO) return null
        return Result.Hello(String(body, Charsets.UTF_8))
      }
      if (count > MAX_ENVELOPE) return null
      // Todos os blocos menos o último têm o mesmo tamanho: recusa cedo um envelope grande demais.
      if (index < count - 1 && body.size.toLong() * (count - 1) > MAX_ENVELOPE) return null
      partial.entries.removeAll { now - it.value.started >= PARTIAL_TIMEOUT_MS }
      val key = "$from-$id"
      var entry = partial[key]
      if (entry != null && entry.count != count) { partial.remove(key); entry = null }
      if (entry == null) {
        if (partial.size >= MAX_PARTIAL) {
          partial.minByOrNull { it.value.started }?.key?.let { partial.remove(it) }
        }
        entry = Entry(count, now)
      }
      if (!entry.parts.containsKey(index)) { entry.parts[index] = body; entry.bytes += body.size }
      if (entry.bytes > MAX_ENVELOPE) { partial.remove(key); return null }
      if (entry.parts.size < entry.count) { partial[key] = entry; return null }
      partial.remove(key)
      val out = ByteArray(entry.bytes)
      var off = 0
      for (i in 0 until entry.count) {
        val p = entry.parts[i] ?: return null
        System.arraycopy(p, 0, out, off, p.size)
        off += p.size
      }
      return Result.Envelope(out)
    }

    fun clear(from: String? = null) {
      if (from == null) partial.clear() else partial.keys.removeAll { it.startsWith("$from-") }
    }
  }
}
