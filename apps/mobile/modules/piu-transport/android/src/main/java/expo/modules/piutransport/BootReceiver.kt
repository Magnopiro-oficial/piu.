package expo.modules.piutransport

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Religa o PiuRelayService (e com ele o núcleo sem tela) depois de reiniciar o aparelho ou atualizar o
 * app, se a última escolha foi deixá-lo ligado (`setBackground(true, …)`, guardada em SharedPreferences).
 * Sem LOCKED_BOOT_COMPLETED: antes do primeiro desbloqueio o Keystore e o armazenamento do app ficam
 * indisponíveis, e o núcleo não leria o cofre nem o salvo. BOOT_COMPLETED e MY_PACKAGE_REPLACED podem
 * iniciar serviço em primeiro plano `connectedDevice` (inclusive no Android 15).
 * Xiaomi com a Inicialização automática desligada e o app parado à força não recebem estes avisos.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!PiuRelayService.wanted(context)) return
    try {
      PiuRelayService.restart(context)
    } catch (e: Exception) {
      android.util.Log.w("PiuTransport", "Serviço não religou (${intent.action}): ${e.message}")
    }
  }
}
