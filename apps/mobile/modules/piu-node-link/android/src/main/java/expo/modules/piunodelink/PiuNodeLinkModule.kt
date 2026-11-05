package expo.modules.piunodelink

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

private const val MAX_BODY = 1024 * 1024
/** Mesmo teto de quadro do vínculo (lib/desktopLink.ts, MAX_FRAME_BYTES, em base64url). */
private const val MAX_WS_TEXT = 6 * 1024 * 1024

/**
 * HTTPS e WebSocket (wss) para equipamentos da rede local com o certificado autoassinado FIXADO pela
 * impressão digital SHA-256 (piu-node: console/painel; Piu Desktop: o QR). O pino substitui a cadeia
 * de autoridades e a conferência do nome (o host é `piu-node.local` ou um IP). Sem redirecionamento,
 * sem cookies automáticos.
 */
class PiuNodeLinkModule : Module() {
  private val sockets = ConcurrentHashMap<Int, WebSocket>()
  /** Ids cuja sessão JS ainda está viva (recebem eventos). */
  private val alive: MutableSet<Int> = ConcurrentHashMap.newKeySet()
  private val nextId = AtomicInteger(1)

  override fun definition() = ModuleDefinition {
    Name("PiuNodeLink")

    Events("onWsOpen", "onWsMessage", "onWsClose", "onWsError")

    AsyncFunction("request") { url: String, method: String, headers: Map<String, String>, body: String?, pin: String, promise: Promise ->
      Thread {
        try {
          promise.resolve(send(url, method, headers, body, pin))
        } catch (e: Exception) {
          promise.reject(CodedException("ERR_NODE_LINK", e.message ?: "Falha na conexão com o equipamento.", e))
        }
      }.start()
    }

    // WebSocket com o mesmo pino: `wsOpen` devolve o id; o resto vem pelos eventos.
    // WebSocket com o mesmo pino: `wsOpen` devolve o id ANTES de conectar (o `onWsOpen` pode chegar
    // antes de a promise atravessar a ponte); o resto vem pelos eventos.
    AsyncFunction("wsOpen") { url: String, pin: String, promise: Promise ->
      if (!url.startsWith("wss://")) { promise.reject(CodedException("ERR_NODE_LINK", "Só wss://.", null)); return@AsyncFunction }
      val client = try {
        pinnedClient(pin).newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).pingInterval(20, TimeUnit.SECONDS).build()
      } catch (e: Exception) {
        promise.reject(CodedException("ERR_NODE_LINK", e.message ?: "Falha ao abrir a conexão.", e)); return@AsyncFunction
      }
      val id = nextId.getAndIncrement()
      alive.add(id)
      promise.resolve(id)
      try {
        val ws = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
          override fun onOpen(webSocket: WebSocket, response: Response) { if (alive.contains(id)) sendEvent("onWsOpen", mapOf("id" to id)) }
          override fun onMessage(webSocket: WebSocket, text: String) {
            if (text.length > MAX_WS_TEXT) { webSocket.close(1009, "frame too large"); return }
            if (alive.contains(id)) sendEvent("onWsMessage", mapOf("id" to id, "data" to text))
          }
          // O vínculo só usa texto: quadro binário é erro de protocolo.
          override fun onMessage(webSocket: WebSocket, bytes: ByteString) { webSocket.close(1003, "text only") }
          override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
          override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            sockets.remove(id)
            if (alive.remove(id)) sendEvent("onWsClose", mapOf("id" to id, "code" to code, "reason" to reason))
          }
          override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            sockets.remove(id)
            if (alive.remove(id)) {
              val cert = t is javax.net.ssl.SSLException || t.cause is CertificateException
              sendEvent("onWsError", mapOf("id" to id, "message" to (if (cert) "A impressão digital do certificado não confere." else (t.message ?: "Falha na conexão."))))
            }
          }
        })
        sockets[id] = ws
      } catch (e: Exception) {
        if (alive.remove(id)) sendEvent("onWsError", mapOf("id" to id, "message" to (e.message ?: "Falha ao abrir a conexão.")))
      }
    }

    Function("wsSend") { id: Int, text: String -> sockets[id]?.send(text) ?: false }

    // Fechar pelo JS não gera evento (quem fechou já sabe).
    Function("wsClose") { id: Int, code: Int, reason: String ->
      alive.remove(id)
      sockets.remove(id)?.close(if (code in 1000..4999) code else 1000, reason.take(120))
    }

    OnDestroy {
      alive.clear()
      for ((_, ws) in sockets) ws.cancel()
      sockets.clear()
    }
  }

  /** Cliente que aceita só o certificado com este SHA-256 (`AA:BB:…` ou hex corrido). */
  private fun pinnedClient(pin: String): OkHttpClient {
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
    return OkHttpClient.Builder()
      .sslSocketFactory(ctx.socketFactory, trust)
      .hostnameVerifier { _, _ -> true }
      .followRedirects(false).followSslRedirects(false)
      .connectTimeout(8, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS)
      .build()
  }

  private fun send(url: String, method: String, headers: Map<String, String>, body: String?, pin: String): Map<String, Any> {
    if (!url.startsWith("https://")) throw IllegalArgumentException("Só HTTPS.")
    val client = pinnedClient(pin)
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
