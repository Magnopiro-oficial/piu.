package expo.modules.piumeshtastic

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Cliente BLE (central) do rádio próprio do Piu: firmware RNode pelo serviço Nordic UART ([Nus]).
 * Só Bluetooth e bytes KISS crus; a configuração do rádio fica no JS (src/transport/rnode). O mesmo
 * desenho do [PiuMeshtasticModule]: tudo na thread "piu-rnode", fila [GattQueue], pareamento por PIN
 * (o que aparece na tela da placa) com o diálogo do Android. Reconexão não é automática.
 */
@SuppressLint("MissingPermission")
class PiuRNodeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val thread = HandlerThread("piu-rnode").apply { start() }
  private val handler = Handler(thread.looper)
  private val queue = GattQueue { ms, fn ->
    val r = Runnable(fn); handler.postDelayed(r, ms); Cancel { handler.removeCallbacks(r) }
  }

  private var gatt: BluetoothGatt? = null
  private var rx: BluetoothGattCharacteristic? = null
  private var rxType = Nus.WRITE_DEFAULT
  private var mtu = 23
  private var connectPromise: Promise? = null
  private var connectTimeout: Runnable? = null
  private var scanCallback: ScanCallback? = null
  private var scanStop: Runnable? = null
  private var bondReceiver: BroadcastReceiver? = null
  private var connected = false

  private fun adapter(): BluetoothAdapter? =
    (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  private fun has(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

  private fun permOk(scan: Boolean): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) has(if (scan) Manifest.permission.BLUETOOTH_SCAN else Manifest.permission.BLUETOOTH_CONNECT)
    else has(Manifest.permission.ACCESS_FINE_LOCATION) || !scan

  private fun state(s: String, reason: String? = null) =
    sendEvent("onState", if (reason == null) mapOf("state" to s) else mapOf("state" to s, "reason" to reason))

  override fun definition() = ModuleDefinition {
    Name("PiuRNode")
    Events("onDevice", "onData", "onState")

    Function("isAvailable") {
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) && adapter() != null
    }

    AsyncFunction("scan") { seconds: Double, promise: Promise ->
      handler.post { scan(seconds, promise) }
    }

    AsyncFunction("connect") { id: String, promise: Promise ->
      handler.post { connect(id, promise) }
    }

    AsyncFunction("write") { bytes: ByteArray, promise: Promise ->
      handler.post { write(bytes, promise) }
    }

    Function("disconnect") { handler.post { close("disconnected", null) }; Unit }

    OnDestroy {
      handler.post { stopScan(); close(null, null); thread.quitSafely() }
    }
  }

  // ---- scan ----

  private fun scan(seconds: Double, promise: Promise) {
    if (!permOk(true)) return promise.reject(CodedException("PERMISSION", "Sem permissão de Bluetooth (busca).", null))
    val scanner = adapter()?.takeIf { it.isEnabled }?.bluetoothLeScanner
      ?: return promise.reject(CodedException("BT_OFF", "Bluetooth desligado ou ausente.", null))
    stopScan()
    val cb = object : ScanCallback() {
      override fun onScanResult(type: Int, r: ScanResult) {
        val name = r.scanRecord?.deviceName ?: runCatching { r.device.name }.getOrNull()
        val uuids = r.scanRecord?.serviceUuids?.map { it.uuid } ?: emptyList()
        if (!Nus.isRNode(name, uuids)) return
        val addr = r.device.address
        handler.post { sendEvent("onDevice", mapOf("id" to addr, "name" to (name ?: ""), "rssi" to r.rssi)) }
      }
      override fun onScanFailed(errorCode: Int) {
        handler.post { stopScan(); state("error", "scan:$errorCode") }
      }
    }
    // Sem filtro de serviço: o RNode pode anunciar só o nome (o filtro fica em Nus.isRNode).
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    try {
      scanner.startScan(null, settings, cb)
    } catch (e: SecurityException) {
      return promise.reject(CodedException("PERMISSION", e.message ?: "Sem permissão de Bluetooth.", e))
    }
    scanCallback = cb
    if (!connected) state("scanning")
    val stop = Runnable { stopScan(); if (!connected && gatt == null) state("idle"); promise.resolve(null) }
    scanStop = stop
    handler.postDelayed(stop, (seconds.coerceIn(1.0, 60.0) * 1000).toLong())
  }

  private fun stopScan() {
    scanStop?.let { handler.removeCallbacks(it) }; scanStop = null
    val cb = scanCallback ?: return
    scanCallback = null
    runCatching { adapter()?.bluetoothLeScanner?.stopScan(cb) }
  }

  // ---- conexão ----

  private fun connect(id: String, promise: Promise) {
    if (!permOk(false)) return promise.reject(CodedException("PERMISSION", "Sem permissão de Bluetooth (conexão).", null))
    val ad = adapter()?.takeIf { it.isEnabled }
      ?: return promise.reject(CodedException("BT_OFF", "Bluetooth desligado ou ausente.", null))
    if (!BluetoothAdapter.checkBluetoothAddress(id)) return promise.reject(CodedException("ERR_ARG", "Endereço inválido: $id", null))
    stopScan()
    close(null, null)
    connectPromise = promise
    state("connecting")
    val t = Runnable { close("error", "timeout") }
    connectTimeout = t
    handler.postDelayed(t, CONNECT_TIMEOUT_MS)
    val dev = ad.getRemoteDevice(id)
    gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      dev.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE, BluetoothDevice.PHY_LE_1M_MASK, handler)
    else dev.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
    if (gatt == null) close("error", "connectGatt")
  }

  private fun setup(g: BluetoothGatt) {
    // MTU: falhar não é fatal (fica 23; as escritas saem em pedaços menores).
    queue.enqueue(GattQueue.Op("mtu", 5_000, { g.requestMtu(512) }) { })
    queue.enqueue(GattQueue.Op("discover", 15_000, { g.discoverServices() }) { r ->
      r.exceptionOrNull()?.let { return@Op close("error", "discover: ${it.message}") }
      val svc = g.getService(Nus.SERVICE) ?: return@Op close("error", "no_service")
      val w = svc.getCharacteristic(Nus.RX)
      val tx = svc.getCharacteristic(Nus.TX)
      if (w == null || tx == null) return@Op close("error", "no_characteristic")
      rxType = Nus.writeType(w.properties) ?: return@Op close("error", "no_characteristic")
      rx = w
      enableNotify(g, tx, bondRetry = true)
    })
  }

  private fun enableNotify(g: BluetoothGatt, ch: BluetoothGattCharacteristic, bondRetry: Boolean) {
    val d = ch.getDescriptor(MeshtasticUuids.CCCD) ?: return close("error", "no_cccd")
    queue.enqueue(GattQueue.Op("notify", 10_000, {
      g.setCharacteristicNotification(ch, true) && writeDescriptor(g, d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
    }) { r ->
      val e = r.exceptionOrNull()
      if (e == null) return@Op ready(g)
      val auth = e is GattError && e.code == "AUTH"
      if (auth && bondRetry) awaitBond(g) { enableNotify(g, ch, bondRetry = false) }
      else close("error", if (auth) "bond" else "notify: ${e.message}")
    })
  }

  /** O RNode pede pareamento (PIN na tela da placa): o diálogo é do Android. Espera BONDED e tenta de novo uma vez. */
  private fun awaitBond(g: BluetoothGatt, then: () -> Unit) {
    val dev = g.device
    if (dev.bondState == BluetoothDevice.BOND_BONDED) return then()
    state("connecting", "bond")
    val rx = object : BroadcastReceiver() {
      override fun onReceive(c: Context, i: Intent) {
        val d: BluetoothDevice? = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
          else @Suppress("DEPRECATION") i.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        if (d?.address != dev.address) return
        when (i.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR)) {
          BluetoothDevice.BOND_BONDED -> { unregisterBond(); then() }
          BluetoothDevice.BOND_NONE -> { unregisterBond(); close("error", "bond") }
        }
      }
    }
    bondReceiver = rx
    ContextCompat.registerReceiver(context, rx, IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED), null, handler, ContextCompat.RECEIVER_EXPORTED)
    // O prazo do PIN é da pessoa: estende o timeout de conexão.
    connectTimeout?.let { handler.removeCallbacks(it); handler.postDelayed(it, BOND_TIMEOUT_MS) }
    if (dev.bondState == BluetoothDevice.BOND_NONE && !dev.createBond()) { unregisterBond(); close("error", "bond") }
  }

  private fun unregisterBond() {
    bondReceiver?.let { runCatching { context.unregisterReceiver(it) } }
    bondReceiver = null
  }

  private fun ready(g: BluetoothGatt) {
    if (g !== gatt) return
    connectTimeout?.let { handler.removeCallbacks(it) }; connectTimeout = null
    connected = true
    state("connected")
    connectPromise?.resolve(null); connectPromise = null
  }

  /** Fecha tudo. `st` = estado a emitir (null = silencioso, ex.: antes de nova conexão). */
  private fun close(st: String?, reason: String?) {
    connectTimeout?.let { handler.removeCallbacks(it) }; connectTimeout = null
    unregisterBond()
    queue.clear(GattError("DISCONNECTED", reason ?: "desconectado"))
    gatt?.let { runCatching { it.disconnect() }; runCatching { it.close() } }
    val had = gatt != null
    gatt = null; rx = null; connected = false; mtu = 23
    connectPromise?.reject(CodedException(if (reason == "timeout") "TIMEOUT" else "ERR_CONNECT", reason ?: "Conexão encerrada.", null))
    connectPromise = null
    if (st != null && (had || st == "error")) state(st, reason)
  }

  // ---- E/S ----

  /** Um quadro KISS, em pedaços do MTU, na ordem; resolve quando o último foi aceito. */
  private fun write(bytes: ByteArray, promise: Promise) {
    val g = gatt; val ch = rx
    if (!connected || g == null || ch == null) return promise.reject(CodedException("NOT_CONNECTED", "Rádio não conectado.", null))
    val parts = Nus.chunks(bytes, mtu)
    if (parts.isEmpty()) return promise.resolve(null)
    var failed = false
    parts.forEachIndexed { i, p ->
      queue.enqueue(GattQueue.Op("write", 10_000, { !failed && writeChar(g, ch, p) }) { r ->
        val e = r.exceptionOrNull()
        if (e != null && !failed) { failed = true; promise.reject(coded(e)) }
        else if (e == null && i == parts.lastIndex) promise.resolve(null)
      })
    }
  }

  @Suppress("DEPRECATION")
  private fun writeChar(g: BluetoothGatt, ch: BluetoothGattCharacteristic, v: ByteArray): Boolean =
    if (Build.VERSION.SDK_INT >= 33) g.writeCharacteristic(ch, v, rxType) == BluetoothGatt.GATT_SUCCESS
    else { ch.writeType = rxType; ch.value = v; g.writeCharacteristic(ch) }

  @Suppress("DEPRECATION")
  private fun writeDescriptor(g: BluetoothGatt, d: BluetoothGattDescriptor, v: ByteArray): Boolean =
    if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(d, v) == BluetoothGatt.GATT_SUCCESS
    else { d.value = v; g.writeDescriptor(d) }

  private fun statusResult(status: Int) {
    when (status) {
      BluetoothGatt.GATT_SUCCESS -> queue.complete()
      GATT_INSUFFICIENT_AUTHENTICATION, GATT_INSUFFICIENT_ENCRYPTION, GATT_AUTH_FAIL ->
        queue.fail(GattError("AUTH", "pareamento necessário ($status)"))
      else -> queue.fail(GattError("ERR_GATT", "${queue.currentName}: status $status"))
    }
  }

  private fun data(ch: BluetoothGattCharacteristic, value: ByteArray?) {
    if (ch.uuid == Nus.TX && connected && value != null && value.isNotEmpty()) sendEvent("onData", mapOf("data" to value))
  }

  // Callbacks chegam na thread do handler (connectGatt com handler, API 26+); post garante nas antigas.
  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) = handler.post {
      if (g !== gatt) return@post runCatching { g.close() }.let { }
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) setup(g)
      else close(if (connected) "disconnected" else "error", if (connected) "link:$status" else "connect:$status")
    }.let { }

    override fun onMtuChanged(g: BluetoothGatt, value: Int, status: Int) = post(g) {
      if (status == BluetoothGatt.GATT_SUCCESS) mtu = value
      if (queue.currentName == "mtu") statusResult(status)
    }

    override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = post(g) {
      if (queue.currentName == "discover") statusResult(status)
    }

    override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) = post(g) {
      if (queue.currentName == "notify") statusResult(status)
    }

    override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) = post(g) {
      if (queue.currentName == "write") statusResult(status)
    }

    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
      val v = value.copyOf()
      post(g) { data(ch, v) }
    }

    @Deprecated("API < 33")
    @Suppress("DEPRECATION")
    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= 33) return
      val v = ch.value?.copyOf()
      post(g) { data(ch, v) }
    }
  }

  private fun post(g: BluetoothGatt, fn: () -> Unit) { handler.post { if (g === gatt) fn() } }

  private fun coded(e: Throwable): CodedException =
    e as? CodedException ?: CodedException((e as? GattError)?.code ?: "ERR_GATT", e.message ?: "Falha no Bluetooth.", e)

  companion object {
    const val CONNECT_TIMEOUT_MS = 20_000L
    const val BOND_TIMEOUT_MS = 60_000L
    const val GATT_INSUFFICIENT_AUTHENTICATION = 5
    const val GATT_INSUFFICIENT_ENCRYPTION = 15
    const val GATT_AUTH_FAIL = 137
  }
}
