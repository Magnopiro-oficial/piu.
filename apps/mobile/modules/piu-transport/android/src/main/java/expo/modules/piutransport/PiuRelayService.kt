package expo.modules.piutransport

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.lang.ref.WeakReference

/**
 * Serviço em primeiro plano (NFR-009): mantém o processo vivo com o app em segundo plano ou fechado,
 * para o núcleo JS (src/core) seguir recebendo e retransmitindo. Liga pelo Modo nó, pelo Ponto Piu ou
 * por "Receber com o app fechado" (src/state/background.ts). Aviso fixo enquanto estiver ligado.
 * Tipo `connectedDevice`.
 * Android 14+: o tipo exige UM destes pré-requisitos — permissão de manifesto CHANGE_NETWORK_STATE,
 * CHANGE_WIFI_STATE, CHANGE_WIFI_MULTICAST_STATE, NFC ou TRANSMIT_IR, OU uma de Bluetooth/UWB concedida
 * em tempo de execução. O app declara CHANGE_WIFI_STATE (este módulo) e CHANGE_WIFI_MULTICAST_STATE
 * (piu-lan), concedidas na instalação: quem usa só o Wi-Fi local (Bluetooth negado, ponto Piu) também
 * pode ligar o serviço. Se o sistema recusar mesmo assim, o `try` abaixo só registra e para o serviço.
 * - Tarefa sem tela `PiuCore` (src/core/coreTask.ts) pelo `HeadlessJsTaskContext`, sem herdar de
 *   `HeadlessJsTaskService` (o wake lock dele ficaria preso enquanto o serviço vive). Com a tarefa ativa,
 *   o React Native não pausa os timers JS em segundo plano; sem runtime (processo morto), `start()` sobe
 *   o JS sem tela. `allowedInForeground`: a pessoa pode reabrir o app com a tarefa rodando.
 * - A escolha (ligado, título e texto) fica em SharedPreferences: com ela ligada o serviço é
 *   `START_STICKY` e o sistema o recria com `intent == null` depois de matar o processo; o
 *   `BootReceiver` o religa depois de reiniciar o aparelho ou atualizar o app.
 * - Pulso a cada 5 s numa HandlerThread, com wake lock curto: o núcleo anuncia na rede local e o
 *   mensageiro faz o `tick` se o timer JS atrasou (evento `onHeartbeat` do PiuTransportModule). Só
 *   enquanto a CPU está acordada: o `postDelayed` conta em `uptimeMillis` e o lock solta antes do
 *   próximo pulso, então com o aparelho dormindo o pulso espera outra coisa acordá-lo (não é alarme).
 */
class PiuRelayService : Service() {
  companion object {
    private const val TAG = "PiuTransport"
    private const val CHANNEL = "piu-relay"
    private const val NOTIFICATION_ID = 0x5049 // "PI"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"
    private const val PREFS = "piu-relay"
    private const val PREF_ON = "on"
    private const val PREF_TITLE = "title"
    private const val PREF_TEXT = "text"
    private const val DEFAULT_TITLE = "Piu retransmitindo mensagens"
    private const val DEFAULT_TEXT = "Modo nó ligado."
    /** Nome registrado em src/core/headless.ts. */
    private const val CORE_TASK = "PiuCore"
    private const val HEARTBEAT_MS = 5_000L
    /** Wake lock de cada pulso: o bastante para o JS rodar o anúncio e o `tick`. */
    private const val PULSE_LOCK_MS = 3_000L

    @Volatile private var running = false

    /** Pulso para o JS: o PiuTransportModule põe ao ser criado e tira ao ser destruído. */
    @Volatile var onHeartbeat: (() -> Unit)? = null

    private fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Ligado pela última escolha do app (lido pelo BootReceiver). */
    fun wanted(context: Context): Boolean = prefs(context).getBoolean(PREF_ON, false)

    fun start(context: Context, title: String, text: String) {
      prefs(context).edit().putBoolean(PREF_ON, true).putString(PREF_TITLE, title).putString(PREF_TEXT, text).apply()
      val intent = Intent(context, PiuRelayService::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text)
      // Já em primeiro plano: só atualiza o aviso (e confere a tarefa). Pedir de novo um serviço em
      // primeiro plano com o app em segundo plano esbarra nas restrições do Android 12+.
      if (running) {
        try { context.startService(intent); return } catch (e: Exception) { android.util.Log.w(TAG, "Serviço já ligado, aviso não atualizado: ${e.message}") }
      }
      ContextCompat.startForegroundService(context, intent)
    }

    /** Religa com o texto guardado (BootReceiver), se a escolha estiver ligada. */
    fun restart(context: Context) {
      val p = prefs(context)
      if (!p.getBoolean(PREF_ON, false)) return
      start(context, p.getString(PREF_TITLE, null) ?: DEFAULT_TITLE, p.getString(PREF_TEXT, null) ?: DEFAULT_TEXT)
    }

    /**
     * `keepChoice`: só para o serviço agora, sem mudar a escolha (o módulo destruído num reload); o
     * próximo reinício do aparelho ainda religa.
     */
    fun stop(context: Context, keepChoice: Boolean = false) {
      if (!keepChoice) prefs(context).edit().putBoolean(PREF_ON, false).apply()
      context.stopService(Intent(context, PiuRelayService::class.java))
    }
  }

