package expo.modules.piunodelink

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

private const val MAX_BODY = 1024 * 1024

/**
 * HTTPS para o piu-node da rede local com o certificado autoassinado FIXADO pela impressão digital
 * SHA-256 que o console e o painel mostram. O pino substitui a cadeia de autoridades e a conferência
 * do nome (o nó é `piu-node.local` ou um IP). Sem redirecionamento, sem cookies automáticos.
 */
class PiuNodeLinkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PiuNodeLink")

    AsyncFunction("request") { url: String, method: String, headers: Map<String, String>, body: String?, pin: String, promise: Promise ->
      Thread {
        try {
          promise.resolve(send(url, method, headers, body, pin))
        } catch (e: Exception) {
          promise.reject(CodedException("ERR_NODE_LINK", e.message ?: "Falha na conexão com o equipamento.", e))
        }
      }.start()
    }
  }

  private fun send(url: String, method: String, headers: Map<String, String>, body: String?, pin: String): Map<String, Any> {
    if (!url.startsWith("https://")) throw IllegalArgumentException("Só HTTPS.")
    val expected = pin.replace(":", "").lowercase()
    if (expected.length != 64) throw IllegalArgumentException("Impressão digital inválida.")
    val trust = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
        throw CertificateException("Sem certificado de cliente.")
      }
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        val leaf = chain.firstOrNull() ?: throw CertificateException("O equipamento não mandou certificado.")
        val got = MessageDigest.getInstance("SHA-256").digest(leaf.encoded).joinToString("") { "%02x".format(it) }
        if (got != expected) throw CertificateException("A impressão digital do certificado não confere.")
      }
      override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }
    val ctx = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), SecureRandom()) }
    val client = OkHttpClient.Builder()
      .sslSocketFactory(ctx.socketFactory, trust)
      .hostnameVerifier { _, _ -> true }
      .followRedirects(false).followSslRedirects(false)
      .connectTimeout(8, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS)
      .build()
    val reqBody = body?.toRequestBody((headers["Content-Type"] ?: "application/json").toMediaType())
    val req = Request.Builder().url(url).method(method, if (method == "GET") null else (reqBody ?: ByteArray(0).toRequestBody(null)))
    headers.forEach { (k, v) -> req.header(k, v) }
    client.newCall(req.build()).execute().use { r ->
      val bytes = r.body?.byteStream()?.use { s -> s.readNBytesCompat(MAX_BODY + 1) } ?: ByteArray(0)
      if (bytes.size > MAX_BODY) throw IllegalStateException("Resposta grande demais.")
      val out = HashMap<String, String>()
      for (name in r.headers.names()) out[name] = r.headers(name).joinToString(", ")
      return mapOf("status" to r.code, "headers" to out, "body" to String(bytes, Charsets.UTF_8))
    }
  }
}

private fun java.io.InputStream.readNBytesCompat(max: Int): ByteArray {
  val buf = java.io.ByteArrayOutputStream()
  val chunk = ByteArray(8192)
  while (buf.size() < max) {
    val n = read(chunk, 0, minOf(chunk.size, max - buf.size()))
    if (n < 0) break
    buf.write(chunk, 0, n)
  }
  return buf.toByteArray()
}
