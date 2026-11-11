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
import android.bluetooth.le.ScanFilter
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
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Cliente BLE (central) de um rádio Meshtastic. Só Bluetooth e bytes crus; protobuf fica no JS
 * (src/transport/meshtastic). Tudo que toca o GATT roda na thread "piu-meshtastic" (Handler), em
 * fila serializada ([GattQueue]). Reconexão não é automática: o JS decide.
 */
@SuppressLint("MissingPermission")
class PiuMeshtasticModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val thread = HandlerThread("piu-meshtastic").apply { start() }
  private val handler = Handler(thread.looper)
  private val queue = GattQueue { ms, fn ->
    val r = Runnable(fn); handler.postDelayed(r, ms); Cancel { handler.removeCallbacks(r) }
  }
  private val drainer = FromRadioDrainer(read = ::readFromRadio, emit = { sendEvent("onFromRadio", mapOf("data" to it)) })

  private var gatt: BluetoothGatt? = null
  private var toRadio: BluetoothGattCharacteristic? = null
  private var fromRadio: BluetoothGattCharacteristic? = null
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
    Name("PiuMeshtastic")
    Events("onDevice", "onFromRadio", "onState")

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

    AsyncFunction("drain") { promise: Promise ->
      handler.post {
        if (!connected) return@post promise.reject(CodedException("NOT_CONNECTED", "Rádio não conectado.", null))
        drainer.request { e -> if (e == null) promise.resolve(null) else promise.reject(coded(e)) }
      }
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
        val addr = r.device.address
        handler.post {
          sendEvent("onDevice", mapOf(
            "id" to addr,
            "name" to (r.scanRecord?.deviceName ?: runCatching { r.device.name }.getOrNull() ?: ""),
            "rssi" to r.rssi,
          ))
        }
      }
      override fun onScanFailed(errorCode: Int) {
        handler.post { stopScan(); state("error", "scan:$errorCode") }
      }
    }
    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(MeshtasticUuids.SERVICE)).build()
    val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    try {
      scanner.startScan(listOf(filter), settings, cb)
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
    // MTU: falhar não é fatal (fica 23; o rádio fragmenta igual nas leituras longas).
    queue.enqueue(GattQueue.Op("mtu", 5_000, { g.requestMtu(512) }) { })
    queue.enqueue(GattQueue.Op("discover", 15_000, { g.discoverServices() }) { r ->
      r.exceptionOrNull()?.let { return@Op close("error", "discover: ${it.message}") }
      val svc = g.getService(MeshtasticUuids.SERVICE) ?: return@Op close("error", "no_service")
      toRadio = svc.getCharacteristic(MeshtasticUuids.TO_RADIO)
      fromRadio = svc.getCharacteristic(MeshtasticUuids.FROM_RADIO)
      val fromNum = svc.getCharacteristic(MeshtasticUuids.FROM_NUM)
      if (toRadio == null || fromRadio == null || fromNum == null) return@Op close("error", "no_characteristic")
      enableNotify(g, fromNum, bondRetry = true)
    })
  }

  private fun enableNotify(g: BluetoothGatt, ch: BluetoothGattCharacteristic, bondRetry: Boolean) {
    val d = ch.getDescriptor(MeshtasticUuids.CCCD) ?: return close("error", "no_cccd")
    queue.enqueue(GattQueue.Op("notify", 10_000, {
      g.setCharacteristicNotification(ch, true) && writeDescriptor(g, d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
    }) { r ->
      val e = r.exceptionOrNull()
      // Mesma regra do RNode: só usa o rádio pareado (enlace BLE cifrado). Rádio sem PIN também pede o pareamento.
      if (e == null) return@Op awaitBond(g) { ready() }
      val auth = e is GattError && e.code == "AUTH"
      if (auth && bondRetry) awaitBond(g) { enableNotify(g, ch, bondRetry = false) }
      else close("error", if (auth) "bond" else "notify: ${e.message}")
    })
  }

  /** O rádio pede pareamento (PIN): o diálogo é do Android. Espera BONDED e tenta de novo uma vez. */
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

  private fun ready() {
    connectTimeout?.let { handler.removeCallbacks(it) }; connectTimeout = null
    connected = true
    state("connected")
    connectPromise?.resolve(null); connectPromise = null
    drainer.request()
  }

  /** Fecha tudo. `st` = estado a emitir (null = silencioso, ex.: antes de nova conexão). */
  private fun close(st: String?, reason: String?) {
    connectTimeout?.let { handler.removeCallbacks(it) }; connectTimeout = null
    unregisterBond()
    val err = GattError("DISCONNECTED", reason ?: "desconectado")
    queue.clear(err)
    drainer.reset(err)
    gatt?.let { runCatching { it.disconnect() }; runCatching { it.close() } }
    val had = gatt != null
    gatt = null; toRadio = null; fromRadio = null; connected = false
    connectPromise?.reject(CodedException(if (reason == "timeout") "TIMEOUT" else "ERR_CONNECT", reason ?: "Conexão encerrada.", null))
    connectPromise = null
    if (st != null && (had || st == "error")) state(st, reason)
  }

  // ---- E/S ----

  private fun write(bytes: ByteArray, promise: Promise) {
    val g = gatt; val ch = toRadio
    if (!connected || g == null || ch == null) return promise.reject(CodedException("NOT_CONNECTED", "Rádio não conectado.", null))
    queue.enqueue(GattQueue.Op("write", 10_000, { writeChar(g, ch, bytes) }) { r ->
      r.exceptionOrNull()?.let { promise.reject(coded(it)) } ?: promise.resolve(null)
    })
  }

  private fun readFromRadio(cb: (Result<ByteArray?>) -> Unit) {
    val g = gatt; val ch = fromRadio
    if (g == null || ch == null) return cb(Result.failure(GattError("NOT_CONNECTED", "Rádio não conectado.")))
    queue.enqueue(GattQueue.Op("read", 10_000, { g.readCharacteristic(ch) }, cb))
  }

  @Suppress("DEPRECATION")
  private fun writeChar(g: BluetoothGatt, ch: BluetoothGattCharacteristic, v: ByteArray): Boolean {
    val type = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
    return if (Build.VERSION.SDK_INT >= 33) g.writeCharacteristic(ch, v, type) == BluetoothGatt.GATT_SUCCESS
    else { ch.writeType = type; ch.value = v; g.writeCharacteristic(ch) }
  }

  @Suppress("DEPRECATION")
  private fun writeDescriptor(g: BluetoothGatt, d: BluetoothGattDescriptor, v: ByteArray): Boolean =
    if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(d, v) == BluetoothGatt.GATT_SUCCESS
    else { d.value = v; g.writeDescriptor(d) }

  private fun statusResult(status: Int, value: ByteArray? = null) {
    when (status) {
      BluetoothGatt.GATT_SUCCESS -> queue.complete(value)
      GATT_INSUFFICIENT_AUTHENTICATION, GATT_INSUFFICIENT_ENCRYPTION, GATT_AUTH_FAIL ->
        queue.fail(GattError("AUTH", "pareamento necessário ($status)"))
      else -> queue.fail(GattError("ERR_GATT", "${queue.currentName}: status $status"))
    }
  }

  // Callbacks chegam na thread do handler (connectGatt com handler, API 26+); post garante nas antigas.
  private val callback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) = handler.post {
      if (g !== gatt) return@post runCatching { g.close() }.let { }
      if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) setup(g)
      else close(if (connected) "disconnected" else "error", if (connected) "link:$status" else "connect:$status")
    }.let { }

    override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) = post(g) {
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

    override fun onCharacteristicRead(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray, status: Int) = post(g) {
      if (queue.currentName == "read") statusResult(status, value.copyOf())
    }

    @Deprecated("API < 33")
    @Suppress("DEPRECATION")
    override fun onCharacteristicRead(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) {
      if (Build.VERSION.SDK_INT >= 33) return
      val v = ch.value?.copyOf()
      post(g) { if (queue.currentName == "read") statusResult(status, v) }
    }

    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) = post(g) {
      if (ch.uuid == MeshtasticUuids.FROM_NUM && connected) drainer.request()
    }

    @Deprecated("API < 33")
    override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
      if (Build.VERSION.SDK_INT >= 33) return
      post(g) { if (ch.uuid == MeshtasticUuids.FROM_NUM && connected) drainer.request() }
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
