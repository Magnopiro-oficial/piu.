package expo.modules.piuvoice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenTokensTest {
  @Test fun soValeOQueFoiEmitido() {
    val t = OpenTokens()
    val a = t.issue("show", "call-1")
    assertEquals(32, a.length)
    assertTrue(t.consume(a, "show", "call-1"))
    // Outro app que abre a Activity com a ação "answer" não conhece a senha.
    assertFalse(t.consume(null, "answer", "call-1"))
    assertFalse(t.consume("", "answer", "call-1"))
    assertFalse(t.consume("0".repeat(32), "answer", "call-1"))
    assertNotEquals(a, t.issue("show", "call-1"))
  }

  @Test fun presaAAcaoEAChamada() {
    val t = OpenTokens()
    val show = t.issue("show", "call-1")
    // A senha do "tocar no aviso" não vira "Atender", nem vale para outra chamada.
    assertFalse(t.consume(show, "answer", "call-1"))
    assertFalse(t.consume(show, "show", "call-2"))
    assertTrue(t.consume(show, "show", "call-1"))
  }

  @Test fun atenderValeUmaVezSo() {
    val t = OpenTokens()
    val a = t.issue("answer", "call-1")
    assertTrue(t.consume(a, "answer", "call-1"))
    assertFalse("a Intent repetida não atende de novo", t.consume(a, "answer", "call-1"))
    // "Mostrar" pode ser tocado de novo (só abre a tela da chamada).
    val s = t.issue("show", "call-1")
    assertTrue(t.consume(s, "show", "call-1"))
    assertTrue(t.consume(s, "show", "call-1"))
  }

  @Test fun guardaSoAsUltimas() {
    val t = OpenTokens(max = 3)
    val first = t.issue("show", "c")
    repeat(3) { t.issue("show", "c") }
    assertFalse("a mais antiga sai", t.consume(first, "show", "c"))
  }

  @Test fun esquecerApagaTodas() {
    val t = OpenTokens()
    val a = t.issue("show", "c")
    t.clear()
    assertFalse(t.consume(a, "show", "c"))
  }
}
