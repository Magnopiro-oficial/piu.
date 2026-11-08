package expo.modules.piuvoice

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * A chamada fora do app (modules/piu-voice/alert.ts): toque e vibração, notificação de chamada
 * recebida (tela cheia, Atender/Recusar), a Activity por cima da tela bloqueada e o serviço do
 * microfone (./PiuCallService.kt). Não decide nada: o JS (src/calls/callAlert.ts) diz o que ligar e
 * desligar, e recebe de volta as ações das notificações e as mudanças da tela de bloqueio.
 *
 * As flags de tela bloqueada (setShowWhenLocked/setTurnScreenOn) ficam ligadas só enquanto o JS pede
 * (chamada tocando ou em curso), nunca fixas no manifesto: fora disso o app volta a pedir o desbloqueio.
 */
private const val OVER_LOCK_GRACE_MS = 90_000L
private const val OVER_LOCK_CHECK_MS = 30_000L

class PiuCallAlertModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private val main = Handler(Looper.getMainLooper())
  private var ringer: CallRinger? = null
  @Volatile private var overLock = false
  @Volatile private var wake = false
  @Volatile private var listening = false
  /** Ação que chegou antes de o JS escutar (app aberto pela notificação). */
  private var pending: Map<String, String>? = null
  private var lastNonce: String? = null
  private var lastLocked: Boolean? = null
  private var registered: Context? = null
  /** Aviso de toque pedido pelo JS (até `hideIncoming`), para repor se alguém limpar as notificações. */
  private var incoming: IncomingNote? = null

  // Recusar e Desligar: PendingIntent do próprio app (receptor não exportado).
  private val actionReceiver = object : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
      deliver(i.getStringExtra(CallNotes.EXTRA_ACTION) ?: return, i.getStringExtra(CallNotes.EXTRA_CALL) ?: return)
    }
  }

  /**
   * Rede de segurança da tela sobre o bloqueio: se o JS parar de responder, as flags não ficam ligadas
   * para sempre. Passados 90 s do último pedido, só continuam com o aviso "Em chamada" no ar (chamada
   * em curso); o toque e o "chamando" acabam antes disso (45 s).
   */
  private var overSince = 0L
  private val overWatch = object : Runnable {
    override fun run() {
      val ctx = registered ?: return
      if (!overLock) return
      if (SystemClock.elapsedRealtime() - overSince > OVER_LOCK_GRACE_MS && !isPosted(ctx, CallNotes.ID_ONGOING)) {
        overLock = false
        wake = false
        appContext.currentActivity?.let(::applyFlags)
        return
      }
      main.postDelayed(this, OVER_LOCK_CHECK_MS)
    }
  }

  // Tela apagou, acendeu ou foi desbloqueada.
  private val lockReceiver = object : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) = emitLock()
  }

  // Activity criada depois do pedido (aberta pela tela cheia com o app só em segundo plano).
  private val lifecycle = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(a: Activity, b: Bundle?) { if (overLock || wake) applyFlags(a) }
    override fun onActivityStarted(a: Activity) {}
    override fun onActivityResumed(a: Activity) {}
    override fun onActivityPaused(a: Activity) {}
    override fun onActivityStopped(a: Activity) {}
    override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
    override fun onActivityDestroyed(a: Activity) {}
  }

  override fun definition() = ModuleDefinition {
    Name("PiuCallAlert")
    Events("onAction", "onLockChange")

    OnCreate {
      val ctx = context
      registered = ctx
      ContextCompat.registerReceiver(ctx, actionReceiver, IntentFilter(CallNotes.broadcastAction(ctx)), ContextCompat.RECEIVER_NOT_EXPORTED)
      val screen = IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_SCREEN_ON)
        addAction(Intent.ACTION_USER_PRESENT)
      }
      // Transmissões protegidas: só o sistema envia.
      ContextCompat.registerReceiver(ctx, lockReceiver, screen, ContextCompat.RECEIVER_EXPORTED)
      (ctx as? Application)?.registerActivityLifecycleCallbacks(lifecycle)
    }

    OnStartObserving {
      val ev = synchronized(this@PiuCallAlertModule) { listening = true; pending.also { pending = null } }
      ev?.let { sendEvent("onAction", it) }
    }
    OnStopObserving { listening = false }

    OnNewIntent { intent -> consume(intent) }

    OnActivityEntersForeground {
      emitLock()
      consume(appContext.currentActivity?.intent)
      registered?.let { PiuCallService.retry(it) }
    }

    // Ao abrir, o app limpa as notificações (src/lib/notifications.ts): saindo dele com a chamada
    // ainda tocando, o aviso volta (sem tela cheia, para não reabrir o app sozinho).
    OnActivityEntersBackground {
      val ctx = registered ?: return@OnActivityEntersBackground
      main.post { incoming?.let { if (!isPosted(ctx, CallNotes.ID_INCOMING)) postIncoming(ctx, it, full = false) } }
    }

    Function("isLocked") { isLocked() }

    Function("setLockFlags") { over: Boolean, w: Boolean ->
      overLock = over
      wake = w
      main.post {
        appContext.currentActivity?.let(::applyFlags)
        main.removeCallbacks(overWatch)
        if (over) { overSince = SystemClock.elapsedRealtime(); main.postDelayed(overWatch, OVER_LOCK_CHECK_MS) }
      }
      Unit
    }

    Function("startRinging") { pattern: List<Double> ->
      val ctx = context
      val p = pattern.map { it.toLong().coerceAtLeast(0) }.toLongArray()
      main.post { (ringer ?: CallRinger(ctx).also { ringer = it }).start(p) }
      Unit
    }

    Function("stopRinging") { main.post { ringer?.stop() }; Unit }

    // Na thread principal, depois das flags (mesma fila): a tela cheia já encontra a Activity liberada.
    Function("showIncoming") { n: IncomingNote ->
      val ctx = context
      main.post { incoming = n; postIncoming(ctx, n, n.full) }
      Unit
    }

    Function("hideIncoming") {
      val ctx = context
      main.post { incoming = null; NotificationManagerCompat.from(ctx).cancel(CallNotes.ID_INCOMING) }
      Unit
    }

    Function("startOngoing") { n: OngoingNote -> PiuCallService.request(context, n.toBundle()); Unit }

    Function("stopOngoing") { PiuCallService.stop(context); Unit }

    OnDestroy {
      val ctx = registered ?: return@OnDestroy
      registered = null
      overLock = false
      wake = false
      main.post {
        ringer?.stop()
        ringer = null
        incoming = null
        NotificationManagerCompat.from(ctx).cancel(CallNotes.ID_INCOMING)
        appContext.currentActivity?.let(::applyFlags)
      }
      PiuCallService.stop(ctx)
      try { ctx.unregisterReceiver(actionReceiver) } catch (_: Exception) {}
      try { ctx.unregisterReceiver(lockReceiver) } catch (_: Exception) {}
      (ctx as? Application)?.unregisterActivityLifecycleCallbacks(lifecycle)
    }
  }

  private fun isLocked(): Boolean =
    (registered?.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)?.isKeyguardLocked ?: false

  private fun emitLock() {
    val l = isLocked()
    if (l == lastLocked) return
    lastLocked = l
    sendEvent("onLockChange", mapOf("locked" to l))
  }

  @Suppress("DEPRECATION")
  private fun applyFlags(a: Activity) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      a.setShowWhenLocked(overLock)
      a.setTurnScreenOn(wake)
    } else {
      val show = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
      val on = WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (overLock) a.window.addFlags(show) else a.window.clearFlags(show)
      if (wake) a.window.addFlags(on) else a.window.clearFlags(on)
    }
  }

  @SuppressLint("MissingPermission")
  private fun postIncoming(ctx: Context, n: IncomingNote, full: Boolean) {
    CallNotes.ensureChannel(ctx, CallNotes.CH_INCOMING, n.channel, n.channelDesc)
    val nm = NotificationManagerCompat.from(ctx)
    // Android 13+ sem POST_NOTIFICATIONS: não aparece (o toque segue; o app pede a permissão depois).
    if (!nm.areNotificationsEnabled()) return
    try {
      nm.notify(CallNotes.ID_INCOMING, CallNotes.incoming(ctx, n, full))
    } catch (e: Exception) {
      Log.w("PiuVoice", "Aviso de chamada não saiu: ${e.message}")
    }
  }

  private fun isPosted(ctx: Context, id: Int): Boolean {
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return false
    return try { nm.activeNotifications.any { it.id == id } } catch (_: Exception) { false }
  }

  /**
   * Activity aberta por uma notificação da chamada: entrega a ação uma vez só. Sem a senha emitida
   * pelo CallNotes para esta ação e esta chamada, a Intent veio de outro app (a Activity é exportada)
   * e é ignorada. Depois de lida, a Intent perde os extras da chamada: a Activity relê a Intent que a
   * criou a cada volta para a frente, e um "Atender" antigo não pode atender uma chamada nova.
   */
  private fun consume(intent: Intent?) {
    val ctx = registered ?: return
    if (intent == null || intent.action != CallNotes.activityAction(ctx)) return
    val nonce = intent.getStringExtra(CallNotes.EXTRA_NONCE)
    val action = intent.getStringExtra(CallNotes.EXTRA_ACTION)
    val callId = intent.getStringExtra(CallNotes.EXTRA_CALL)
    intent.removeExtra(CallNotes.EXTRA_NONCE)
    intent.removeExtra(CallNotes.EXTRA_ACTION)
    intent.removeExtra(CallNotes.EXTRA_CALL)
    if (action == null || callId == null || nonce == lastNonce) return
    if (!CallNotes.tokens.consume(nonce, action, callId)) return
    lastNonce = nonce
    deliver(action, callId)
  }

  private fun deliver(action: String, callId: String) {
    val ev = mapOf("action" to action, "callId" to callId)
    val now = synchronized(this) { if (!listening) pending = ev; listening }
    if (now) sendEvent("onAction", ev)
  }
}
