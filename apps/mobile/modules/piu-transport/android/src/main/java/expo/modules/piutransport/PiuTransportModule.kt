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

private class NotRunningException : CodedException("ERR_NOT_RUNNING", "O transporte não está ativo.", null)
private class PeerNotConnectedException(id: String) : CodedException("ERR_PEER", "Vizinho $id não está conectado.", null)
private class TooLargeException : CodedException("ERR_TOO_LARGE", "Envelope maior que ${ConnectionsClient.MAX_BYTES_DATA_SIZE} bytes.", null)

/**
 * Transporte P2P no Android com Nearby Connections (estratégia P2P_CLUSTER: malha de muitos para muitos).
 * Cada aparelho anuncia e procura ao mesmo tempo; ao encontrar um vizinho, conecta e troca envelopes
 * (bytes já cifrados pelo app). Nada passa por servidor.
 */
class PiuTransportModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val client: ConnectionsClient by lazy { Nearby.getConnectionsClient(context) }

  private var running = false
  private var localName = ""
  private val names = mutableMapOf<String, String>()
  private val connected = mutableSetOf<String>()

  override fun definition() = ModuleDefinition {
    Name("PiuTransport")
    Events("onState", "onPeerFound", "onPeerLost", "onConnected", "onDisconnected", "onEnvelope")

    Function("kind") { "nearby" }

    AsyncFunction("start") { name: String, serviceId: String, promise: Promise ->
      if (running) { promise.resolve(null); return@AsyncFunction }
      localName = name
      running = true
      state("starting")
      val strategy = Strategy.P2P_CLUSTER
      client.startAdvertising(name, serviceId, lifecycle, AdvertisingOptions.Builder().setStrategy(strategy).build())
        .onSuccessTask { client.startDiscovery(serviceId, discovery, DiscoveryOptions.Builder().setStrategy(strategy).build()) }
        .addOnSuccessListener { state("running"); promise.resolve(null) }
        .addOnFailureListener { e ->
          stopAll()
          state("unavailable", e.message)
          promise.reject(CodedException("ERR_START", e.message ?: "Falha ao iniciar o Nearby Connections.", e))
        }
    }

    AsyncFunction("stop") {
      stopAll()
      state("off")
    }

    AsyncFunction("send") { peerId: String, data: String, promise: Promise ->
      if (!running) throw NotRunningException()
      if (peerId !in connected) throw PeerNotConnectedException(peerId)
      val bytes = Base64.decode(data, Base64.NO_WRAP)
      if (bytes.size > ConnectionsClient.MAX_BYTES_DATA_SIZE) throw TooLargeException()
      client.sendPayload(peerId, Payload.fromBytes(bytes))
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { e -> promise.reject(CodedException("ERR_SEND", e.message ?: "Falha no envio.", e)) }
    }

    OnDestroy { stopAll() }
  }

  private fun state(s: String, reason: String? = null) =
    sendEvent("onState", bundleOf("state" to s, "reason" to reason))

  private fun stopAll() {
    if (!running) return
    running = false
    client.stopAdvertising()
    client.stopDiscovery()
    client.stopAllEndpoints()
    connected.clear()
    names.clear()
  }

  private val discovery = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      names[endpointId] = info.endpointName
      sendEvent("onPeerFound", bundleOf("id" to endpointId, "name" to info.endpointName, "via" to "nearby"))
      // Os dois lados se descobrem; só o de nome menor pede a conexão, para evitar pedidos cruzados.
      if (localName < info.endpointName) {
        client.requestConnection(localName, endpointId, lifecycle)
      }
    }

    override fun onEndpointLost(endpointId: String) {
      names.remove(endpointId)
      sendEvent("onPeerLost", bundleOf("id" to endpointId))
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
        sendEvent("onConnected", bundleOf("id" to endpointId, "name" to names[endpointId]))
      }
    }

    override fun onDisconnected(endpointId: String) {
      connected -= endpointId
      sendEvent("onDisconnected", bundleOf("id" to endpointId))
    }
  }

  private val payloads = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      if (payload.type != Payload.Type.BYTES) return
      val bytes = payload.asBytes() ?: return
      sendEvent("onEnvelope", bundleOf("from" to endpointId, "data" to Base64.encodeToString(bytes, Base64.NO_WRAP)))
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
  }
}
