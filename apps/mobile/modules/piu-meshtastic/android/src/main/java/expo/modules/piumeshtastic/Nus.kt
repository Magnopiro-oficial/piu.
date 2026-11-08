package expo.modules.piumeshtastic

import java.util.UUID

/**
 * Serviço Nordic UART do RNode (markqvist/RNode_Firmware, BLE): o celular escreve em RX e o rádio
 * notifica em TX. Os bytes são KISS crus; a configuração e o protocolo ficam no JS (src/transport/rnode).
 */
object Nus {
  val SERVICE: UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
  /** Escrita do celular para o rádio. */
  val RX: UUID = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")
  /** Notificação do rádio para o celular. */
  val TX: UUID = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")

  // BluetoothGattCharacteristic.PROPERTY_* e WRITE_TYPE_* (repetidos para testar sem o Android).
  const val PROP_WRITE_NR = 0x04
  const val PROP_WRITE = 0x08
  const val WRITE_NO_RESPONSE = 1
  const val WRITE_DEFAULT = 2

  /** Pedaços de uma escrita que cabem no MTU (3 bytes do cabeçalho ATT). */
  fun chunks(bytes: ByteArray, mtu: Int): List<ByteArray> {
    val n = (mtu - 3).coerceAtLeast(20)
    return (bytes.indices step n).map { bytes.copyOfRange(it, minOf(it + n, bytes.size)) }
  }

  /** Com resposta quando o rádio aceita (ordem e controle de fluxo); senão sem resposta; null: não dá para escrever. */
  fun writeType(props: Int): Int? = when {
    props and PROP_WRITE != 0 -> WRITE_DEFAULT
    props and PROP_WRITE_NR != 0 -> WRITE_NO_RESPONSE
    else -> null
  }

  /** O RNode nem sempre anuncia o serviço no pacote de anúncio: vale também o nome "RNode …". */
  fun isRNode(name: String?, services: List<UUID>): Boolean =
    SERVICE in services || name?.startsWith("RNode") == true
}
