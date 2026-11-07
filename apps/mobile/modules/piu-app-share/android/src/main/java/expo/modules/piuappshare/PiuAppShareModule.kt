package expo.modules.piuappshare

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.wifi.WifiManager
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pGroup
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.concurrent.Semaphore
import kotlin.concurrent.thread

/** Provider próprio, para não colidir com o FileProvider de outras bibliotecas no manifesto. */
class PiuShareFileProvider : FileProvider()

private const val APK_TYPE = "application/vnd.android.package-archive"
/** Endereço do dono do grupo Wi-Fi Direct no Android quando o sistema não informa outro. */
private const val GO_IP = "192.168.49.1"
/** Conexões atendidas ao mesmo tempo (as duas páginas juntas). A rede do ponto é aberta a qualquer um: sem teto, uma thread por conexão esgotava o app. */
private const val MAX_CONN = 12
/** Maior linha de pedido aceita (`GET /Piu-0.1.1.apk HTTP/1.1` tem ~30 bytes); o resto do pedido nem é lido. */
private const val MAX_REQUEST_LINE = 1024
/** Nome do instalador: o que `apkShareName` gera (sem barra, aspas, CR/LF — vai no cabeçalho). */
private val SAFE_NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\\.apk$")
/** IPv4 escrito por extenso (sem nome: `getByName` resolveria DNS). */
private val IPV4 = Regex("^(0|[1-9]\\d{0,2})(\\.(0|[1-9]\\d{0,2})){3}$")
private const val SEC_HEADERS = "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'\r\n" +
  "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\nCache-Control: no-store\r\n"

/**
 * "Enviar o Piu" de celular para celular, sem loja e sem internet (regra 6.1):
 * - `shareApk`: compartilhamento do Android (Bluetooth, Quick Share).
 * - `startWifiShare`: rede Wi-Fi Direct com senha e uma página local que serve o instalador, só no
 *   endereço dessa rede (nunca na rede de casa). Fecha sozinha depois de `windowMs`.
 * O APK instalado (`sourceDir`) não pode ser entregue direto: vai uma cópia em cache/piu-share.
 */
class PiuAppShareModule : Module() {
  private var manager: WifiP2pManager? = null
  private var channel: WifiP2pManager.Channel? = null
  private var server: ServerSocket? = null
  private val main = Handler(Looper.getMainLooper())
  private val autoStop = Runnable { stopWifi() }
  private val apkHash = FileHashCache()
  private val slots = Semaphore(MAX_CONN)