  private val main = Handler(Looper.getMainLooper())
  private var taskId: Int? = null
  private var taskContext: WeakReference<ReactContext>? = null
  private var waiting: ReactInstanceEventListener? = null
  private var beatThread: HandlerThread? = null
  private var beatHandler: Handler? = null
  private var pulseLock: PowerManager.WakeLock? = null
  private val beat = object : Runnable {
    override fun run() {
      pulseLock?.acquire(PULSE_LOCK_MS)
      try { onHeartbeat?.invoke() } catch (e: Exception) { android.util.Log.w(TAG, "Pulso não entregue: ${e.message}") }
      beatHandler?.postDelayed(this, HEARTBEAT_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val p = prefs(this)
    // `intent == null`: o sistema recriou o serviço (START_STICKY) depois de matar o processo.
    if (intent == null && !p.getBoolean(PREF_ON, false)) {
      stopSelf()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: p.getString(PREF_TITLE, null) ?: DEFAULT_TITLE
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: p.getString(PREF_TEXT, null) ?: DEFAULT_TEXT
    ensureChannel()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(title, text), type)
    } catch (e: Exception) {
      // Android 12+: sem permissão para iniciar em primeiro plano agora (ex.: reinício sticky com o app em
      // segundo plano, ForegroundServiceStartNotAllowedException). Já ligado, segue como estava.
      android.util.Log.w(TAG, "Serviço em primeiro plano não iniciou: ${e.message}")
      if (!running) {
        stopSelf()
        return START_NOT_STICKY
      }
    }
    running = true
    startCoreTask()
    startHeartbeat()
    // Com a escolha ligada, o sistema recria o serviço se matar o processo (`intent == null` acima).
    return if (p.getBoolean(PREF_ON, false)) START_STICKY else START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Deslizar o app dos recentes: o serviço e o núcleo seguem (é para isso que existem).
    android.util.Log.i(TAG, "App removido dos recentes; o serviço segue ligado.")
  }

  override fun onDestroy() {
    running = false
    stopHeartbeat()
    finishCoreTask()
    super.onDestroy()
  }

  // ── Tarefa sem tela PiuCore ─────────────────────────────

  private fun reactHost() = (application as? ReactApplication)?.reactHost

  /** Na thread principal (onStartCommand). Sem runtime JS, sobe o React sem tela e espera o contexto. */
  private fun startCoreTask() {
    val host = reactHost() ?: run { android.util.Log.w(TAG, "Sem ReactHost: tarefa PiuCore não iniciada."); return }
    val ctx = host.currentReactContext
    if (ctx != null) { runCoreTask(ctx); return }
    if (waiting != null) return
    val l = object : ReactInstanceEventListener {
      override fun onReactContextInitialized(context: ReactContext) {
        host.removeReactInstanceEventListener(this)
        main.post {
          if (waiting === this) waiting = null
          if (running) runCoreTask(context)
        }
      }
    }
    waiting = l
    host.addReactInstanceEventListener(l)
    host.start()
  }

  private fun runCoreTask(ctx: ReactContext) {
    val tasks = HeadlessJsTaskContext.getInstance(ctx)
    val id = taskId
    // Uma tarefa por runtime: a mesma ainda ativa basta (outro runtime = reload, começa outra).
    if (id != null && taskContext?.get() === ctx && tasks.isTaskRunning(id)) return
    try {
      taskId = tasks.startTask(HeadlessJsTaskConfig(CORE_TASK, Arguments.createMap(), 0, true))
      taskContext = WeakReference(ctx)
    } catch (e: Exception) {
      android.util.Log.w(TAG, "Tarefa PiuCore não iniciou: ${e.message}")
    }
  }

  private fun finishCoreTask() {
    waiting?.let { l -> reactHost()?.removeReactInstanceEventListener(l) }
    waiting = null
    val id = taskId ?: return
    val ctx = taskContext?.get()
    taskId = null
    taskContext = null
    // Só tira da lista de tarefas ativas (os timers voltam a pausar em segundo plano); o núcleo JS segue.
    if (ctx != null) try { HeadlessJsTaskContext.getInstance(ctx).finishTask(id) } catch (e: Exception) { android.util.Log.w(TAG, "finishTask: ${e.message}") }
  }

  // ── Pulso ───────────────────────────────────────────────

  private fun startHeartbeat() {
    if (beatThread != null) return
    val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
    pulseLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "piu:heartbeat")?.apply { setReferenceCounted(false) }
    val t = HandlerThread("PiuHeartbeat").also { it.start() }
    beatThread = t
    beatHandler = Handler(t.looper).also { it.postDelayed(beat, HEARTBEAT_MS) }
  }

  private fun stopHeartbeat() {
    beatHandler?.removeCallbacksAndMessages(null)
    beatHandler = null
    beatThread?.quitSafely()
    beatThread = null
    pulseLock?.let { if (it.isHeld) it.release() }
    pulseLock = null
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
