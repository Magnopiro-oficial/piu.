package expo.modules.piumeshtastic

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class NusTest {
  @Test fun pedacosCabemNoMtu() {
    val b = ByteArray(1100) { it.toByte() }
    val parts = Nus.chunks(b, mtu = 512)
    assertEquals(listOf(509, 509, 82), parts.map { it.size })
    assertArrayEquals(b, parts.reduce { a, x -> a + x })
    assertEquals(listOf(20, 5), Nus.chunks(ByteArray(25), mtu = 23).map { it.size })
    assertTrue(Nus.chunks(ByteArray(0), mtu = 512).isEmpty())
  }

  @Test fun mtuEstranhoNaoQuebraAEscrita() {
    // MTU zero ou negativo (callback com erro): 20 bytes, o mínimo do BLE.
    assertEquals(listOf(20, 20, 10), Nus.chunks(ByteArray(50), mtu = 0).map { it.size })
    assertEquals(listOf(20, 20, 10), Nus.chunks(ByteArray(50), mtu = -5).map { it.size })
    // Valor de atributo tem no máximo 512 bytes, mesmo que o MTU informado seja maior.
    assertEquals(listOf(512, 488), Nus.chunks(ByteArray(1000), mtu = 1000).map { it.size })
    val big = ByteArray(5000) { (it * 7).toByte() }
    assertArrayEquals(big, Nus.chunks(big, mtu = 247).reduce { a, x -> a + x })
  }

  @Test fun escritaComRespostaQuandoORadioAceita() {
    assertEquals(Nus.WRITE_DEFAULT, Nus.writeType(Nus.PROP_WRITE or Nus.PROP_WRITE_NR))
    assertEquals(Nus.WRITE_NO_RESPONSE, Nus.writeType(Nus.PROP_WRITE_NR))
    assertEquals(null, Nus.writeType(0x10))
  }

  @Test fun reconheceRNodePeloServicoOuPeloNome() {
    assertTrue(Nus.isRNode("", listOf(Nus.SERVICE)))
    assertTrue(Nus.isRNode("RNode 3F2A", emptyList()))
    assertFalse(Nus.isRNode("Meshtastic_a1b2", listOf(UUID.fromString("6ba1b218-15a8-461f-9fa8-5dcae273eafd"))))
    assertFalse(Nus.isRNode(null, emptyList()))
  }
}
