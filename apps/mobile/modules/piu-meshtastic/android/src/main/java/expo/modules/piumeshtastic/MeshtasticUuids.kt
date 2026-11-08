package expo.modules.piumeshtastic

import java.util.UUID

/** meshtastic/firmware src/BluetoothCommon.h */
object MeshtasticUuids {
  val SERVICE: UUID = UUID.fromString("6ba1b218-15a8-461f-9fa8-5dcae273eafd")
  val TO_RADIO: UUID = UUID.fromString("f75c76d2-129e-4dad-a1dd-7866124401e7")
  val FROM_RADIO: UUID = UUID.fromString("2c55e69e-4993-11ed-b878-0242ac120002")
  val FROM_NUM: UUID = UUID.fromString("ed9da18c-a800-4f66-a670-aa7547e34453")
  /** Client Characteristic Configuration Descriptor (padrão BLE). */
  val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
}
