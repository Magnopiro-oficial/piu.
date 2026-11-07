package expo.modules.piuappshare

import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * Conferir o instalador do "Enviar o Piu" (auditoria 2026-11-06, B-03). Kotlin puro (sem Android),
 * para o cálculo poder ser testado fora do aparelho.
 */
internal object ApkIntegrity {
  private const val BUFFER = 256 * 1024

  fun hex(bytes: ByteArray): String {
    val digits = "0123456789abcdef"
    val out = StringBuilder(bytes.size * 2)
    for (b in bytes) { val v = b.toInt() and 0xff; out.append(digits[v ushr 4]).append(digits[v and 0x0f]) }
    return out.toString()
  }

  fun sha256(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))

  /** Em blocos de 256 KiB: o APK (~70 MB) nunca fica inteiro na memória. */
  fun sha256(input: InputStream): String {
    val md = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(BUFFER)
    while (true) {
      val n = input.read(buf)
      if (n < 0) break
      md.update(buf, 0, n)
    }
    return hex(md.digest())
  }

  fun sha256(file: File): String = file.inputStream().use { sha256(it) }
}

/**
 * Hash de um arquivo guardado por caminho + data de modificação + tamanho: o APK instalado só muda numa
 * atualização (aí o caminho/data mudam e o hash é refeito). Quem chama ao mesmo tempo espera o mesmo cálculo.
 */
internal class FileHashCache(private val hash: (File) -> String = ApkIntegrity::sha256) {
  private data class Stamp(val path: String, val modified: Long, val size: Long)
  private var stamp: Stamp? = null
  private var value: String? = null

  @Synchronized
  fun get(file: File): String {
    val s = Stamp(file.absolutePath, file.lastModified(), file.length())
    val cached = value
    if (s == stamp && cached != null) return cached
    val v = hash(file)
    stamp = s
    value = v
    return v
  }
}
