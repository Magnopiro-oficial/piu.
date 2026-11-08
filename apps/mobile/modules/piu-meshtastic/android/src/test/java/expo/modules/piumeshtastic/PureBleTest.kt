package expo.modules.piumeshtastic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FakeScheduler : Scheduler {
  val timers = mutableListOf<Pair<Long, () -> Unit>?>()
  override fun schedule(ms: Long, fn: () -> Unit): Cancel {
    val i = timers.size; timers += ms to fn
    return Cancel { timers[i] = null }
  }
  fun fireAll() = timers.toList().forEachIndexed { i, t -> if (t != null) { timers[i] = null; t.second() } }
}

class GattQueueTest {
  private val s = FakeScheduler()
  private val q = GattQueue(s)
  private val log = mutableListOf<String>()
  private fun op(n: String, ok: Boolean = true) = GattQueue.Op(n, 1000, { log += "start:$n"; ok }) { r ->
    log += "done:$n:" + (r.exceptionOrNull()?.let { (it as? GattError)?.code } ?: r.getOrNull()?.size ?: "ok")
  }

  @Test fun serializa() {
    q.enqueue(op("a")); q.enqueue(op("b"))
    assertEquals(listOf("start:a"), log)
    q.complete(byteArrayOf(1, 2))
    assertEquals(listOf("start:a", "done:a:2", "start:b"), log)
    q.complete()
    assertFalse(q.busy)
  }

  @Test fun recusaDoAndroidPassaParaAProxima() {
    q.enqueue(op("a", ok = false)); q.enqueue(op("b"))
    assertEquals(listOf("start:a", "done:a:ERR_GATT", "start:b"), log)
    assertEquals("b", q.currentName)
  }

  @Test fun timeout() {
    q.enqueue(op("a")); q.enqueue(op("b"))
    s.fireAll()
    assertEquals(listOf("start:a", "done:a:TIMEOUT", "start:b"), log)
    q.complete() // callback atrasado de "a" não existe mais; fecha "b"
    q.complete() // sem operação: ignorado
    assertEquals("done:b:ok", log.last())
  }

  @Test fun clearFalhaTudo() {
    q.enqueue(op("a")); q.enqueue(op("b"))
    q.clear(GattError("DISCONNECTED", "x"))
    assertEquals(listOf("start:a", "done:a:DISCONNECTED", "done:b:DISCONNECTED"), log)
    assertEquals(0, q.size)
    s.fireAll() // timer cancelado
    assertEquals(3, log.size)
  }
}

class FromRadioDrainerTest {
  private val reads = ArrayDeque<(Result<ByteArray?>) -> Unit>()
  private val out = mutableListOf<Int>()
  private val d = FromRadioDrainer(read = { reads.addLast(it) }, emit = { out += it[0].toInt() }, maxReads = 5)
  private fun answer(v: ByteArray?) = reads.removeFirst()(Result.success(v))

  @Test fun leAteVazio() {
    var done: Throwable? = Exception("não chamou")
    d.request { done = it }
    answer(byteArrayOf(1)); answer(byteArrayOf(2)); answer(ByteArray(0))
    assertEquals(listOf(1, 2), out)
    assertEquals(null, done)
    assertFalse(d.draining)
    assertTrue(reads.isEmpty())
  }

  @Test fun pedidoDuranteDrenagemViraNovaRodadaSemLeituraParalela() {
    d.request()
    d.request() // FromNum notificou de novo
    assertEquals(1, reads.size)
    answer(ByteArray(0))
    assertEquals(1, reads.size) // segunda rodada
    answer(byteArrayOf(7)); answer(null)
    assertEquals(listOf(7), out)
    assertFalse(d.draining)
  }

  @Test fun limiteDeLeituras() {
    var err: Throwable? = null
    d.request { err = it }
    repeat(5) { answer(byteArrayOf(it.toByte())) }
    assertEquals("ERR_DRAIN", (err as GattError).code)
  }

  @Test fun erroDeLeituraEncerra() {
    var err: Throwable? = null
    d.request { err = it }
    reads.removeFirst()(Result.failure(GattError("TIMEOUT", "t")))
    assertEquals("TIMEOUT", (err as GattError).code)
    assertFalse(d.draining)
  }
}
