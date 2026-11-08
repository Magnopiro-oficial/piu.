package expo.modules.piuvoice

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Serviço em primeiro plano do microfone durante a chamada (tipo `microphone`): sem ele o Android
 * corta o microfone quando a tela bloqueia ou o app sai da frente. Aviso contínuo "Em chamada com X"
 * com a ação Desligar. Quem liga e desliga é o JS (src/calls/callAlert.ts: só com a chamada ativa).
 *
 * Android 14+: o tipo `microphone` exige RECORD_AUDIO concedida e o app à vista ao subir. Por isso o
 * pedido espera a permissão (sobe quando o PiuVoice abre o microfone) e, se o sistema recusar com o
 * app em segundo plano, tenta de novo quando o app volta para a frente.
 */
class PiuCallService : Service() {
  companion object {
    private const val TAG = "PiuVoice"
    private const val IDLE = 0
    private const val STARTING = 1
    private const val UP = 2

    private var wanted: Bundle? = null
    private var state = IDLE

    private fun micGranted(ctx: Context) =
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /** O JS pede o aviso (chamada ativa). */
    @Synchronized fun request(ctx: Context, extras: Bundle) {
      wanted = extras
      if (micGranted(ctx)) launch(ctx)
    }

    /** O microfone abriu ou o app voltou para a frente: sobe o pedido que esperava. */
    @Synchronized fun retry(ctx: Context) {
      if (wanted != null && state == IDLE && micGranted(ctx)) launch(ctx)
    }

    @Synchronized fun stop(ctx: Context) {
      wanted = null
      // Subindo: parar antes do startForeground derruba o app; o onStartCommand sobe e desce na hora.
      if (state == UP) {
        state = IDLE
        ctx.stopService(Intent(ctx, PiuCallService::class.java))
      }
    }

    private fun launch(ctx: Context) {
      val e = wanted ?: return
      try {
        ContextCompat.startForegroundService(ctx, Intent(ctx, PiuCallService::class.java).putExtras(e))
        if (state == IDLE) state = STARTING
      } catch (x: Exception) {
        // Android 12+: app em segundo plano não sobe serviço; tenta de novo quando voltar para a frente.
        Log.w(TAG, "Serviço do microfone não iniciou: ${x.message}")
      }
    }

    @Synchronized private fun started(): Boolean {
      if (wanted == null) { state = IDLE; return false }
      state = UP
      return true
    }

    @Synchronized private fun failed() { state = IDLE }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val e = intent?.extras ?: Bundle()
    CallNotes.ensureChannel(this, CallNotes.CH_ONGOING, e.getString("channel") ?: "", e.getString("channelDesc") ?: "")
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
    try {
      ServiceCompat.startForeground(this, CallNotes.ID_ONGOING, CallNotes.ongoing(this, e), type)
    } catch (x: Exception) {
      Log.w(TAG, "Serviço do microfone recusado: ${x.message}")
      failed()
      stopSelf()
      return START_NOT_STICKY
    }
    if (!started()) {
      // A chamada acabou enquanto o serviço subia.
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
      stopSelf()
    }
    // Se o sistema matar o processo, não recria: a chamada vive no JS, que já terá acabado.
    return START_NOT_STICKY
  }
}
