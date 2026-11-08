package expo.modules.piuvoice

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

class MuLawTest {
  @Test fun knownValues() {
    // Mesmos valores de src/calls/pcmu.ts (e da tabela G.711).
    assertEquals(0xFF, MuLaw.encodeSample(0))
    assertEquals(0, MuLaw.decodeSample(0xFF))
    assertEquals(0x80, MuLaw.encodeSample(32767))
    assertEquals(0x00, MuLaw.encodeSample(-32768))
    assertEquals(32124, MuLaw.decodeSample(0x80))
    assertEquals(-32124, MuLaw.decodeSample(0x00))
  }

  @Test fun roundTripWithinQuantizationError() {
    for (s in -32768..32767 step 7) {
      val back = MuLaw.decodeSample(MuLaw.encodeSample(s))
      val mag = abs(s).coerceAtMost(32635)
      // Passo do segmento µ-law: 2^(exp+3); erro máximo = metade do passo (+1 de arredondamento).
      val tol = maxOf(8, mag / 16 + 8)
      assertTrue("s=$s back=$back", abs(back - s.coerceIn(-32635, 32635)) <= tol)
    }
  }

  @Test fun everyCodeIsAFixedPoint() {
    // decode→encode devolve o mesmo byte (exceto o "zero negativo" 0x7F, que decodifica para 0).
    for (u in 0..255) {
      if (u == 0x7F) continue
      assertEquals(u, MuLaw.encodeSample(MuLaw.decodeSample(u)))
    }
  }

  @Test fun arraysHave160BytesPer20ms() {
    val pcm = ShortArray(160) { (it * 100 - 8000).toShort() }
    val enc = MuLaw.encode(pcm)
    assertEquals(160, enc.size)
    assertEquals(160, MuLaw.decode(enc).size)
  }
}

class StreamResamplerTest {
  private fun tone(n: Int, rate: Int, hz: Double, start: Int = 0) =
    ShortArray(n) { (8000 * sin(2 * PI * hz * (start + it) / rate)).toInt().toShort() }

  @Test fun downsample16to8Gives160PerFrame() {
    val r = StreamResampler(16000, 8000)
    repeat(5) { assertEquals(160, r.process(ShortArray(320)).size) }
  }

  @Test fun upsample8to16Gives320PerFrame() {
    val r = StreamResampler(8000, 16000)
    repeat(5) { assertEquals(320, r.process(ShortArray(160)).size) }
  }

  @Test fun decimate48to16Gives320PerOpusFrame() {
    val r = StreamResampler(48000, 16000)
    assertEquals(320, r.process(ShortArray(960)).size)
    // Pedaço quebrado (pre-skip): sobra carrega para o próximo.
    assertEquals(216, r.process(ShortArray(648)).size)
    assertEquals(0, r.process(ShortArray(2)).size)
    assertEquals(1, r.process(ShortArray(1)).size)
  }

  @Test fun nonIntegerRatioKeepsLongTermRate() {
    val r = StreamResampler(24000, 16000)
    var total = 0
    repeat(50) { total += r.process(ShortArray(480)).size }
    assertEquals(50 * 320, total)
  }

  @Test fun averagesPairs() {
    val out = StreamResampler(16000, 8000).process(shortArrayOf(100, 300, -50, -150))
    assertArrayEquals(shortArrayOf(200, -100), out)
  }

  @Test fun linearInterpolationIsContinuousAcrossChunks() {
    val r = StreamResampler(8000, 16000)
    val a = r.process(shortArrayOf(0, 100))   // saída: prev(0), 0, 0, 50
    val b = r.process(shortArrayOf(200, 300)) // continua: 100, 150, 200, 250
    assertArrayEquals(shortArrayOf(0, 0, 0, 50), a)
    assertArrayEquals(shortArrayOf(100, 150, 200, 250), b)
  }

