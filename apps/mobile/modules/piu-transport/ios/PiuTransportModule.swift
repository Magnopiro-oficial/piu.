import CoreBluetooth
import ExpoModulesCore

/**
 * Transporte P2P no iPhone com Bluetooth LE: o aparelho é ao mesmo tempo central (procura e conecta)
 * e periférico (anuncia e aceita). Envelopes (bytes já cifrados pelo app) são divididos em blocos
 * do tamanho do MTU e remontados do outro lado. Só funciona com o app aberto (sem modo de fundo).
 * O protocolo (UUIDs e cabeçalho dos blocos) está em modules/piu-transport/README.md.
 */
public final class PiuTransportModule: Module {
  private var engine: BleEngine?

  public func definition() -> ModuleDefinition {
    Name("PiuTransport")
    Events("onState", "onPeerFound", "onPeerLost", "onConnected", "onDisconnected", "onEnvelope")

    Function("kind") { "ble" }

    AsyncFunction("start") { (name: String, _: String) in
      if self.engine != nil { return }
      self.engine = BleEngine(name: name) { [weak self] event, body in self?.sendEvent(event, body) }
    }

    AsyncFunction("stop") {
      self.engine?.stop()
      self.engine = nil
      self.sendEvent("onState", ["state": "off"])
    }

    AsyncFunction("send") { (peerId: String, data: String) throws in
      guard let engine = self.engine else { throw NotRunningException() }
      guard let bytes = Data(base64Encoded: data) else { throw InvalidEnvelopeException() }
      guard bytes.count <= 32 * 1024 else { throw TooLargeException() }
      try engine.send(to: peerId, bytes)
    }

    OnDestroy {
      self.engine?.stop()
      self.engine = nil
    }
  }
}

final class NotRunningException: Exception {
  override var reason: String { "O transporte não está ativo." }
}

final class InvalidEnvelopeException: Exception {
  override var reason: String { "Envelope inválido." }
}

final class TooLargeException: Exception {
  override var reason: String { "Envelope maior que 32 KB." }
}

final class PeerNotConnectedException: GenericException<String> {
  override var reason: String { "Vizinho \(param) não está conectado." }
}

private let serviceUUID = CBUUID(string: "02999473-3C58-4C4C-A014-DDA62869CFCE")
/** Central → periférico (escrita com resposta). */
private let inboxUUID = CBUUID(string: "7B41CD1F-85C3-400F-A6F9-5B89DD6B0915")
/** Periférico → central (notificação). */
private let outboxUUID = CBUUID(string: "E7D5F504-1483-497F-B64E-9DB52C4D3240")
/** Cabeçalho de cada bloco: id da mensagem (UInt32), índice (UInt16), total (UInt16), big-endian. */
private let headerSize = 8
/** Limites da remontagem (proteção de memória contra vizinho malicioso). */
private let maxEnvelopeBytes = 32 * 1024
private let maxPartialMessages = 64
private let partialTimeout: TimeInterval = 60

private final class BleEngine: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate, CBPeripheralDelegate {
  typealias Emit = (String, [String: Any?]) -> Void

  private let name: String
  private let emit: Emit
  private let queue = DispatchQueue(label: "piu.transport.ble")
  private var central: CBCentralManager!
  private var peripheralManager: CBPeripheralManager!

  // Papel central: periféricos encontrados e as características de escrita (inbox).
  private var peripherals: [UUID: CBPeripheral] = [:]
  private var inboxes: [UUID: CBCharacteristic] = [:]
  // Papel periférico: centrais inscritas na característica de notificação (outbox).
  private var outbox: CBMutableCharacteristic?
  private var subscribers: [UUID: CBCentral] = [:]
  private var pendingNotify: [(Data, CBCentral)] = []

  private var nextMessageId: UInt32 = 1
  private var partial: [String: (parts: [Int: Data], bytes: Int, started: Date)] = [:]

  init(name: String, emit: @escaping Emit) {
    self.name = name
    self.emit = emit
    super.init()
    emit("onState", ["state": "starting"])
    central = CBCentralManager(delegate: self, queue: queue)
    peripheralManager = CBPeripheralManager(delegate: self, queue: queue)
  }

  func stop() {
    queue.sync {
      central.stopScan()
      peripherals.values.forEach { central.cancelPeripheralConnection($0) }
      peripheralManager.stopAdvertising()
      peripheralManager.removeAllServices()
      peripherals.removeAll(); inboxes.removeAll(); subscribers.removeAll(); pendingNotify.removeAll(); partial.removeAll()
    }
  }

  // MARK: envio

  func send(to peerId: String, _ data: Data) throws {
    guard let id = UUID(uuidString: peerId) else { throw PeerNotConnectedException(peerId) }
    try queue.sync {
      if let p = peripherals[id], let inbox = inboxes[id] {
        for chunk in frames(data, mtu: p.maximumWriteValueLength(for: .withResponse)) {
          p.writeValue(chunk, for: inbox, type: .withResponse)
        }
      } else if let c = subscribers[id], let out = outbox {
        for chunk in frames(data, mtu: c.maximumUpdateValueLength) {
          if !peripheralManager.updateValue(chunk, for: out, onSubscribedCentrals: [c]) { pendingNotify.append((chunk, c)) }
        }
      } else {
        throw PeerNotConnectedException(peerId)
      }
    }
  }

  private func frames(_ data: Data, mtu: Int) -> [Data] {
    let size = max(1, mtu - headerSize)
    let count = max(1, Int((Double(data.count) / Double(size)).rounded(.up)))
    let id = nextMessageId
    nextMessageId &+= 1
    return (0..<count).map { i in
      var header = Data()
      withUnsafeBytes(of: id.bigEndian) { header.append(contentsOf: $0) }
      withUnsafeBytes(of: UInt16(i).bigEndian) { header.append(contentsOf: $0) }
      withUnsafeBytes(of: UInt16(count).bigEndian) { header.append(contentsOf: $0) }
      let start = i * size
      return header + data.subdata(in: start..<min(start + size, data.count))
    }
  }