  private fun ctx(): Context = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "Sem contexto do app.", null)

  /** Cópia do instalador para compartilhar; recusa o app instalado em partes (App Bundle da loja). */
  private fun apkCopy(ctx: Context, fileName: String): File {
    val info = ctx.applicationInfo
    if (!info.splitSourceDirs.isNullOrEmpty()) throw CodedException("ERR_SPLIT_APK", "Instalado em partes.", null)
    val dir = File(ctx.cacheDir, "piu-share").apply { mkdirs() }
    if (!SAFE_NAME.matches(fileName)) throw CodedException("ERR_SHARE", "Nome de arquivo inválido.", null)
    val out = File(dir, fileName)
    val src = File(info.sourceDir)
    // Também refaz a cópia se o app foi atualizado depois dela (mesmo tamanho, conteúdo novo): o arquivo
    // enviado tem de ser o instalado, que é o que `integrity` confere.
    if (out.length() != src.length() || out.lastModified() < src.lastModified()) {
      dir.listFiles()?.forEach { it.delete() } // só a cópia mais recente fica
      src.copyTo(out, overwrite = true)
    }
    return out
  }

  override fun definition() = ModuleDefinition {
    Name("PiuAppShare")

    OnDestroy { stopWifi(); stopLan() }

    /** Tamanho do instalador, para a página dizer quanto vai baixar. */
    Function("apkSize") { File(ctx().applicationInfo.sourceDir).length().toDouble() }

    /**
     * B-03: SHA-256 do instalador (o mesmo arquivo que `shareApk`/`startWifiShare` entregam) e de cada
     * certificado que assina o app instalado. AsyncFunction roda fora da thread principal; o hash do APK
     * fica em cache por caminho + data + tamanho.
     */
    AsyncFunction("integrity") {
      val ctx = ctx()
      val info = ctx.applicationInfo
      if (!info.splitSourceDirs.isNullOrEmpty()) throw CodedException("ERR_SPLIT_APK", "Instalado em partes.", null)
      mapOf("apkSha256" to apkHash.get(File(info.sourceDir)), "certSha256" to signingCerts(ctx).map { ApkIntegrity.sha256(it.toByteArray()) })
    }

    AsyncFunction("shareApk") { fileName: String, chooserTitle: String, promise: Promise ->
      try {
        val ctx = ctx()
        val out = apkCopy(ctx, fileName)
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.piushare", out)
        val send = Intent(Intent.ACTION_SEND).apply {
          type = APK_TYPE
          putExtra(Intent.EXTRA_STREAM, uri)
          clipData = ClipData.newRawUri(out.name, uri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(send, chooserTitle).apply { addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        val activity = appContext.currentActivity
        if (activity != null) activity.startActivity(chooser)
        else ctx.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        promise.resolve(null)
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: ActivityNotFoundException) {
        promise.reject(CodedException("ERR_NO_SHARE_TARGET", "Nenhum app para receber o arquivo.", e))
      } catch (e: Exception) {
        promise.reject(CodedException("ERR_SHARE", e.message ?: "Falha ao compartilhar.", e))
      }
    }

    AsyncFunction("startWifiShare") { fileName: String, pageHtml: String, port: Int, windowMs: Double, promise: Promise ->
      try {
        val ctx = ctx()
        val apk = apkCopy(ctx, fileName)
        val wifi = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        if (!wifi.isWifiEnabled) throw CodedException("ERR_WIFI_OFF", "Wi-Fi desligado.", null)
        val m = ctx.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager
          ?: throw CodedException("ERR_P2P_UNSUPPORTED", "Sem Wi-Fi Direct.", null)
        stopWifi()
        val ch = m.initialize(ctx, Looper.getMainLooper(), null)
        manager = m; channel = ch
        createGroup(m, ch, { group, ip ->
          try {
            startServer(ip, port, apk, pageHtml)
            main.postDelayed(autoStop, windowMs.toLong())
            promise.resolve(mapOf("ssid" to group.networkName, "passphrase" to (group.passphrase ?: ""), "ip" to ip, "port" to port))
          } catch (e: Exception) {
            stopWifi()
            promise.reject(CodedException("ERR_PORT", e.message ?: "Porta ocupada.", e))
          }
        }, { code -> stopWifi(); promise.reject(CodedException(code, "Não abriu a rede Wi-Fi Direct.", null)) })
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: SecurityException) {
        promise.reject(CodedException("ERR_NO_PERMISSION", "Sem permissão.", e))
      } catch (e: Exception) {
        promise.reject(CodedException("ERR_SHARE", e.message ?: "Falha ao abrir a rede.", e))
      }
    }

    AsyncFunction("stopWifiShare") { stopWifi() }

    /**
     * Página do ponto Piu (guardião + distribuição do app, P9): a MESMA página/instalador, mas na rede Wi-Fi
     * do ponto (ou no hotspot deste celular), só no IPv4 `ip` dessa rede, sem abrir Wi-Fi Direct e sem prazo
     * (fica enquanto o ponto estiver ativo). Independente do `startWifiShare`: as duas podem rodar juntas.
     * Erros: `ERR_SPLIT_APK`, `ERR_PORT`.
     */
    AsyncFunction("startLanShare") { fileName: String, pageHtml: String, ip: String, port: Int, promise: Promise ->
      try {
        // Só um IPv4 privado da rede do ponto (nunca 0.0.0.0/todas as interfaces, loopback ou público).
        val addr = if (IPV4.matches(ip)) InetAddress.getByName(ip) else null
        if (addr !is Inet4Address || !addr.isSiteLocalAddress) throw CodedException("ERR_BIND", "Endereço fora da rede local.", null)
        if (port !in 1024..65535) throw CodedException("ERR_PORT", "Porta inválida.", null)
        val apk = apkCopy(ctx(), fileName)
        stopLan()
        val s = ServerSocket(port, 8, addr)
        lanServer = s
        thread(name = "piu-point-page", isDaemon = true) { acceptLoop(s, apk, pageHtml) }
        promise.resolve(mapOf("ip" to ip, "port" to s.localPort))
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Exception) {
        stopLan()
        promise.reject(CodedException("ERR_PORT", e.message ?: "Porta ocupada.", e))
      }
    }

    AsyncFunction("stopLanShare") { stopLan() }
  }

  /** Servidor da página do ponto (independente do Wi-Fi Direct). */
  private var lanServer: ServerSocket? = null

  private fun stopLan() {
    try { lanServer?.close() } catch (_: Exception) {}
    lanServer = null
  }

  /** Certificados de assinatura do app instalado (os atuais, sem o histórico de rotação). */
  @Suppress("DEPRECATION")
  private fun signingCerts(ctx: Context): List<Signature> {
    val pm = ctx.packageManager
    val sigs: Array<Signature>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
    } else {
      pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNATURES).signatures
    }
    return sigs?.toList() ?: emptyList()
  }

  private fun reasonCode(reason: Int) = when (reason) {
    WifiP2pManager.P2P_UNSUPPORTED -> "ERR_P2P_UNSUPPORTED"
    WifiP2pManager.BUSY -> "ERR_P2P_BUSY"
    else -> "ERR_SHARE"
  }

  /** Grupo com nome `DIRECT-Pi-XXXX` e senha nova a cada vez (Android 10+); antes, os do sistema. */
  @SuppressLint("MissingPermission")
  private fun createGroup(m: WifiP2pManager, ch: WifiP2pManager.Channel, ok: (WifiP2pGroup, String) -> Unit, fail: (String) -> Unit) {
    val listener = object : WifiP2pManager.ActionListener {
      override fun onSuccess() = readGroup(m, ch, 0, ok, fail)
      override fun onFailure(reason: Int) = fail(reasonCode(reason))
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val rnd = SecureRandom()
        val tag = (1..4).map { "0123456789ABCDEF"[rnd.nextInt(16)] }.joinToString("")
        val pass = (1..10).map { "abcdefghjkmnpqrstuvwxyz23456789"[rnd.nextInt(31)] }.joinToString("")
        val config = WifiP2pConfig.Builder().setNetworkName("DIRECT-Pi-Piu-$tag").setPassphrase(pass).build()
        m.createGroup(ch, config, listener)
      } else {
        m.createGroup(ch, listener)
      }
    } catch (e: SecurityException) {
      fail("ERR_NO_PERMISSION")
    }
  }

  /** O grupo demora um pouco para ficar pronto: tenta por ~6 s. */
  @SuppressLint("MissingPermission")
  private fun readGroup(m: WifiP2pManager, ch: WifiP2pManager.Channel, tries: Int, ok: (WifiP2pGroup, String) -> Unit, fail: (String) -> Unit) {
    try {
      m.requestGroupInfo(ch) { group ->
        if (group != null && group.isGroupOwner) {
          m.requestConnectionInfo(ch) { info -> ok(group, info?.groupOwnerAddress?.hostAddress ?: GO_IP) }
        } else if (tries < 20) {
          main.postDelayed({ readGroup(m, ch, tries + 1, ok, fail) }, 300)
        } else fail("ERR_SHARE")
      }
    } catch (e: SecurityException) {
      fail("ERR_NO_PERMISSION")
    }
  }

  /** HTTP só no IP da rede Wi-Fi Direct: `/` é a página e `/<arquivo>` o instalador. Nada mais. */
  private fun startServer(ip: String, port: Int, apk: File, pageHtml: String) {
    val s = ServerSocket(port, 8, InetAddress.getByName(ip))
    server = s
    thread(name = "piu-apk-server", isDaemon = true) { acceptLoop(s, apk, pageHtml) }
  }

  /** Uma thread por conexão, no máximo `MAX_CONN` juntas; acima disso a conexão é fechada na hora. */
  private fun acceptLoop(s: ServerSocket, apk: File, pageHtml: String) {
    while (!s.isClosed) {
      val c = try { s.accept() } catch (e: Exception) { break }
      if (!slots.tryAcquire()) { try { c.close() } catch (_: Exception) {}; continue }
      thread(isDaemon = true) {
        try { serve(c, apk, pageHtml) } catch (_: Exception) {} finally { slots.release() }
      }
    }
  }

  /** Primeira linha do pedido, até `MAX_REQUEST_LINE` bytes; mais longa (ou sem fim) = `null`. */
  private fun requestLine(input: InputStream): String? {
    val buf = ByteArray(MAX_REQUEST_LINE)
    var n = 0
    while (n < MAX_REQUEST_LINE) {
      val b = input.read()
      if (b < 0) return null
      if (b == '\n'.code) return String(buf, 0, n, Charsets.US_ASCII).trimEnd('\r')
      buf[n++] = b.toByte()
    }
    return null
  }

  /** Só `GET /` (a página) e `GET /<arquivo>` (o instalador); caminho comparado por igualdade, sem arquivo do disco. */
  private fun serve(c: Socket, apk: File, pageHtml: String) {
    c.use { sock ->
      sock.soTimeout = 15_000
      val line = requestLine(sock.getInputStream()) ?: return
      val parts = line.split(" ")
      val path = if (parts.size >= 2 && parts[0] == "GET") parts[1].substringBefore('?') else ""
      val out = sock.getOutputStream()
      when (path) {
        "/" -> {
          val body = pageHtml.toByteArray(Charsets.UTF_8)
          out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\n" +
            SEC_HEADERS + "Connection: close\r\n\r\n").toByteArray())
          out.write(body)
        }
        "/${apk.name}" -> {
          out.write(("HTTP/1.1 200 OK\r\nContent-Type: $APK_TYPE\r\nContent-Length: ${apk.length()}\r\n" +
            "Content-Disposition: attachment; filename=\"${apk.name}\"\r\n" + SEC_HEADERS + "Connection: close\r\n\r\n").toByteArray())
          apk.inputStream().use { it.copyTo(out, 64 * 1024) }
        }
        else -> out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n".toByteArray())
      }
      out.flush()
    }
  }

  private fun stopWifi() {
    main.removeCallbacks(autoStop)
    try { server?.close() } catch (_: Exception) {}
    server = null
    val m = manager; val ch = channel
    if (m != null && ch != null) {
      try { m.removeGroup(ch, null) } catch (_: Exception) {}
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) ch.close()
    }
    manager = null; channel = null
  }
}