  @Test fun toneSurvivesRoundTrip() {
    val down = StreamResampler(16000, 8000)
    val up = StreamResampler(8000, 16000)
    val src = tone(3200, 16000, 440.0)
    val out = up.process(down.process(src))
    assertEquals(src.size, out.size)
    val rIn = LevelMeter.rms(src, 400, 2400)
    val rOut = LevelMeter.rms(out, 400, 2400)
    assertTrue("rms $rIn -> $rOut", abs(rOut - rIn) / rIn < 0.1)
  }

  @Test fun sameRateIsPassthrough() {
    val src = shortArrayOf(1, 2, 3)
    assertArrayEquals(src, StreamResampler(16000, 16000).process(src))
  }
}

class OpusHeaderTest {
  @Test fun opusHeadLayout() {
    val h = OpusHeader.head()
    assertEquals(19, h.size)
    assertEquals("OpusHead", String(h, 0, 8, Charsets.US_ASCII))
    assertEquals(1, h[8].toInt())             // versão
    assertEquals(1, h[9].toInt())             // canais
    assertEquals(312, (h[10].toInt() and 0xff) or ((h[11].toInt() and 0xff) shl 8))
    val rate = (h[12].toInt() and 0xff) or ((h[13].toInt() and 0xff) shl 8) or
      ((h[14].toInt() and 0xff) shl 16) or ((h[15].toInt() and 0xff) shl 24)
    assertEquals(16000, rate)
    assertEquals(0, h[16].toInt()); assertEquals(0, h[17].toInt()) // ganho
    assertEquals(0, h[18].toInt())            // mapping family
  }

  @Test fun csdTimesInNanosecondsLittleEndian() {
    val csd = OpusHeader.csd()
    assertEquals(3, csd.size)
    assertEquals(6_500_000L, OpusHeader.codecDelayNs()) // 312 / 48000 s
    assertArrayEquals(byteArrayOf(0xA0.toByte(), 0x2E, 0x63, 0, 0, 0, 0, 0), csd[1])
    assertArrayEquals(byteArrayOf(0x00, 0xB4.toByte(), 0xC4.toByte(), 0x04, 0, 0, 0, 0), csd[2]) // 80 ms
  }
}

class JitterBufferTest {
  private fun JitterBuffer<String>.drain(n: Int) = List(n) {
    when (val o = pop()) {
      is JitterBuffer.Out.Frame -> o.item
      JitterBuffer.Out.Missing -> "-"
      JitterBuffer.Out.Silence -> "."
    }
  }

  @Test fun waitsForTargetThenPlaysInOrder() {
    val jb = JitterBuffer<String>()
    jb.push(1, "b")
    assertEquals(listOf("."), jb.drain(1))
    jb.push(0, "a")
    assertEquals(listOf("."), jb.drain(1))
    jb.push(2, "c")
    jb.push(3, "d")
    assertEquals(listOf("a", "b", "c", "d"), jb.drain(4))
  }

  @Test fun reordersOutOfOrderArrivals() {
    val jb = JitterBuffer<String>()
    listOf(2L to "c", 0L to "a", 3L to "d", 1L to "b").forEach { (s, v) -> jb.push(s, v) }
    assertEquals(listOf("a", "b", "c", "d"), jb.drain(4))
  }

  @Test fun lossBelowTargetBecomesSilence() {
    val jb = JitterBuffer<String>()
    (0L..2L).forEach { jb.push(it, "f$it") }
    assertEquals(listOf("f0"), jb.drain(1))
    jb.push(4, "f4")                        // 3 se perdeu; buffer: 1, 2, 4
    assertEquals(listOf("f1", "f2"), jb.drain(2))
    assertEquals(listOf("-", "f4"), jb.drain(2)) // só 1 guardado: 20 ms de silêncio no lugar do 3
    assertEquals(1L, jb.concealed)
  }