  private func receive(_ chunk: Data, from peer: UUID) {
    guard chunk.count >= headerSize else { return }
    let bytes = [UInt8](chunk)
    let id = UInt32(bytes[0]) << 24 | UInt32(bytes[1]) << 16 | UInt32(bytes[2]) << 8 | UInt32(bytes[3])
    let index = Int(UInt16(bytes[4]) << 8 | UInt16(bytes[5]))
    let count = Int(UInt16(bytes[6]) << 8 | UInt16(bytes[7]))
    // Um envelope tem no máximo 32 KB: total de blocos acima disso é inválido.
    guard count > 0, index < count, count <= maxEnvelopeBytes else { return }
    let now = Date()
    partial = partial.filter { now.timeIntervalSince($0.value.started) < partialTimeout }
    let key = "\(peer.uuidString)-\(id)"
    var entry = partial[key] ?? (parts: [:], bytes: 0, started: now)
    if entry.parts.isEmpty && partial.count >= maxPartialMessages {
      // Muitas remontagens abertas: descarta a mais antiga.
      if let oldest = partial.min(by: { $0.value.started < $1.value.started })?.key { partial[oldest] = nil }
    }
    let data = chunk.subdata(in: headerSize..<chunk.count)
    if entry.parts[index] == nil { entry.parts[index] = data; entry.bytes += data.count }
    guard entry.bytes <= maxEnvelopeBytes else { partial[key] = nil; return }
    if entry.parts.count == count {
      partial[key] = nil
      let whole = (0..<count).reduce(into: Data()) { acc, i in acc.append(entry.parts[i] ?? Data()) }
      emit("onEnvelope", ["from": peer.uuidString, "data": whole.base64EncodedString()])
    } else {
      partial[key] = entry
    }
  }

  // MARK: central (procura e conecta)

  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    switch c.state {
    case .poweredOn:
      c.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
      emit("onState", ["state": "running"])
    case .unauthorized:
      emit("onState", ["state": "unavailable", "reason": "Permissão de Bluetooth negada."])
    case .unsupported:
      emit("onState", ["state": "unavailable", "reason": "Este aparelho não tem Bluetooth LE."])
    case .poweredOff:
      emit("onState", ["state": "unavailable", "reason": "Bluetooth desligado."])
    default: break
    }
  }

  func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData ad: [String: Any], rssi: NSNumber) {
    guard peripherals[p.identifier] == nil else { return }
    peripherals[p.identifier] = p
    let peerName = ad[CBAdvertisementDataLocalNameKey] as? String ?? p.name ?? "piu"
    emit("onPeerFound", ["id": p.identifier.uuidString, "name": peerName, "via": "ble"])
    p.delegate = self
    c.connect(p)
  }

  func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
    p.discoverServices([serviceUUID])
  }

  func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
    peripherals[p.identifier] = nil
  }

  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
    peripherals[p.identifier] = nil
    inboxes[p.identifier] = nil
    emit("onDisconnected", ["id": p.identifier.uuidString])
    emit("onPeerLost", ["id": p.identifier.uuidString])
  }

  func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    guard let service = p.services?.first(where: { $0.uuid == serviceUUID }) else { return }
    p.discoverCharacteristics([inboxUUID, outboxUUID], for: service)
  }

  func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    for ch in service.characteristics ?? [] {
      if ch.uuid == inboxUUID { inboxes[p.identifier] = ch }
      if ch.uuid == outboxUUID { p.setNotifyValue(true, for: ch) }
    }
    if inboxes[p.identifier] != nil { emit("onConnected", ["id": p.identifier.uuidString, "name": p.name]) }
  }

  func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
    guard ch.uuid == outboxUUID, let value = ch.value else { return }
    receive(value, from: p.identifier)
  }

  // MARK: periférico (anuncia e aceita)

  func peripheralManagerDidUpdateState(_ pm: CBPeripheralManager) {
    guard pm.state == .poweredOn else { return }
    let inbox = CBMutableCharacteristic(type: inboxUUID, properties: [.write], value: nil, permissions: [.writeable])
    let out = CBMutableCharacteristic(type: outboxUUID, properties: [.notify], value: nil, permissions: [.readable])
    let service = CBMutableService(type: serviceUUID, primary: true)
    service.characteristics = [inbox, out]
    outbox = out
    pm.add(service)
    pm.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceUUID], CBAdvertisementDataLocalNameKey: name])
  }

  func peripheralManager(_ pm: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for r in requests {
      if r.characteristic.uuid == inboxUUID, let value = r.value { receive(value, from: r.central.identifier) }
    }
    if let first = requests.first { pm.respond(to: first, withResult: .success) }
  }

  func peripheralManager(_ pm: CBPeripheralManager, central: CBCentral, didSubscribeTo ch: CBCharacteristic) {
    subscribers[central.identifier] = central
    emit("onConnected", ["id": central.identifier.uuidString])
  }

  func peripheralManager(_ pm: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom ch: CBCharacteristic) {
    subscribers[central.identifier] = nil
    emit("onDisconnected", ["id": central.identifier.uuidString])
  }

  func peripheralManagerIsReady(toUpdateSubscribers pm: CBPeripheralManager) {
    guard let out = outbox else { return }
    while let next = pendingNotify.first {
      if !pm.updateValue(next.0, for: out, onSubscribedCentrals: [next.1]) { return }
      pendingNotify.removeFirst()
    }
  }
}
