package expo.modules.piutransport

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Serviço em primeiro plano do Modo nó (NFR-009): mantém o processo vivo com o app em segundo
 * plano, para o transporte (Nearby + Bluetooth LE, que vivem no módulo) seguir retransmitindo.
 * Aviso fixo "Piu retransmitindo mensagens" enquanto estiver ligado. Tipo `connectedDevice`
 * (Android 14+ exige o tipo e uma permissão de Bluetooth concedida em tempo de execução).
 * Não abre conexões sozinho: só existe enquanto o app pede (`setBackground(true, …)`).
 */
class PiuRelayService : Service() {
  companion object {
    private const val CHANNEL = "piu-relay"
    private const val NOTIFICATION_ID = 0x5049 // "PI"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"

    fun start(context: Context, title: String, text: String) {
      val intent = Intent(context, PiuRelayService::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text)
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, PiuRelayService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Piu retransmitindo mensagens"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Modo nó ligado."
    ensureChannel()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(title, text), type)
    } catch (e: Exception) {
      // Android 12+: sem permissão para iniciar em primeiro plano agora (ex.: app já em segundo plano).
      android.util.Log.w("PiuTransport", "Serviço do Modo nó não iniciou: ${e.message}")
      stopSelf()
      return START_NOT_STICKY
    }
    // Se o sistema matar o processo, não recria sozinho: o transporte vive no app, que precisa reabrir.
    return START_NOT_STICKY
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(NotificationManager::class.java) ?: return
    if (nm.getNotificationChannel(CHANNEL) != null) return
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL, "Modo nó", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Aviso fixo enquanto o Piu retransmite mensagens em segundo plano."
        setShowBadge(false)
      },
    )
  }

  private fun notification(title: String, text: String): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val content = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .apply { if (content != null) setContentIntent(content) }
      .build()
  }
}