  @Test fun gapIsSkippedWhenBufferIsHealthy() {
    // Ping/pong comem números da sequência: com o buffer no alvo, o buraco não vira silêncio.
    val jb = JitterBuffer<String>()
    listOf(0L, 2L, 3L, 4L).forEach { jb.push(it, "f$it") }
    assertEquals(listOf("f0", "f2", "f3", "f4"), jb.drain(4))
    assertEquals(0L, jb.concealed)
  }

  @Test fun lateAndDuplicatePacketsAreDropped() {
    val jb = JitterBuffer<String>()
    (0L..3L).forEach { jb.push(it, "f$it") }
    assertEquals(listOf("f0", "f1"), jb.drain(2))
    jb.push(0, "late")
    jb.push(3, "dup")
    assertEquals(1L, jb.droppedLate)
    assertEquals(listOf("f2", "f3"), jb.drain(2))
  }

  @Test fun dropsOldestAbove200ms() {
    val jb = JitterBuffer<String>(target = 3, max = 10)
    (0L until 15L).forEach { jb.push(it, "f$it") }
    assertEquals(10, jb.size)
    assertEquals(5L, jb.droppedOverflow)
    assertEquals(listOf("f5", "f6"), jb.drain(2))
    jb.push(4, "old")                       // mais velho que o que já tocou
    assertEquals(listOf("f7"), jb.drain(1))
  }

  @Test fun underflowRebuffers() {
    val jb = JitterBuffer<String>()
    (0L..2L).forEach { jb.push(it, "f$it") }
    assertEquals(listOf("f0", "f1", "f2", "."), jb.drain(4))
    assertEquals(1L, jb.underflows)
    jb.push(3, "f3"); jb.push(4, "f4")
    assertEquals(listOf("."), jb.drain(1))  // enchendo de novo até o alvo
    jb.push(5, "f5")
    assertEquals(listOf("f3", "f4", "f5"), jb.drain(3))
  }

  @Test fun senderRestartResets() {
    val jb = JitterBuffer<String>()
    (1000L..1003L).forEach { jb.push(it, "x$it") }
    assertEquals(listOf("x1000"), jb.drain(1))
    (0L..2L).forEach { jb.push(it, "y$it") }
    assertEquals(listOf("y0", "y1", "y2"), jb.drain(3))
  }
}

class LevelMeterTest {
  private fun tone(amp: Double) = ShortArray(320) { (amp * sin(2 * PI * 440 * it / 16000)).toInt().toShort() }

  @Test fun rmsOfSine() {
    val r = LevelMeter.rms(tone(10000.0))
    assertTrue(abs(r - 10000 / Math.sqrt(2.0)) < 50)
  }

  @Test fun normalizeMapsDbRange() {
    val m = LevelMeter()
    assertEquals(0.0, m.normalize(0.0), 0.0)
    assertEquals(0.0, m.normalize(32768 * 1e-4), 1e-9) // -80 dB → 0
    assertEquals(1.0, m.normalize(32768.0), 0.0)       // 0 dB → 1
    assertEquals(0.5, m.normalize(32768 * Math.pow(10.0, -36.0 / 20)), 1e-6) // -36 dB, meio de -60..-12
  }

  @Test fun fastAttackSlowRelease() {
    val m = LevelMeter()
    val loud = tone(16000.0)
    m.update(loud)
    assertTrue("ataque ${m.value}", m.value > 0.8)
    repeat(20) { m.update(loud) }
    val top = m.value
    m.update(ShortArray(320))
    val after20ms = m.value
    assertTrue("queda lenta: $top -> $after20ms", after20ms > top * 0.8 && after20ms < top)
    repeat(30) { m.update(ShortArray(320)) } // ~600 ms depois
    assertTrue("quase zero ${m.value}", m.value < 0.05)
  }

  @Test fun resetGoesToZero() {
    val m = LevelMeter()
    m.update(tone(16000.0))
    m.reset()
    assertEquals(0f, m.value, 0f)
  }
}
