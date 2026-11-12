package expo.modules.piutransport

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import androidx.core.os.bundleOf
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap

private class NotRunningException : CodedException("ERR_NOT_RUNNING", "O transporte não está ativo.", null)
private class PeerNotConnectedException(id: String) : CodedException("ERR_PEER", "Vizinho $id não está conectado.", null)
private class TooLargeException : CodedException("ERR_TOO_LARGE", "Envelope maior que ${ConnectionsClient.MAX_BYTES_DATA_SIZE} bytes.", null)
private class UnknownMediumException(m: String) : CodedException("ERR_MEDIUM", "Meio desconhecido: $m.", null)

private const val NEARBY = "nearby"
private const val BLE = "ble"
private const val NEARBY_WINDOW_MS = 10_000L
/** Teto de enlaces Nearby (conectados + em negociação): qualquer app com o mesmo serviceId pode pedir. */
private const val MAX_NEARBY_ENDPOINTS = 8
/** No máximo `MAX_NEARBY_ACCEPTS` aceites por `NEARBY_ACCEPT_WINDOW_MS`: quem pede sem parar é recusado. */
private const val MAX_NEARBY_ACCEPTS = 6
private const val NEARBY_ACCEPT_WINDOW_MS = 10_000L
/** Quem foi recusado (teto cheio aqui ou lá) ou caiu tenta de novo a cada tanto, até `NEARBY_RETRIES` vezes. */
private const val NEARBY_RETRY_MS = 15_000L
private const val NEARBY_RETRIES = 8
/** Com o teto cheio, um enlace que nunca mandou nada há tanto tempo cede a vaga a quem chega. */
private const val NEARBY_IDLE_EVICT_MS = 60_000L

/**
 * Transporte P2P no Android com dois meios ao mesmo tempo:
 * - **Nearby Connections** (estratégia P2P_CLUSTER: malha de muitos para muitos, Bluetooth +
 *   Wi-Fi Direct, alta banda) — fala com outros Androids;
 * - **Bluetooth LE GATT** (`BleEngine`, mesmo protocolo do iPhone) — fala com iPhones e Androids.
 * Cada evento diz o meio (`via`). A escolha de meio por vizinho fica no app (src/transport/multi.ts).
 * Nada passa por servidor.
 */
class PiuTransportModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val client: ConnectionsClient by lazy { Nearby.getConnectionsClient(context) }

  @Volatile private var running = false
  private var localName = ""
  // Escritos pelos callbacks do Nearby (thread principal) e lidos nas AsyncFunctions (fila do módulo).
  private val names = ConcurrentHashMap<String, String>()
  private val connected: MutableSet<String> = ConcurrentHashMap.newKeySet()
  /** Pedidos aceitos que ainda não deram resultado (contam no teto). */
  private val pendingNearby: MutableSet<String> = ConcurrentHashMap.newKeySet()
  /** Horário dos aceites recentes (thread principal, callbacks do Nearby). */
  private val recentAccepts = ArrayDeque<Long>()
  /** Início de cada enlace Nearby e quem já mandou algum dado (para achar quem só ocupa a vaga). */
  private val connectedAt = ConcurrentHashMap<String, Long>()
  private val heard: MutableSet<String> = ConcurrentHashMap.newKeySet()
  /** Tentativas de reconexão já feitas por vizinho; `nearbyGen` invalida as agendadas antes de um stop. */
  private val retries = ConcurrentHashMap<String, Int>()
  @Volatile private var nearbyGen = 0
  private var ble: BleEngine? = null
  private var serviceId = ""
  /** "Procurar vizinhos" (NFR-004): Econômica 60 s, Normal 20 s, Rápida 5 s. */
  private var discoveryIntervalMs = 20_000L
  private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
  @Volatile private var discovering = false
  /**
   * Meios ligados na aba Rede (Wi-Fi Direct = Nearby, Bluetooth LE). Desligado não anuncia nem procura:
   * o Nearby do Google Play Services liga o Wi-Fi sozinho, e quem escolheu só Bluetooth não autorizou isso.
   */
  @Volatile private var nearbyOn = true
  @Volatile private var bleOn = true
  /** Nearby: descobre por `NEARBY_WINDOW_MS` a cada intervalo (ou sem parar, se o intervalo for curto). */
  private val discoveryCycle = object : Runnable {
    override fun run() {
      if (!running || !nearbyOn) return
      if (discovering) {
        client.stopDiscovery(); discovering = false
        mainHandler.postDelayed(this, discoveryIntervalMs - NEARBY_WINDOW_MS)
      } else {
        startDiscovery()
        if (discoveryIntervalMs > NEARBY_WINDOW_MS + 5_000L) mainHandler.postDelayed(this, NEARBY_WINDOW_MS)
      }
    }
  }

  // Estado de cada meio: null = ainda iniciando; o transporte está "running" se algum estiver ok.
  private var nearbyOk: Boolean? = null
  private var bleOk: Boolean? = null
  private var nearbyReason: String? = null
  private var bleReason: String? = null

  override fun definition() = ModuleDefinition {
    Name("PiuTransport")
    Events("onState", "onPeerFound", "onPeerLost", "onConnected", "onDisconnected", "onEnvelope", "onHeartbeat")

    // Pulso do PiuRelayService (só enquanto ele está ligado): o JS anuncia na rede local e faz o `tick`.
    OnCreate { PiuRelayService.onHeartbeat = { sendEvent("onHeartbeat", bundleOf()) } }

    Function("kind") { NEARBY }
    Function("media") { listOf(NEARBY, BLE) }

    AsyncFunction("start") { name: String, serviceId: String, promise: Promise ->
      if (running) { promise.resolve(null); return@AsyncFunction }
      localName = name
      this@PiuTransportModule.serviceId = serviceId
      running = true
      synchronized(this@PiuTransportModule) { nearbyOk = null; bleOk = null; nearbyReason = null; bleReason = null }
      state("starting")
      if (bleOn) startBle() else medium(BLE, false, null)
      if (nearbyOn) startNearby(promise) else { medium(NEARBY, false, null); promise.resolve(null) }
      Unit // o retorno da lambda não importa: a resposta vai pela `promise`
    }

    // Aba Rede. Antes do `start` só grava a escolha; com o transporte rodando, liga ou desliga o meio.
    Function("setMediumEnabled") { m: String, on: Boolean ->
      val changed = when (m) {
        NEARBY -> (nearbyOn != on).also { nearbyOn = on }
        BLE -> (bleOn != on).also { bleOn = on }
        else -> throw UnknownMediumException(m)
      }
      if (changed && running) mainHandler.post {
        // Só o último pedido vale (a pessoa pode ligar e desligar rápido).
        if (!running || on != (if (m == NEARBY) nearbyOn else bleOn)) return@post
        when {
          m == NEARBY && on -> startNearby(null)
          m == NEARBY -> stopNearby()
          on -> startBle()
          else -> stopBle()
        }
      }
      Unit
    }

    AsyncFunction("stop") {
      stopAll()
      state("off")
    }

    AsyncFunction("send") { peerId: String, data: String, promise: Promise ->
      val m = if (peerId in connected) NEARBY else BLE
      sendVia(m, peerId, data, promise)
    }

    AsyncFunction("sendVia") { medium: String, peerId: String, data: String, promise: Promise ->
      sendVia(medium, peerId, data, promise)
    }

    Function("setDiscoveryInterval") { seconds: Double ->
      discoveryIntervalMs = (seconds * 1000).toLong().coerceAtLeast(1_000L)
      ble?.setScanInterval(discoveryIntervalMs)
      if (running && nearbyOk == true) mainHandler.post { restartDiscoveryCycle() }
      Unit
    }

    AsyncFunction("setBackground") { on: Boolean, title: String, text: String ->
      if (on) PiuRelayService.start(context, title, text) else PiuRelayService.stop(context)
    }

    // "Receber com o app fechado": o sistema não deixa o app ligar estes ajustes sozinho; a tela pede
    // com um toque cada e confere de novo ao voltar (src/ui/BackgroundSetup.tsx).
    Function("powerInfo") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      mapOf(
        "ignoringBattery" to pm.isIgnoringBatteryOptimizations(context.packageName),
        "manufacturer" to (Build.MANUFACTURER ?: ""),
        "brand" to (Build.BRAND ?: ""),
      )
    }

    // Pedido direto do sistema ("Permitir que o app rode em segundo plano?"); sem ele, a lista da otimização.
    Function("openBatteryExemption") {
      openFirst(listOf(
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")),
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
      ))
    }

    // Xiaomi/HyperOS: tela de Inicialização automática (sem API oficial nem para ler o estado);
    // por último, os detalhes do app.
    Function("openAutostart") {
      openFirst(listOf(
        Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")),
        Intent("miui.intent.action.OP_AUTO_START").addCategory(Intent.CATEGORY_DEFAULT),
        Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.appmanager.ApplicationsDetailsActivity"))
          .putExtra("package_name", context.packageName).putExtra("package_label", "Piu"),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")),
      ))
    }

    OnDestroy {
      PiuRelayService.onHeartbeat = null
      stopAll()
      // Só para agora (reload): a escolha fica, para o reinício do aparelho religar.
      try { PiuRelayService.stop(context, keepChoice = true) } catch (_: Exception) {}
    }
  }

  /** Abre a primeira tela que o aparelho aceitar (cada fabricante tem as suas); `false` se nenhuma abriu. */
  private fun openFirst(intents: List<Intent>): Boolean {
    val activity = appContext.currentActivity
    for (i in intents) {
      try {
        if (activity != null) activity.startActivity(i) else context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
      } catch (_: Exception) { /* não existe neste aparelho ou não é exportada: tenta a próxima */ }
    }
    return false
  }

  private fun sendVia(medium: String, peerId: String, data: String, promise: Promise) {
    if (!running) throw NotRunningException()
    val bytes = Base64.decode(data, Base64.NO_WRAP)
    if (bytes.size > ConnectionsClient.MAX_BYTES_DATA_SIZE) throw TooLargeException()
    when (medium) {
      NEARBY -> {
        if (peerId !in connected) throw PeerNotConnectedException(peerId)
        client.sendPayload(peerId, Payload.fromBytes(bytes))
          .addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { e -> promise.reject(CodedException("ERR_SEND", e.message ?: "Falha no envio.", e)) }
      }
      BLE -> {
        val engine = ble ?: throw NotRunningException()
        if (!engine.isConnected(peerId)) throw PeerNotConnectedException(peerId)
        engine.send(peerId, bytes) { err ->
          if (err == null) promise.resolve(null)
          else promise.reject(CodedException("ERR_SEND", err.message ?: "Falha no envio por Bluetooth LE.", err))
        }
      }
      else -> throw UnknownMediumException(medium)
    }
  }

  private fun state(s: String, reason: String? = null) =
    sendEvent("onState", bundleOf("state" to s, "reason" to reason))

  /** Registra o estado de um meio e emite o estado agregado. */
  @Synchronized
  private fun medium(m: String, ok: Boolean, reason: String?) {
    if (!running) return
    if (m == NEARBY) { nearbyOk = ok; nearbyReason = reason } else { bleOk = ok; bleReason = reason }
    when {
      nearbyOk == true || bleOk == true -> state("running", listOfNotNull(nearbyReason, bleReason).joinToString(" ").ifEmpty { null })
      nearbyOk == false && bleOk == false -> state("unavailable", listOfNotNull(nearbyReason, bleReason).joinToString(" "))
      else -> Unit // o outro meio ainda está iniciando
    }
  }

  private fun startBle() {
    synchronized(this) { bleOk = null; bleReason = null }
    ble = BleEngine(context, localName, bleListener).also { it.setScanInterval(discoveryIntervalMs); it.start() }
  }

  private fun stopBle() {
    ble?.stop() // avisa o app de cada enlace que cai
    ble = null
    medium(BLE, false, null)
  }

  private fun startNearby(promise: Promise?) {
    synchronized(this) { nearbyOk = null; nearbyReason = null }
    val strategy = Strategy.P2P_CLUSTER
    client.startAdvertising(localName, serviceId, lifecycle, AdvertisingOptions.Builder().setStrategy(strategy).build())
      .onSuccessTask { client.startDiscovery(serviceId, discovery, DiscoveryOptions.Builder().setStrategy(strategy).build()) }
      .addOnSuccessListener {
        // Desligado na aba Rede enquanto iniciava.
        if (!nearbyOn) { stopNearby(); promise?.resolve(null); return@addOnSuccessListener }
        discovering = true
        medium(NEARBY, true, null); promise?.resolve(null)
        restartDiscoveryCycle()
      }
      .addOnFailureListener { e ->
        // Sem Nearby (ex.: sem Google Play Services) o BLE ainda funciona.
        try { client.stopAdvertising(); client.stopDiscovery() } catch (_: Exception) {}
        medium(NEARBY, false, e.message ?: "Falha ao iniciar o Nearby Connections.")
        promise?.resolve(null)
      }
  }

  /** Desliga o Nearby (anúncio, descoberta e conexões) e avisa o app de cada enlace que cai. */
  private fun stopNearby() {
    mainHandler.removeCallbacks(discoveryCycle)
    discovering = false
    try { client.stopAdvertising(); client.stopDiscovery(); client.stopAllEndpoints() } catch (_: Exception) {}
    connected.forEach { sendEvent("onDisconnected", bundleOf("id" to it, "via" to NEARBY)) }
    names.keys.forEach { sendEvent("onPeerLost", bundleOf("id" to it, "via" to NEARBY)) }
    connected.clear()
    pendingNearby.clear()
    clearNearbyLinks()
    names.clear()
    medium(NEARBY, false, null)
  }

  private fun startDiscovery() {
    client.startDiscovery(serviceId, discovery, DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build())
      .addOnSuccessListener { discovering = true }
  }

  /** Começa o ciclo de novo com o intervalo atual (a descoberta já está ligada quando é chamado). */
  private fun restartDiscoveryCycle() {
    mainHandler.removeCallbacks(discoveryCycle)
    if (discoveryIntervalMs > NEARBY_WINDOW_MS + 5_000L) mainHandler.postDelayed(discoveryCycle, NEARBY_WINDOW_MS)
    else if (!discovering) startDiscovery()
  }

  private fun stopAll() {
    if (!running) return
    running = false
    mainHandler.removeCallbacks(discoveryCycle)
    discovering = false
    client.stopAdvertising()
    client.stopDiscovery()
    client.stopAllEndpoints()
    ble?.stop()
    ble = null
    connected.clear()
    pendingNearby.clear()
    clearNearbyLinks()
    names.clear()
  }

  private fun clearNearbyLinks() {
    nearbyGen++
    connectedAt.clear(); heard.clear(); retries.clear()
  }

  /** Pede a conexão. Os dois lados se descobrem; só o de nome menor pede, para evitar pedidos cruzados. */
  private fun requestNearby(endpointId: String) {
    val name = names[endpointId] ?: return
    if (localName >= name || endpointId in connected || endpointId in pendingNearby) return
    client.requestConnection(localName, endpointId, lifecycle).addOnFailureListener { scheduleRetry(endpointId) }
  }

  /** Nova tentativa mais tarde (antes, só ao reencontrar o vizinho): o teto não deixa ninguém de fora para sempre. */
  private fun scheduleRetry(endpointId: String) {
    val name = names[endpointId] ?: return
    if (localName >= name) return // quem pede é o outro lado
    val n = retries[endpointId] ?: 0
    if (n >= NEARBY_RETRIES) return
    retries[endpointId] = n + 1
    val gen = nearbyGen
    mainHandler.postDelayed({ if (running && nearbyOn && gen == nearbyGen) requestNearby(endpointId) }, NEARBY_RETRY_MS)
  }

  /** Teto cheio: derruba o enlace mais antigo que nunca mandou nada há `NEARBY_IDLE_EVICT_MS`. */
  private fun evictIdle(now: Long): Boolean {
    val victim = connected.filter { it !in heard }.minByOrNull { connectedAt[it] ?: now } ?: return false
    if (now - (connectedAt[victim] ?: now) < NEARBY_IDLE_EVICT_MS) return false
    try { client.disconnectFromEndpoint(victim) } catch (_: Exception) {}
    dropNearby(victim)
    return true
  }

  /** Tira o enlace e avisa o app uma vez só (a queda pode vir pelo callback e pela nossa desconexão). */
  private fun dropNearby(endpointId: String): Boolean {
    if (!connected.remove(endpointId)) return false
    connectedAt.remove(endpointId); heard.remove(endpointId)
    sendEvent("onDisconnected", bundleOf("id" to endpointId, "via" to NEARBY))
    return true
  }

  // ---------------------------------------------------------------- Bluetooth LE

  /** Eventos do BLE chegam da thread `piu-ble`; depois do `stop` são descartados. */
  private fun bleEvent(name: String, body: android.os.Bundle) { if (running) sendEvent(name, body) }

  private val bleListener = object : BleEngine.Listener {
    override fun onBleState(available: Boolean, reason: String?) = medium(BLE, available, reason)
    override fun onPeerFound(id: String, name: String) = bleEvent("onPeerFound", bundleOf("id" to id, "name" to name, "via" to BLE))
    override fun onPeerLost(id: String) = bleEvent("onPeerLost", bundleOf("id" to id, "via" to BLE))
    override fun onConnected(id: String, name: String?) = bleEvent("onConnected", bundleOf("id" to id, "name" to name, "via" to BLE))
    override fun onDisconnected(id: String) = bleEvent("onDisconnected", bundleOf("id" to id, "via" to BLE))
    override fun onEnvelope(id: String, data: ByteArray) =
      bleEvent("onEnvelope", bundleOf("from" to id, "data" to Base64.encodeToString(data, Base64.NO_WRAP), "via" to BLE))
  }

  // ---------------------------------------------------------------- Nearby Connections

  private val discovery = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      names[endpointId] = info.endpointName
      sendEvent("onPeerFound", bundleOf("id" to endpointId, "name" to info.endpointName, "via" to NEARBY))
      retries.remove(endpointId)
      requestNearby(endpointId)
    }

    override fun onEndpointLost(endpointId: String) {
      names.remove(endpointId)
      retries.remove(endpointId)
      sendEvent("onPeerLost", bundleOf("id" to endpointId, "via" to NEARBY))
    }
  }

  private val lifecycle = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
      // Aceita no transporte; a confiança vem depois, pela verificação de chaves do próprio Piu.
      // Mas com teto de enlaces e de aceites por janela: sem isso, um app por perto ocupava o rádio.
      val now = android.os.SystemClock.elapsedRealtime()
      while (recentAccepts.isNotEmpty() && now - recentAccepts.first() > NEARBY_ACCEPT_WINDOW_MS) recentAccepts.removeFirst()
      // Teto cheio: quem só ocupa a vaga (nunca mandou nada) cede para quem chega.
      val busy = (connected + pendingNearby).size >= MAX_NEARBY_ENDPOINTS
      if (recentAccepts.size >= MAX_NEARBY_ACCEPTS || (busy && !evictIdle(now))) {
        client.rejectConnection(endpointId)
        return
      }
      recentAccepts.addLast(now)
      pendingNearby += endpointId
      names[endpointId] = info.endpointName
      client.acceptConnection(endpointId, payloads)
    }

    override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
      pendingNearby -= endpointId
      if (result.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
        connected += endpointId
        connectedAt[endpointId] = android.os.SystemClock.elapsedRealtime()
        sendEvent("onConnected", bundleOf("id" to endpointId, "name" to names[endpointId], "via" to NEARBY))
      } else scheduleRetry(endpointId) // recusado (teto cheio aqui ou lá) ou falhou
    }

    override fun onDisconnected(endpointId: String) {
      if (dropNearby(endpointId)) scheduleRetry(endpointId)
    }
  }

  private val payloads = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      if (payload.type != Payload.Type.BYTES) return
      val bytes = payload.asBytes() ?: return
      heard += endpointId
      sendEvent("onEnvelope", bundleOf("from" to endpointId, "data" to Base64.encodeToString(bytes, Base64.NO_WRAP), "via" to NEARBY))
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
  }
}
