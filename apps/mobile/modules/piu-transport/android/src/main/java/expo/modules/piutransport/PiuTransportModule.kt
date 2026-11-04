package expo.modules.piutransport

import android.content.Context
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
  private var ble: BleEngine? = null
  private var serviceId = ""
  /** "Procurar vizinhos" (NFR-004): Econômica 60 s, Normal 20 s, Rápida 5 s. */
  private var discoveryIntervalMs = 20_000L
  private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
  @Volatile private var discovering = false
  /** Nearby: descobre por `NEARBY_WINDOW_MS` a cada intervalo (ou sem parar, se o intervalo for curto). */
  private val discoveryCycle = object : Runnable {
    override fun run() {
      if (!running) return
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
    Events("onState", "onPeerFound", "onPeerLost", "onConnected", "onDisconnected", "onEnvelope")

    Function("kind") { NEARBY }
    Function("media") { listOf(NEARBY, BLE) }

    AsyncFunction("start") { name: String, serviceId: String, promise: Promise ->
      if (running) { promise.resolve(null); return@AsyncFunction }
      localName = name
      this@PiuTransportModule.serviceId = serviceId
      running = true
      synchronized(this@PiuTransportModule) { nearbyOk = null; bleOk = null; nearbyReason = null; bleReason = null }
      state("starting")
      ble = BleEngine(context, name, bleListener).also { it.setScanInterval(discoveryIntervalMs); it.start() }
      val strategy = Strategy.P2P_CLUSTER
      client.startAdvertising(name, serviceId, lifecycle, AdvertisingOptions.Builder().setStrategy(strategy).build())
        .onSuccessTask { client.startDiscovery(serviceId, discovery, DiscoveryOptions.Builder().setStrategy(strategy).build()) }
        .addOnSuccessListener {
          discovering = true
          medium(NEARBY, true, null); promise.resolve(null)
          restartDiscoveryCycle()
        }
        .addOnFailureListener { e ->
          // Sem Nearby (ex.: sem Google Play Services) o BLE ainda funciona.
          try { client.stopAdvertising(); client.stopDiscovery() } catch (_: Exception) {}
          medium(NEARBY, false, e.message ?: "Falha ao iniciar o Nearby Connections.")
          promise.resolve(null)
        }
      Unit // o retorno da lambda não importa: a resposta vai pela `promise`
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

    OnDestroy {
      stopAll()
      try { PiuRelayService.stop(context) } catch (_: Exception) {}
    }
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
    names.clear()
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
      // Os dois lados se descobrem; só o de nome menor pede a conexão, para evitar pedidos cruzados.
      if (localName < info.endpointName) {
        client.requestConnection(localName, endpointId, lifecycle)
      }
    }

    override fun onEndpointLost(endpointId: String) {
      names.remove(endpointId)
      sendEvent("onPeerLost", bundleOf("id" to endpointId, "via" to NEARBY))
    }
  }

  private val lifecycle = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
      names[endpointId] = info.endpointName
      // Aceita no transporte; a confiança vem depois, pela verificação de chaves do próprio Piu.
      client.acceptConnection(endpointId, payloads)
    }

    override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
      if (result.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
        connected += endpointId
        sendEvent("onConnected", bundleOf("id" to endpointId, "name" to names[endpointId], "via" to NEARBY))
      }
    }

    override fun onDisconnected(endpointId: String) {
      connected -= endpointId
      sendEvent("onDisconnected", bundleOf("id" to endpointId, "via" to NEARBY))
    }
  }

  private val payloads = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      if (payload.type != Payload.Type.BYTES) return
      val bytes = payload.asBytes() ?: return
      sendEvent("onEnvelope", bundleOf("from" to endpointId, "data" to Base64.encodeToString(bytes, Base64.NO_WRAP), "via" to NEARBY))
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
  }
}
