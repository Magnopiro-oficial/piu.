package expo.modules.piutransport

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelUuid
import android.os.SystemClock
import java.util.UUID

/**
 * Bluetooth LE GATT no Android, compatível com o iPhone (`ios/PiuTransportModule.swift`):
 * o aparelho é central (procura, conecta e escreve na `inbox` do outro) e periférico (anuncia,
 * aceita escritas na própria `inbox` e notifica pela `outbox`). Envelopes vão em blocos do tamanho
 * do MTU (ver BleFrames). Ids de enlace = endereço Bluetooth do vizinho.
 *
 * Todo o estado vive numa única thread (`piu-ble`); os callbacks do sistema são repassados a ela.
 * As permissões BLUETOOTH_SCAN/ADVERTISE/CONNECT (Android 12+) ou localização (até o 11) são
 * pedidas pelo app antes de `start()` (src/transport/permissions.ts).
 */
@SuppressLint("MissingPermission")
internal class BleEngine(
  private val context: Context,
  private val localName: String,
  private val listener: Listener,
) {
  interface Listener {
    /** BLE disponível (`true`) ou não, com o motivo. */
    fun onBleState(available: Boolean, reason: String?)
    fun onPeerFound(id: String, name: String)
    fun onPeerLost(id: String)
    fun onConnected(id: String, name: String?)
    fun onDisconnected(id: String)
    fun onEnvelope(id: String, data: ByteArray)
  }

  companion object {
    val SERVICE: UUID = UUID.fromString("02999473-3C58-4C4C-A014-DDA62869CFCE")
    /** Central → periférico (escrita com resposta). */
    val INBOX: UUID = UUID.fromString("7B41CD1F-85C3-400F-A6F9-5B89DD6B0915")
    /** Periférico → central (notificação). */
    val OUTBOX: UUID = UUID.fromString("E7D5F504-1483-497F-B64E-9DB52C4D3240")
    /** Client Characteristic Configuration Descriptor (padrão Bluetooth). */
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    private const val DEFAULT_MTU = 23
    private const val DESIRED_MTU = 517
    /** Bytes do nome no service data da resposta de varredura (31 − 2 − 16 do UUID de 128 bits). */
    private const val ADV_NAME_MAX = 13
    private const val MAX_CLIENTS = 6
    private const val OP_TIMEOUT_MS = 10_000L
    private const val RETRY_MS = 10_000L
    /** Cada varredura dura isto; depois o rádio descansa até a próxima (NFR-004). */
    private const val SCAN_WINDOW_MS = 4_000L
  }

  private val thread = HandlerThread("piu-ble").apply { start() }
  private val handler = Handler(thread.looper)
  private val manager = context.getSystemService(BluetoothManager::class.java)

  private var scanner: BluetoothLeScanner? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var server: BluetoothGattServer? = null
  private var outbox: BluetoothGattCharacteristic? = null
  private var stopped = false
  /** "Procurar vizinhos": intervalo entre varreduras. Até a janela + 2 s, a varredura é contínua. */
  private var scanIntervalMs = 20_000L
  private var scanning = false
  private val scanCycle = object : Runnable {
    override fun run() {
      if (stopped) return
      if (scanning) {
        stopScan()
        handler.postDelayed(this, scanIntervalMs - SCAN_WINDOW_MS)
      } else {
        startScan()
        if (scanIntervalMs > SCAN_WINDOW_MS + 2_000L) handler.postDelayed(this, SCAN_WINDOW_MS)
      }
    }
  }

  /** Um envio em andamento (vários blocos): avisa uma vez, no fim ou na primeira falha. */
  private class Pending(var remaining: Int, val done: ((Throwable?) -> Unit)?) {
    var finished = false
    fun step(err: Throwable?) {
      if (finished) return
      if (err != null) { finished = true; done?.invoke(err); return }
      remaining -= 1
      if (remaining <= 0) { finished = true; done?.invoke(null) }
    }
  }

  private sealed class Op {
    class Descriptor(val descriptor: BluetoothGattDescriptor, val value: ByteArray) : Op()
    class Write(val value: ByteArray, val pending: Pending) : Op()
  }

  /** Papel central: conexão nossa com o periférico de um vizinho. */
  private inner class Client(val device: BluetoothDevice) {
    var gatt: BluetoothGatt? = null
    var inbox: BluetoothGattCharacteristic? = null
    var mtu = DEFAULT_MTU
    var ready = false
    val ops = ArrayDeque<Op>()
    var current: Op? = null
  }

  private class Notify(val device: BluetoothDevice, val value: ByteArray, val pending: Pending)

  private val clients = HashMap<String, Client>()
  /** Papel periférico: centrais inscritas na nossa `outbox`. */
  private val subscribers = HashMap<String, BluetoothDevice>()
  private val serverMtu = HashMap<String, Int>()
  private val notifyQueue = ArrayDeque<Notify>()
  private var notifying: Notify? = null

  private val names = HashMap<String, String>()
  private val up = HashSet<String>()
  private val retryAt = HashMap<String, Long>()
  private val reassembler = BleFrames.Reassembler()
  private var nextId = 1L

  // ---------------------------------------------------------------- ciclo de vida

  fun start() = handler.post {
    val adapter = manager?.adapter
    if (adapter == null) { listener.onBleState(false, "Este aparelho não tem Bluetooth LE."); return@post }
    if (!adapter.isEnabled) { listener.onBleState(false, "Bluetooth desligado."); return@post }
    try {
      openServer()
      scanner = adapter.bluetoothLeScanner
      restartScanCycle()
      listener.onBleState(true, null)
    } catch (e: SecurityException) {
      listener.onBleState(false, "Permissão de Bluetooth negada.")
    }
  }

  /** Muda o ciclo de varredura. Conexões já abertas não são afetadas. */
  fun setScanInterval(ms: Long) = handler.post {
    scanIntervalMs = ms.coerceAtLeast(1_000L)
    if (scanner != null) restartScanCycle()
  }

  /** Roda na thread `piu-ble`. */
  private fun restartScanCycle() {
    handler.removeCallbacks(scanCycle)
    if (scanning) stopScan()
    scanCycle.run()
  }

  private fun startScan() {
    try {
      scanner?.startScan(
        listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE)).build()),
        ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build(),
        scanCallback,
      )
      scanning = true
    } catch (_: Exception) { scanning = false }
  }

  private fun stopScan() {
    try { scanner?.stopScan(scanCallback) } catch (_: Exception) {}
    scanning = false
  }

  fun stop() {
    handler.post {
      stopped = true
      // Só o Bluetooth parou (aba Rede) e o Nearby segue: o app precisa saber que estes enlaces caíram.
      synchronized(up) { up.toList() }.forEach { listener.onDisconnected(it) }
      (names.keys + clients.keys).forEach { listener.onPeerLost(it) }
      handler.removeCallbacks(scanCycle)
      try { scanner?.stopScan(scanCallback) } catch (_: Exception) {}
      try { advertiser?.stopAdvertising(advertiseCallback) } catch (_: Exception) {}
      clients.values.forEach { c -> try { c.gatt?.disconnect(); c.gatt?.close() } catch (_: Exception) {} }
      try { server?.close() } catch (_: Exception) {}
      clients.clear(); subscribers.clear(); serverMtu.clear(); notifyQueue.clear(); notifying = null
      names.clear(); up.clear(); retryAt.clear(); reassembler.clear()
      server = null; outbox = null; scanner = null; advertiser = null
      handler.removeCallbacksAndMessages(null)
      thread.quitSafely()
    }
  }

  // ---------------------------------------------------------------- envio

  fun isConnected(id: String): Boolean = synchronized(up) { id in up }

  /** Envia um envelope inteiro ao vizinho `id`; `done` é chamado (na thread BLE) no fim ou na falha. */
  fun send(id: String, data: ByteArray, done: (Throwable?) -> Unit) {
    if (!handler.post { sendNow(id, data, done) }) done(IllegalStateException("Bluetooth LE parado."))
  }

  private fun sendNow(id: String, data: ByteArray, done: (Throwable?) -> Unit) {
    val client = clients[id]
    val sub = subscribers[id]
    val msgId = nextId
    nextId = if (nextId >= 0xFFFFFFFFL) 1L else nextId + 1 // 0 é o hello
    when {
      client != null && client.ready -> writeFrames(client, BleFrames.split(data, payload(client.mtu), msgId), done)
      sub != null -> notifyFrames(sub, BleFrames.split(data, payload(serverMtu[id] ?: DEFAULT_MTU), msgId), done)
      else -> done(IllegalStateException("Vizinho $id não está conectado por Bluetooth LE."))
    }
  }

  /** Bytes úteis por escrita/notificação: MTU − 3 (cabeçalho ATT), no máximo 512 (teto de um atributo). */
  private fun payload(mtu: Int) = minOf(mtu - 3, 512)

  private fun writeFrames(c: Client, frames: List<ByteArray>, done: ((Throwable?) -> Unit)?) {
    val pending = Pending(frames.size, done)
    frames.forEach { c.ops.addLast(Op.Write(it, pending)) }
    pump(c)
  }

  private fun notifyFrames(device: BluetoothDevice, frames: List<ByteArray>, done: ((Throwable?) -> Unit)?) {
    val pending = Pending(frames.size, done)
    frames.forEach { notifyQueue.addLast(Notify(device, it, pending)) }
    pumpNotify()
  }

  // ---------------------------------------------------------------- recepção

  private fun receive(id: String, chunk: ByteArray) {
    when (val r = reassembler.push(id, chunk)) {
      is BleFrames.Result.Hello -> {
        if (names[id] != r.name) { names[id] = r.name; listener.onPeerFound(id, r.name) }
      }
      is BleFrames.Result.Envelope -> listener.onEnvelope(id, r.data)
      null -> Unit
    }
  }

  /** Recalcula se o vizinho está conectado (por qualquer papel) e avisa o app quando muda. */
  private fun refresh(id: String) {
    val now = clients[id]?.ready == true || subscribers.containsKey(id)
    val was = synchronized(up) { id in up }
    if (now && !was) {
      synchronized(up) { up += id }
      listener.onConnected(id, names[id])
    } else if (!now && was) {
      synchronized(up) { up -= id }
      reassembler.clear(id)
      listener.onDisconnected(id)
    }
    if (!now && !clients.containsKey(id)) {
      listener.onPeerLost(id)
      names.remove(id)
    }
  }

  // ---------------------------------------------------------------- central (procura e conecta)

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      handler.post { onFound(result) }
    }

    override fun onBatchScanResults(results: MutableList<ScanResult>) {
      handler.post { results.forEach { onFound(it) } }
    }

    override fun onScanFailed(errorCode: Int) {
      handler.post { if (server == null) listener.onBleState(false, "Falha na busca Bluetooth LE ($errorCode).") }
    }
  }

  private fun onFound(result: ScanResult) {
    if (stopped) return
    val device = result.device
    val id = device.address
    // Já conectado (por nós ou porque ele conectou em nós), ou tentou há pouco.
    if (clients.containsKey(id) || subscribers.containsKey(id)) return
    if ((retryAt[id] ?: 0L) > SystemClock.elapsedRealtime()) return
    if (clients.size >= MAX_CLIENTS) return
    val record = result.scanRecord
    // Android anuncia o nome no service data; iPhone, no nome local.
    val advName = record?.getServiceData(ParcelUuid(SERVICE))?.takeIf { it.isNotEmpty() }?.let { String(it, Charsets.UTF_8) }
      ?: record?.deviceName
    if (advName != null) names[id] = advName
    listener.onPeerFound(id, names[id] ?: "piu")
    val c = Client(device)
    clients[id] = c
    c.gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    if (c.gatt == null) { clients.remove(id); retryAt[id] = SystemClock.elapsedRealtime() + RETRY_MS }
  }

  private fun dropClient(id: String) {
    val c = clients.remove(id) ?: return
    try { c.gatt?.close() } catch (_: Exception) {}
    val err = IllegalStateException("Conexão Bluetooth LE com $id caiu.")
    (c.current as? Op.Write)?.pending?.step(err)
    c.ops.forEach { (it as? Op.Write)?.pending?.step(err) }
    c.ops.clear(); c.current = null
    retryAt[id] = SystemClock.elapsedRealtime() + RETRY_MS
    refresh(id)
  }

  private fun pump(c: Client) {
    if (c.current != null) return
    val gatt = c.gatt ?: return
    val op = c.ops.removeFirstOrNull() ?: return
    c.current = op
    val ok = when (op) {
      is Op.Descriptor -> writeDescriptor(gatt, op.descriptor, op.value)
      is Op.Write -> c.inbox?.let { writeCharacteristic(gatt, it, op.value) } ?: false
    }
    if (!ok) { finishOp(c, false); return }
    // Sem resposta do sistema em 10 s: o enlace travou.
    handler.postDelayed({ if (c.current === op) { finishOp(c, false); c.gatt?.disconnect() } }, OP_TIMEOUT_MS)
  }

  private fun finishOp(c: Client, success: Boolean) {
    val op = c.current ?: return
    c.current = null
    when (op) {
      is Op.Write -> {
        op.pending.step(if (success) null else IllegalStateException("Falha ao escrever no vizinho por Bluetooth LE."))
        // Bloco perdido: o resto daquele envelope não adianta.
        if (!success) c.ops.removeAll { (it as? Op.Write)?.pending === op.pending }
      }
      is Op.Descriptor -> if (op.descriptor.uuid == CCCD) {
        if (success) {
          c.ready = true
          refresh(c.device.address)
          // Apresenta-se: o periférico não vê o nosso anúncio.
          writeFrames(c, listOf(BleFrames.hello(localName)), null)
        } else {
          c.gatt?.disconnect()
        }
      }
    }
    pump(c)
  }

  @Suppress("DEPRECATION")
  private fun writeCharacteristic(gatt: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      gatt.writeCharacteristic(ch, value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
    } else {
      ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      ch.setValue(value) // setter Java devolve Boolean: chamada explícita em vez de `ch.value =`
      gatt.writeCharacteristic(ch)
    }

  @Suppress("DEPRECATION")
  private fun writeDescriptor(gatt: BluetoothGatt, d: BluetoothGattDescriptor, value: ByteArray): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      gatt.writeDescriptor(d, value) == BluetoothStatusCodes.SUCCESS
    } else {
      d.setValue(value)
      gatt.writeDescriptor(d)
    }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      handler.post {
        val id = gatt.device.address
        val c = clients[id]
        if (c == null || stopped) { gatt.close(); return@post }
        if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
          if (!gatt.requestMtu(DESIRED_MTU)) gatt.discoverServices()
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
          dropClient(id)
        }
      }
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      handler.post {
        val c = clients[gatt.device.address] ?: return@post
        if (status == BluetoothGatt.GATT_SUCCESS) c.mtu = mtu
        if (!c.ready && c.inbox == null) gatt.discoverServices()
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      handler.post {
        val c = clients[gatt.device.address] ?: return@post
        val service = gatt.getService(SERVICE)
        val inbox = service?.getCharacteristic(INBOX)
        val out = service?.getCharacteristic(OUTBOX)
        val cccd = out?.getDescriptor(CCCD)
        if (status != BluetoothGatt.GATT_SUCCESS || inbox == null || out == null || cccd == null) { gatt.disconnect(); return@post }
        c.inbox = inbox
        gatt.setCharacteristicNotification(out, true)
        c.ops.addFirst(Op.Descriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE))
        pump(c)
      }
    }

    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      handler.post { clients[gatt.device.address]?.let { finishOp(it, status == BluetoothGatt.GATT_SUCCESS) } }
    }

    override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      handler.post { clients[gatt.device.address]?.let { finishOp(it, status == BluetoothGatt.GATT_SUCCESS) } }
    }

    // Android 13+.
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      if (characteristic.uuid != OUTBOX) return
      val copy = value.copyOf()
      handler.post { receive(gatt.device.address, copy) }
    }

    // Até o Android 12.
    @Deprecated("Substituído no Android 13", ReplaceWith(""))
    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
      if (characteristic.uuid != OUTBOX) return
      val copy = characteristic.value?.copyOf() ?: return
      handler.post { receive(gatt.device.address, copy) }
    }
  }

  // ---------------------------------------------------------------- periférico (anuncia e aceita)

  private fun openServer() {
    // Sem servidor GATT o aparelho ainda procura e conecta (papel central).
    val s = manager?.openGattServer(context, serverCallback) ?: run {
      android.util.Log.w("PiuTransport", "Não foi possível abrir o servidor GATT.")
      return
    }
    val service = BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    val inbox = BluetoothGattCharacteristic(INBOX, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE)
    val out = BluetoothGattCharacteristic(OUTBOX, BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ)
    out.addDescriptor(BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
    service.addCharacteristic(inbox)
    service.addCharacteristic(out)
    server = s
    outbox = out
    s.addService(service) // anuncia em onServiceAdded
  }

  private fun startAdvertising() {
    val adv = manager?.adapter?.bluetoothLeAdvertiser ?: return // aparelho sem papel periférico: só procura
    advertiser = adv
    val nameBytes = localName.toByteArray(Charsets.UTF_8).let { if (it.size > ADV_NAME_MAX) it.copyOf(ADV_NAME_MAX) else it }
    adv.startAdvertising(
      AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
        .setConnectable(true)
        .setTimeout(0)
        .build(),
      AdvertiseData.Builder().setIncludeDeviceName(false).setIncludeTxPowerLevel(false).addServiceUuid(ParcelUuid(SERVICE)).build(),
      AdvertiseData.Builder().setIncludeDeviceName(false).setIncludeTxPowerLevel(false).addServiceData(ParcelUuid(SERVICE), nameBytes).build(),
      advertiseCallback,
    )
  }

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartFailure(errorCode: Int) {
      // Continua só procurando (papel central): ainda fala com quem anuncia.
      android.util.Log.w("PiuTransport", "Anúncio BLE falhou: $errorCode")
    }
  }

  @Suppress("DEPRECATION")
  private fun notifyPeer(device: BluetoothDevice, value: ByteArray): Boolean {
    val s = server ?: return false
    val ch = outbox ?: return false
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      s.notifyCharacteristicChanged(device, ch, false, value) == BluetoothStatusCodes.SUCCESS
    } else {
      ch.setValue(value)
      s.notifyCharacteristicChanged(device, ch, false)
    }
  }

  /** Uma notificação por vez: a próxima só depois de `onNotificationSent`. */
  private fun pumpNotify() {
    if (notifying != null) return
    while (true) {
      val n = notifyQueue.removeFirstOrNull() ?: return
      if (n.pending.finished) continue
      if (!subscribers.containsKey(n.device.address)) { n.pending.step(IllegalStateException("Vizinho saiu.")); continue }
      notifying = n
      if (notifyPeer(n.device, n.value)) {
        handler.postDelayed({ if (notifying === n) onNotified(n.device, false) }, OP_TIMEOUT_MS)
        return
      }
      notifying = null
      n.pending.step(IllegalStateException("Falha ao notificar o vizinho por Bluetooth LE."))
    }
  }

  private fun onNotified(device: BluetoothDevice, success: Boolean) {
    val n = notifying ?: return
    if (n.device.address != device.address) return
    notifying = null
    n.pending.step(if (success) null else IllegalStateException("Falha ao notificar o vizinho por Bluetooth LE."))
    if (!success) notifyQueue.removeAll { it.pending === n.pending }
    pumpNotify()
  }

  private fun unsubscribe(id: String) {
    subscribers.remove(id) ?: return
    val err = IllegalStateException("Vizinho $id saiu.")
    notifyQueue.filter { it.device.address == id }.forEach { it.pending.step(err) }
    notifyQueue.removeAll { it.device.address == id }
    if (notifying?.device?.address == id) { notifying?.pending?.step(err); notifying = null; pumpNotify() }
    refresh(id)
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onServiceAdded(status: Int, service: BluetoothGattService) {
      handler.post { if (!stopped && service.uuid == SERVICE && status == BluetoothGatt.GATT_SUCCESS) startAdvertising() }
    }

    override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
      handler.post {
        if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          serverMtu.remove(device.address)
          unsubscribe(device.address)
          // Quem só escreveu o hello (sem se inscrever) também sai: sem isto o nome ficava para sempre.
          val id = device.address
          if (!clients.containsKey(id) && !subscribers.containsKey(id)) {
            reassembler.clear(id)
            if (names.containsKey(id)) refresh(id)
          }
        }
      }
    }

    override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
      handler.post { serverMtu[device.address] = mtu }
    }

    override fun onCharacteristicWriteRequest(
      device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?,
    ) {
      val ok = characteristic.uuid == INBOX && !preparedWrite && offset == 0 && value != null
      if (responseNeeded) {
        server?.sendResponse(device, requestId, if (ok) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null)
      }
      if (!ok) return
      val copy = value!!.copyOf()
      handler.post { receive(device.address, copy) }
    }

    override fun onDescriptorWriteRequest(
      device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
      preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?,
    ) {
      val isCccd = descriptor.uuid == CCCD && descriptor.characteristic?.uuid == OUTBOX
      if (responseNeeded) {
        server?.sendResponse(device, requestId, if (isCccd) BluetoothGatt.GATT_SUCCESS else BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, 0, null)
      }
      if (!isCccd) return
      val enable = value != null && value.isNotEmpty() && (value[0].toInt() and 0x01) != 0
      handler.post {
        val id = device.address
        if (enable && !subscribers.containsKey(id)) {
          subscribers[id] = device
          refresh(id)
          notifyFrames(device, listOf(BleFrames.hello(localName)), null)
        } else if (!enable) {
          unsubscribe(id)
        }
      }
    }

    override fun onDescriptorReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, descriptor: BluetoothGattDescriptor) {
      val value = if (subscribers.containsKey(device.address)) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
      server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
    }

    override fun onNotificationSent(device: BluetoothDevice, status: Int) {
      handler.post { onNotified(device, status == BluetoothGatt.GATT_SUCCESS) }
    }
  }
}
