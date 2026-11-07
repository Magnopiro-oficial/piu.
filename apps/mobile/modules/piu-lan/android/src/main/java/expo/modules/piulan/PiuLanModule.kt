package expo.modules.piulan

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.core.os.bundleOf
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.net.BindException
import java.net.ConnectException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.NoRouteToHostException
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

private class NoWifiException : CodedException("ERR_NO_WIFI", "Sem Wi-Fi: a rede local só funciona conectado a uma rede Wi-Fi.", null)
private class NotRunningException : CodedException("ERR_NOT_RUNNING", "A rede local não está ligada.", null)
private class BusyException : CodedException("ERR_BUSY", "Conexões demais abertas.", null)

/** Maior quadro antes do handshake (o TypeScript sobe o teto depois, com `setFrameLimit`). */
private const val HANDSHAKE_MAX = 4096
/** Teto absoluto de um quadro: registro LNNP de 64 KiB + 20 bytes de cifra. */
private const val FRAME_HARD_MAX = 64 * 1024 + 20
/** Bytes esperando para sair numa conexão; acima disso o vizinho não está lendo e a conexão fecha. */
private const val MAX_QUEUED_BYTES = 512L * 1024
/** Datagrama maior que isto não é anúncio LNNP (18 bytes): nem sobe para o TypeScript. */
private const val MAX_DATAGRAM = 64
/** Anúncios repassados ao TypeScript por segundo (inundação de UDP não trava a ponte). */
private const val MAX_DATAGRAMS_PER_SEC = 100
private const val MDNS_TYPE = "_piu._udp"
private const val MAX_MDNS_QUEUE = 32
private const val MAX_MDNS_RESOLVES_PER_MIN = 30

/**
 * Rede local do Piu no Android (docs/rede/pontos-piu-roteadores.md, fase 1): só soquetes. O LNNP
 * (handshake, cifra, descoberta, limites) fica em TypeScript (src/transport/lan/engine.ts), o mesmo
 * código do Piu Desktop e do piu-node.
 *
 * - UDP da descoberta e conexões TCP de saída presos à rede Wi-Fi (`Network.bindSocket` /
 *   `Network.socketFactory`), mesmo quando o Wi-Fi não tem internet e os dados móveis são a rota padrão.
 * - Servidor TCP escutando SÓ no IPv4 do Wi-Fi (nada exposto nos dados móveis).
 * - Enquadramento u32 + quadro e teto de tamanho por conexão aqui; conexões com teto.
 * - mDNS/DNS-SD `_piu._udp` com o NsdManager (resoluções em fila, com ritmo).
 * - MulticastLock só enquanto a rede local está ligada.
 * Tudo fora da thread principal; eventos para o JS. Com o Modo nó em segundo plano, o serviço em primeiro
 * plano do piu-transport (PiuRelayService) mantém o processo, e estes soquetes, vivos.
 */
class PiuLanModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val cm: ConnectivityManager by lazy { context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }
  private val wifiManager: WifiManager by lazy { context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager }
  private val io: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "piu-lan").apply { isDaemon = true } }

  @Volatile private var running = false
  @Volatile private var wifi: Network? = null
  private var udp: DatagramSocket? = null
  private var server: ServerSocket? = null
  private var multicastLock: WifiManager.MulticastLock? = null
  @Volatile private var maxConnections = 32
  private val conns = ConcurrentHashMap<Int, Conn>()
  private val nextId = AtomicInteger(1)
  private var netCallback: ConnectivityManager.NetworkCallback? = null
  /** Contagem de datagramas no segundo atual (teto de repasse). */
  private var udpWindow = 0L
  private var udpCount = 0

  // ── mDNS ──
  private val nsd: NsdManager by lazy { context.getSystemService(Context.NSD_SERVICE) as NsdManager }
  private var registration: NsdManager.RegistrationListener? = null
  private var discovery: NsdManager.DiscoveryListener? = null
  private val resolveQueue = ArrayDeque<NsdServiceInfo>()
  private var resolving = false
  private var retryScheduled = false
  private val resolveTimes = ArrayDeque<Long>()

  // ── Pontos Piu (fase 2): hotspot local deste celular e rede do ponto como visitante ──
  private class Hotspot(val addr: Inet4Address, val prefix: Int, val ssid: String?, val passphrase: String?)
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var hotspot: Hotspot? = null
  private var reservation: WifiManager.LocalOnlyHotspotReservation? = null
  /** O LAN está ligado na interface do hotspot (sem `Network` do sistema: soquetes comuns). */
  @Volatile private var hotspotMode = false
  /** Rede do ponto pedida pelo app como visitante (`WifiNetworkSpecifier`): só local, não troca a internet. */
  @Volatile private var joined: Network? = null
  private var joinCallback: ConnectivityManager.NetworkCallback? = null

  private inner class Conn(val id: Int, val socket: Socket) {
    @Volatile var limit = HANDSHAKE_MAX
    @Volatile var closed = false
    val queued = AtomicLong(0)
    val writer: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "piu-lan-w$id").apply { isDaemon = true } }
    private val out = DataOutputStream(BufferedOutputStream(socket.getOutputStream()))

    fun write(bytes: ByteArray) {
      if (closed) return
      if (queued.addAndGet(bytes.size.toLong()) > MAX_QUEUED_BYTES) { closeConn(id, "vizinho não está lendo"); return }
      writer.execute {
        try {
          out.writeInt(bytes.size); out.write(bytes); out.flush()
        } catch (e: Exception) { closeConn(id, e.message ?: "erro de escrita") }
        finally { queued.addAndGet(-bytes.size.toLong()) }
      }
    }

    fun startReader() = io.execute {
      val inp = DataInputStream(BufferedInputStream(socket.getInputStream()))
      try {
        while (!closed) {
          val n = inp.readInt()
          if (n <= 0 || n > limit) { closeConn(id, "quadro grande demais"); return@execute }
          val buf = ByteArray(n)
          inp.readFully(buf)
          sendEvent("onFrame", bundleOf("id" to id, "data" to Base64.encodeToString(buf, Base64.NO_WRAP)))
        }
      } catch (_: EOFException) { closeConn(id, "fechada pelo outro lado") }
      catch (e: Exception) { closeConn(id, e.message ?: "erro de leitura") }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("PiuLan")
    Events("onUdp", "onAccept", "onFrame", "onClose", "onNetwork", "onMdns", "onHotspot", "onJoin")

    // O Wi-Fi é observado enquanto o JS escuta (é o que decide ligar a rede local).
    OnStartObserving { watchNetwork(true) }
    OnStopObserving { watchNetwork(false) }

    AsyncFunction("networkInfo") { networkInfo() }

    AsyncFunction("start") { tcpPort: Int, udpPort: Int, maxConns: Int, promise: Promise ->
      io.execute {
        try { promise.resolve(startAll(tcpPort, udpPort, maxConns)) }
        catch (e: CodedException) { stopAll(); promise.reject(e) }
        catch (e: Exception) { stopAll(); promise.reject(CodedException("ERR_START", e.message ?: "Falha ao ligar a rede local.", e)) }
      }
    }

    AsyncFunction("stop") { stopAll() }

    Function("udpSend") { host: String, port: Int, data: String ->
      val sock = udp ?: return@Function Unit
      val bytes = Base64.decode(data, Base64.NO_WRAP)
      io.execute { try { sock.send(DatagramPacket(bytes, bytes.size, InetAddress.getByName(host), port)) } catch (_: Exception) { /* rede saiu */ } }
      Unit
    }

    AsyncFunction("connect") { host: String, port: Int, timeoutMs: Int, promise: Promise ->
      io.execute {
        try {
          if (!running) throw NotRunningException()
          if (conns.size >= maxConnections) throw BusyException()
          val s = if (hotspotMode) Socket() else (wifi ?: throw NoWifiException()).socketFactory.createSocket()
          try {
            s.connect(InetSocketAddress(InetAddress.getByName(host), port), timeoutMs.coerceIn(200, 15_000))
          } catch (e: Exception) { try { s.close() } catch (_: Exception) {}; throw e }
          promise.resolve(register(s))
        } catch (e: CodedException) { promise.reject(e) }
        catch (e: Exception) { promise.reject(CodedException("ERR_CONNECT", reasonOf(e), e)) }
      }
    }

    Function("send") { id: Int, data: String ->
      val c = conns[id] ?: throw CodedException("ERR_CLOSED", "Conexão fechada.", null)
      c.write(Base64.decode(data, Base64.NO_WRAP))
    }

    Function("setFrameLimit") { id: Int, max: Int -> conns[id]?.limit = max.coerceIn(1, FRAME_HARD_MAX); Unit }

    Function("close") { id: Int -> closeConn(id, "fechada por este aparelho"); Unit }

    AsyncFunction("probe") { host: String, port: Int, timeoutMs: Int, promise: Promise ->
      io.execute {
        val net = wifi
        if (net == null && !hotspotMode) { promise.resolve("unreachable"); return@execute }
        val s = try { if (net == null) Socket() else net.socketFactory.createSocket() } catch (_: Exception) { promise.resolve("error"); return@execute }
        val r = try {
          s.connect(InetSocketAddress(InetAddress.getByName(host), port), timeoutMs.coerceIn(200, 10_000)); "open"
        } catch (e: Exception) { probeResult(e) }
        finally { try { s.close() } catch (_: Exception) {} }
        promise.resolve(r)
      }
    }

    Function("mdnsStart") { name: String, udpPort: Int, txt: Map<String, String> -> io.execute { mdnsStart(name, udpPort, txt) }; Unit }
    Function("mdnsStop") { io.execute { mdnsStop() }; Unit }

    // ── Pontos Piu ──────────────────────────────────────────
    /**
     * Redes Wi-Fi por perto (P3): resultados da última varredura do sistema (e pede uma nova, que o
     * Android limita). Só nome, sinal e se tem senha. Android 13+: NEARBY_WIFI_DEVICES (neverForLocation);
     * antes: localização precisa e a localização do aparelho ligada. Erro: `ERR_NO_PERMISSION`.
     */
    AsyncFunction("wifiScan") { promise: Promise ->
      io.execute {
        try {
          @Suppress("DEPRECATION") try { wifiManager.startScan() } catch (_: Exception) {}
          val list = wifiManager.scanResults.mapNotNull { r ->
            @Suppress("DEPRECATION") val ssid = r.SSID?.trim('"')
            if (ssid.isNullOrBlank() || ssid == "<unknown ssid>") return@mapNotNull null
            val cap = r.capabilities ?: ""
            val secure = listOf("WPA", "WEP", "SAE", "PSK", "EAP").any { cap.contains(it) }
            mapOf("ssid" to ssid, "level" to r.level, "secure" to secure)
          }
          promise.resolve(list)
        } catch (e: SecurityException) { promise.reject(CodedException("ERR_NO_PERMISSION", "Sem permissão para ver as redes Wi-Fi.", e)) }
        catch (e: Exception) { promise.reject(CodedException("ERR_SCAN", e.message ?: "Falha ao ver as redes Wi-Fi.", e)) }
      }
    }

    /** Nome do Wi-Fi conectado, se o sistema mostrar (precisa de localização; senão `null`). Nunca a senha. */
    AsyncFunction("currentSsid") {
      try {
        @Suppress("DEPRECATION") val s = wifiManager.connectionInfo?.ssid?.trim('"')
        if (s.isNullOrBlank() || s == "<unknown ssid>") null else s
      } catch (_: Exception) { null }
    }

    /**
     * "Criar a rede neste celular" (forma B): hotspot local do Android (LocalOnlyHotspot, 8+), sem internet.
     * O sistema escolhe o nome e a senha; o app só os lê para o QR. Enquanto o hotspot estiver ligado, o
     * LAN do Piu usa a interface dele. Erros: `ERR_UNSUPPORTED`, `ERR_NO_PERMISSION`, `ERR_HOTSPOT_BUSY`
     * (já existe um, ou o roteador do celular está ligado), `ERR_HOTSPOT_<código>`.
     */
    AsyncFunction("startHotspot") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) { promise.reject(CodedException("ERR_UNSUPPORTED", "Hotspot local precisa do Android 8.", null)); return@AsyncFunction }
      hotspot?.let { promise.resolve(hotspotMap(it)); return@AsyncFunction }
      main.post {
        try {
          wifiManager.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
            override fun onStarted(r: WifiManager.LocalOnlyHotspotReservation) {
              reservation = r
              var ssid: String? = null
              var pass: String? = null
              try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                  val c = r.softApConfiguration
                  @Suppress("DEPRECATION") run { ssid = c.ssid?.trim('"'); pass = c.passphrase }
                } else {
                  @Suppress("DEPRECATION") val c = r.wifiConfiguration
                  @Suppress("DEPRECATION") run { ssid = c?.SSID?.trim('"'); pass = c?.preSharedKey?.trim('"') }
                }
              } catch (_: Exception) {}
              // A interface do hotspot sobe logo depois do aviso: procura o IPv4 dela por até ~4 s.
              io.execute {
                var addr: Pair<Inet4Address, Int>? = null
                for (i in 0 until 20) { addr = hotspotAddress(); if (addr != null) break; try { Thread.sleep(200) } catch (_: InterruptedException) { break } }
                if (addr == null) {
                  try { r.close() } catch (_: Exception) {}
                  reservation = null
                  promise.reject(CodedException("ERR_HOTSPOT_IFACE", "O hotspot ligou, mas a rede dele não apareceu.", null))
                  return@execute
                }
                val h = Hotspot(addr.first, addr.second, ssid, pass)
                hotspot = h
                emitNetwork()
                try { sendEvent("onHotspot", hotspotMap(h)) } catch (_: Exception) {}
                promise.resolve(hotspotMap(h))
              }
            }
            override fun onStopped() { clearHotspot() }
            override fun onFailed(reason: Int) {
              val code = if (reason == WifiManager.LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE) "ERR_HOTSPOT_BUSY" else "ERR_HOTSPOT_$reason"
              promise.reject(CodedException(code, "O Android não abriu o hotspot local ($reason).", null))
            }
          }, main)
        } catch (e: SecurityException) { promise.reject(CodedException("ERR_NO_PERMISSION", "Sem permissão para abrir o hotspot local.", e)) }
        catch (e: IllegalStateException) { promise.reject(CodedException("ERR_HOTSPOT_BUSY", e.message ?: "Já existe um hotspot local deste app.", e)) }
        catch (e: Exception) { promise.reject(CodedException("ERR_HOTSPOT", e.message ?: "Falha ao abrir o hotspot local.", e)) }
      }
    }

    AsyncFunction("stopHotspot") {
      try { reservation?.close() } catch (_: Exception) {}
      clearHotspot()
    }

    AsyncFunction("hotspotInfo") { hotspot?.let { hotspotMap(it) } }

    /**
     * Visitante (P8): entra na rede do ponto só para o Piu (Android 10+, `WifiNetworkSpecifier`): o sistema
     * pergunta à pessoa, a rede fica sem internet e não troca a internet do celular. Resolve quando conecta.
     * Erros: `ERR_UNSUPPORTED`, `ERR_JOIN_UNAVAILABLE` (recusado ou fora do alcance), `ERR_NO_PERMISSION`.
     */
    AsyncFunction("joinNetwork") { ssid: String, password: String?, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { promise.reject(CodedException("ERR_UNSUPPORTED", "Entrar no ponto pelo app precisa do Android 10.", null)); return@AsyncFunction }
      leaveJoined()
      try {
        val spec = WifiNetworkSpecifier.Builder().setSsid(ssid).apply { if (!password.isNullOrEmpty()) setWpa2Passphrase(password) }.build()
        val req = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
          .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).setNetworkSpecifier(spec).build()
        var settled = false
        val cb = object : ConnectivityManager.NetworkCallback() {
          override fun onAvailable(network: Network) {
            joined = network
            emitNetwork()
            try { sendEvent("onJoin", bundleOf("state" to "joined", "ssid" to ssid)) } catch (_: Exception) {}
            if (!settled) { settled = true; promise.resolve(null) }
          }
          override fun onUnavailable() {
            if (!settled) { settled = true; promise.reject(CodedException("ERR_JOIN_UNAVAILABLE", "Não deu para entrar na rede do ponto.", null)) }
          }
          override fun onLost(network: Network) {
            if (joined == network) { joined = null; emitNetwork(); try { sendEvent("onJoin", bundleOf("state" to "lost", "ssid" to ssid)) } catch (_: Exception) {} }
          }
        }
        joinCallback = cb
        cm.requestNetwork(req, cb, 60_000)
      } catch (e: SecurityException) { promise.reject(CodedException("ERR_NO_PERMISSION", "Sem permissão para entrar na rede.", e)) }
      catch (e: Exception) { promise.reject(CodedException("ERR_JOIN", e.message ?: "Falha ao entrar na rede do ponto.", e)) }
    }

    AsyncFunction("leaveNetwork") { leaveJoined() }

    OnDestroy {
      stopAll()
      watchNetwork(false)
      leaveJoined()
      try { reservation?.close() } catch (_: Exception) {}
      reservation = null; hotspot = null
      io.shutdownNow()
    }
  }

  // ── Wi-Fi ─────────────────────────────────────────────────
  private fun linkV4(lp: LinkProperties) = lp.linkAddresses.firstOrNull { it.address is Inet4Address && !it.address.isLoopbackAddress }

  /** A rede Wi-Fi conectada (com ou sem internet). A rede do ponto pedida como visitante tem preferência. */
  private fun findWifi(): Network? {
    joined?.let { j -> val lp = cm.getLinkProperties(j); if (lp != null && linkV4(lp) != null) return j }
    @Suppress("DEPRECATION")
    for (n in cm.allNetworks) {
      val caps = cm.getNetworkCapabilities(n) ?: continue
      if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue
      val lp = cm.getLinkProperties(n) ?: continue
      if (linkV4(lp) != null) return n
    }
    return null
  }

  private fun networkInfo(): Map<String, Any?> {
    // Hotspot deste celular ligado (e sem rede de ponto como visitante): a "rede local" é a dele, sem internet.
    val h = hotspot
    if (h != null && joined == null) {
      val ip = h.addr.hostAddress
      return mapOf("connected" to true, "internet" to false, "ip" to ip, "prefix" to h.prefix, "gateway" to ip, "hotspot" to true)
    }
    val n = findWifi()
    if (running && n != null) wifi = n
    val caps = n?.let { cm.getNetworkCapabilities(it) }
    val lp = n?.let { cm.getLinkProperties(it) }
    val la = lp?.let { linkV4(it) }
    val gw = lp?.routes?.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway?.hostAddress
    val internet = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    return mapOf(
      "connected" to (la != null), "internet" to internet,
      "ip" to la?.address?.hostAddress, "prefix" to la?.prefixLength, "gateway" to gw,
    )
  }

  private fun emitNetwork() { try { sendEvent("onNetwork", networkInfo()) } catch (_: Exception) {} }

  @Synchronized
  private fun watchNetwork(on: Boolean) {
    if (on && netCallback == null) {
      // Sem NET_CAPABILITY_INTERNET: o ponto Piu é, de propósito, uma rede Wi-Fi sem internet.
      val req = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
      val cb = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = emitNetwork()
        override fun onLost(network: Network) { if (wifi == network) wifi = null; emitNetwork() }
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = emitNetwork()
        override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) = emitNetwork()
      }
      try { cm.registerNetworkCallback(req, cb); netCallback = cb } catch (_: Exception) { /* sem permissão de estado da rede */ }
    } else if (!on) {
      netCallback?.let { try { cm.unregisterNetworkCallback(it) } catch (_: Exception) {} }
      netCallback = null
    }
  }

  // ── ligar / desligar ──────────────────────────────────────
  @Synchronized
  private fun startAll(tcpPort: Int, udpPort: Int, maxConns: Int): Map<String, Any?> {
    if (running) return mapOf("tcpPort" to (server?.localPort ?: 0), "udpPort" to (udp?.localPort ?: 0))
    maxConnections = maxConns.coerceIn(4, 128)
    val h = hotspot
    if (h != null && joined == null) return startOnHotspot(h, tcpPort, udpPort)
    val net = findWifi() ?: throw NoWifiException()
    val la = cm.getLinkProperties(net)?.let { linkV4(it) } ?: throw NoWifiException()
    hotspotMode = false
    wifi = net

    multicastLock = wifiManager.createMulticastLock("piu-lan").apply { setReferenceCounted(false); acquire() }

    // Servidor TCP só no IPv4 do Wi-Fi. Porta ocupada (outro app): uma livre — o anúncio leva a porta real.
    val srv = ServerSocket()
    srv.reuseAddress = true
    try { srv.bind(InetSocketAddress(la.address, tcpPort), 16) } catch (_: BindException) { srv.bind(InetSocketAddress(la.address, 0), 16) }
    server = srv

    // UDP da descoberta em todas as interfaces (broadcast só chega assim), preso ao Wi-Fi para enviar.
    val ds = DatagramSocket(null)
    ds.reuseAddress = true
    ds.broadcast = true
    try { ds.bind(InetSocketAddress(udpPort)) } catch (_: BindException) { ds.bind(InetSocketAddress(0)) }
    net.bindSocket(ds)
    udp = ds
    running = true

    io.execute { acceptLoop(srv) }
    io.execute { udpLoop(ds) }
    return mapOf("tcpPort" to srv.localPort, "udpPort" to ds.localPort)
  }

  /**
   * LAN na interface do hotspot deste celular: não há `Network` do sistema para ela (o celular é o ponto
   * de acesso), então os soquetes são comuns, o servidor TCP escuta só no IPv4 do hotspot e o UDP sai
   * pela rota da sub-rede dele (o anúncio vai para o broadcast dessa sub-rede).
   */
  private fun startOnHotspot(h: Hotspot, tcpPort: Int, udpPort: Int): Map<String, Any?> {
    wifi = null
    hotspotMode = true
    multicastLock = wifiManager.createMulticastLock("piu-lan").apply { setReferenceCounted(false); acquire() }
    val srv = ServerSocket()
    srv.reuseAddress = true
    try { srv.bind(InetSocketAddress(h.addr, tcpPort), 16) } catch (_: BindException) { srv.bind(InetSocketAddress(h.addr, 0), 16) }
    server = srv
    val ds = DatagramSocket(null)
    ds.reuseAddress = true
    ds.broadcast = true
    try { ds.bind(InetSocketAddress(udpPort)) } catch (_: BindException) { ds.bind(InetSocketAddress(0)) }
    udp = ds
    running = true
    io.execute { acceptLoop(srv) }
    io.execute { udpLoop(ds) }
    return mapOf("tcpPort" to srv.localPort, "udpPort" to ds.localPort)
  }

  private fun hotspotMap(h: Hotspot) = mapOf("ssid" to h.ssid, "passphrase" to h.passphrase, "ip" to h.addr.hostAddress, "prefix" to h.prefix)

  /** IPv4 da interface do hotspot: interface ativa que não é o Wi-Fi cliente, dados móveis, VPN nem Wi-Fi Direct. */
  private fun hotspotAddress(): Pair<Inet4Address, Int>? {
    val client = findWifi()?.let { cm.getLinkProperties(it) }?.let { linkV4(it) }?.address
    val skip = listOf("rmnet", "ccmni", "dummy", "tun", "p2p", "lo", "v4-", "ipsec", "radio", "bt-pan", "rndis", "usb")
    val ifs = try { NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList() } catch (_: Exception) { emptyList() }
    val cands = ifs.filter { n -> try { n.isUp && !n.isLoopback } catch (_: Exception) { false } }
      .filter { n -> skip.none { n.name.lowercase().startsWith(it) } }
      .sortedBy { n -> val nm = n.name.lowercase(); when { nm.startsWith("ap") || nm.startsWith("swlan") || nm.startsWith("softap") -> 0; nm.startsWith("wlan") -> 1; else -> 2 } }
    for (n in cands) for (ia in n.interfaceAddresses) {
      val a = ia.address
      if (a is Inet4Address && a.isSiteLocalAddress && a != client) return a to ia.networkPrefixLength.toInt()
    }
    return null
  }

  private fun clearHotspot() {
    reservation = null
    if (hotspot == null) return
    hotspot = null
    // O LAN ligado no hotspot perdeu a interface: desliga; o TypeScript religa na rede que sobrar.
    if (hotspotMode) stopAll()
    emitNetwork()
    try { sendEvent("onHotspot", bundleOf("stopped" to true)) } catch (_: Exception) {}
  }

  private fun leaveJoined() {
    joinCallback?.let { try { cm.unregisterNetworkCallback(it) } catch (_: Exception) {} }
    joinCallback = null
    if (joined != null) { joined = null; emitNetwork() }
  }

  @Synchronized
  private fun stopAll() {
    running = false
    hotspotMode = false
    mdnsStop()
    try { server?.close() } catch (_: Exception) {}
    try { udp?.close() } catch (_: Exception) {}
    server = null; udp = null
    for (id in conns.keys.toList()) closeConn(id, "rede local desligada")
    try { multicastLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
    multicastLock = null
  }

  private fun acceptLoop(srv: ServerSocket) {
    while (running && !srv.isClosed) {
      val s = try { srv.accept() } catch (_: Exception) { break }
      if (conns.size >= maxConnections) { try { s.close() } catch (_: Exception) {}; continue }
      try {
        val id = register(s, announce = false)
        sendEvent("onAccept", bundleOf("id" to id, "host" to s.inetAddress.hostAddress, "port" to s.port))
        conns[id]?.startReader()
      } catch (_: Exception) { try { s.close() } catch (_: Exception) {} }
    }
  }

  private fun udpLoop(ds: DatagramSocket) {
    val buf = ByteArray(512)
    while (running && !ds.isClosed) {
      val p = DatagramPacket(buf, buf.size)
      try { ds.receive(p) } catch (_: Exception) { break }
      if (p.length > MAX_DATAGRAM) continue
      val now = System.currentTimeMillis() / 1000
      if (now != udpWindow) { udpWindow = now; udpCount = 0 }
      if (++udpCount > MAX_DATAGRAMS_PER_SEC) continue
      val host = p.address?.hostAddress ?: continue
      sendEvent("onUdp", bundleOf("host" to host, "port" to p.port, "data" to Base64.encodeToString(p.data, p.offset, p.length, Base64.NO_WRAP)))
    }
  }

  /** Guarda a conexão e (para as de saída) já começa a ler. */
  private fun register(s: Socket, announce: Boolean = true): Int {
    s.tcpNoDelay = true
    s.keepAlive = true
    val id = nextId.getAndIncrement()
    val c = Conn(id, s)
    conns[id] = c
    if (announce) c.startReader()
    return id
  }

  private fun closeConn(id: Int, reason: String) {
    val c = conns.remove(id) ?: return
    c.closed = true
    try { c.socket.close() } catch (_: Exception) {}
    c.writer.shutdown()
    try { sendEvent("onClose", bundleOf("id" to id, "reason" to reason)) } catch (_: Exception) {}
  }

  private fun reasonOf(e: Exception) = when (e) {
    is ConnectException -> "ECONNREFUSED: conexão recusada"
    is SocketTimeoutException -> "ETIMEDOUT: sem resposta"
    is NoRouteToHostException -> "unreachable: sem rota"
    else -> e.message ?: "erro de rede"
  }

  private fun probeResult(e: Exception) = when (e) {
    is ConnectException -> if (e.message?.contains("ECONNREFUSED") == true || e.message?.contains("refused", true) == true) "refused" else "unreachable"
    is SocketTimeoutException -> "timeout"
    is NoRouteToHostException -> "unreachable"
    else -> "error"
  }

  // ── mDNS / DNS-SD ─────────────────────────────────────────
  @Synchronized
  private fun mdnsStart(name: String, udpPort: Int, txt: Map<String, String>) {
    if (!running) return
    mdnsStop()
    val info = NsdServiceInfo().apply {
      serviceName = name.take(63)
      serviceType = MDNS_TYPE
      port = udpPort
      for ((k, v) in txt.entries.take(8)) setAttribute(k.take(16), v.take(64))
    }
    val reg = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(s: NsdServiceInfo) {}
      override fun onRegistrationFailed(s: NsdServiceInfo, code: Int) {}
      override fun onServiceUnregistered(s: NsdServiceInfo) {}
      override fun onUnregistrationFailed(s: NsdServiceInfo, code: Int) {}
    }
    val disc = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(type: String) {}
      override fun onDiscoveryStopped(type: String) {}
      override fun onStartDiscoveryFailed(type: String, code: Int) {}
      override fun onStopDiscoveryFailed(type: String, code: Int) {}
      override fun onServiceFound(s: NsdServiceInfo) { enqueueResolve(s) }
      override fun onServiceLost(s: NsdServiceInfo) {}
    }
    try { nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, reg); registration = reg } catch (_: Exception) {}
    try { nsd.discoverServices(MDNS_TYPE, NsdManager.PROTOCOL_DNS_SD, disc); discovery = disc } catch (_: Exception) {}
  }

  @Synchronized
  private fun mdnsStop() {
    registration?.let { try { nsd.unregisterService(it) } catch (_: Exception) {} }
    discovery?.let { try { nsd.stopServiceDiscovery(it) } catch (_: Exception) {} }
    registration = null; discovery = null
    resolveQueue.clear()
  }

  /** NsdManager resolve um serviço por vez (antes do Android 14): fila curta e ritmo por minuto. */
  @Synchronized
  private fun enqueueResolve(s: NsdServiceInfo) {
    if (discovery == null || resolveQueue.size >= MAX_MDNS_QUEUE) return
    if (resolveQueue.any { it.serviceName == s.serviceName }) return
    resolveQueue.addLast(s)
    nextResolve()
  }

  @Synchronized
  private fun nextResolve() {
    if (resolving || discovery == null) return
    val now = System.currentTimeMillis()
    while (resolveTimes.isNotEmpty() && now - resolveTimes.first() > 60_000) resolveTimes.removeFirst()
    if (resolveTimes.size >= MAX_MDNS_RESOLVES_PER_MIN) {
      // Ritmo esgotado: tenta de novo daqui a pouco (fila curta, nada se perde além do teto).
      if (resolveQueue.isNotEmpty() && !retryScheduled) {
        retryScheduled = true
        io.execute {
          try { Thread.sleep(5_000) } catch (_: InterruptedException) { return@execute }
          synchronized(this@PiuLanModule) { retryScheduled = false }
          nextResolve()
        }
      }
      return
    }
    val s = resolveQueue.removeFirstOrNull() ?: return
    resolving = true
    resolveTimes.addLast(now)
    val listener = object : NsdManager.ResolveListener {
      override fun onResolveFailed(info: NsdServiceInfo, code: Int) { done() }
      override fun onServiceResolved(info: NsdServiceInfo) {
        @Suppress("DEPRECATION") val host = info.host
        if (host is Inet4Address) {
          val attr = info.attributes
          val tcp = attr["tcp"]?.toString(Charsets.UTF_8)?.toIntOrNull()
          val tag = attr["tag"]?.toString(Charsets.UTF_8)
          try { sendEvent("onMdns", bundleOf("name" to info.serviceName, "host" to host.hostAddress, "port" to info.port, "tcp" to tcp, "tag" to tag)) } catch (_: Exception) {}
        }
        done()
      }
      fun done() { synchronized(this@PiuLanModule) { resolving = false }; io.execute { nextResolve() } }
    }
    @Suppress("DEPRECATION")
    try { nsd.resolveService(s, listener) } catch (_: Exception) { resolving = false }
  }
}
