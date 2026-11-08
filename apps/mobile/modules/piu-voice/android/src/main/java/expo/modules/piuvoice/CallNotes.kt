package expo.modules.piuvoice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Aviso de chamada recebida, com os textos prontos no idioma do app (src/calls/callAlert.ts). */
class IncomingNote : Record {
  @Field val callId: String = ""
  @Field val full: Boolean = false
  @Field val title: String = ""
  @Field val body: String = ""
  @Field val answer: String = ""
  @Field val decline: String = ""
  @Field val publicTitle: String = ""
  @Field val publicBody: String = ""
  @Field val channel: String = ""
  @Field val channelDesc: String = ""
}

/** Aviso contínuo "Em chamada com X" do serviço do microfone. `since`: início da conversa (ms, relógio do sistema). */
class OngoingNote : Record {
  @Field val callId: String = ""
  @Field val since: Double = 0.0
  @Field val title: String = ""
  @Field val body: String = ""
  @Field val hangup: String = ""
  @Field val publicTitle: String = ""
  @Field val channel: String = ""
  @Field val channelDesc: String = ""

  fun toBundle() = Bundle().apply {
    putString(CallNotes.EXTRA_CALL, callId)
    putLong("since", since.toLong())
    putString("title", title)
    putString("body", body)
    putString("hangup", hangup)
    putString("publicTitle", publicTitle)
    putString("channel", channel)
    putString("channelDesc", channelDesc)
  }
}

/**
 * Senhas das notificações que abrem o app. A Activity principal é exportada (é a do ícone): qualquer
 * app instalado pode abri-la com a ação "answer" e o id da chamada, e quem liga escolhe esse id. Só
 * vale a Intent que traz uma senha aleatória emitida aqui, e ela só existe dentro do PendingIntent
 * imutável da notificação (outro app não lê os extras dele). A senha fica presa à ação e à chamada, e
 * a do "Atender" vale uma vez só (a Activity relê a Intent que a criou a cada volta para a frente).
 */
internal class OpenTokens(private val max: Int = 16) {
  private val rnd = java.security.SecureRandom()
  private val issued = LinkedHashMap<String, Pair<String, String>>()

  @Synchronized fun issue(action: String, callId: String): String {
    val b = ByteArray(16).also(rnd::nextBytes)
    val t = b.joinToString("") { "%02x".format(it) }
    issued[t] = action to callId
    while (issued.size > max) issued.remove(issued.keys.first())
    return t
  }

  /** Confere a senha com a ação e a chamada da Intent; a do "answer" sai ao ser usada. */
  @Synchronized fun consume(t: String?, action: String, callId: String): Boolean {
    if (t.isNullOrEmpty()) return false
    if (issued[t] != (action to callId)) return false
    if (action == "answer") issued.remove(t)
    return true
  }

  @Synchronized fun clear() = issued.clear()
}

/**
 * Notificações da chamada. Quem decide o que mostrar é o JS; aqui só se montam. Sem conteúdo de
 * mensagem: nome do contato e caminho, e uma versão pública sem nome para a tela bloqueada que
 * esconde conteúdo. Som e vibração não são do canal: ficam com o CallRinger, que toca igual com o
 * app aberto ou fechado e para na hora certa.
 */
internal object CallNotes {
  const val CH_INCOMING = "piu-call-incoming"
  const val CH_ONGOING = "piu-call-ongoing"
  const val ID_INCOMING = 0x5043 // "PC"
  const val ID_ONGOING = 0x504F // "PO"
  const val EXTRA_ACTION = "piu.call.action"
  const val EXTRA_CALL = "piu.call.id"
  const val EXTRA_NONCE = "piu.call.nonce"

  /** Senhas das Intents que abrem o app (ver OpenTokens). */
  val tokens = OpenTokens()

  // Códigos distintos: cada ação tem o seu PendingIntent (os extras não entram na comparação).
  private const val RC_SHOW = 0x51
  private const val RC_FULL = 0x52
  private const val RC_ANSWER = 0x53
  private const val RC_DECLINE = 0x54
  private const val RC_HANGUP = 0x55
  private const val RC_ONGOING = 0x56

  /** Rede de segurança: se o JS parar, o aviso de toque some sozinho (o JS desiste em 45 s). */
  private const val INCOMING_TIMEOUT_MS = 60_000L

  /** Ações que não abrem o app (Recusar, Desligar): broadcast só para o próprio pacote. */
  fun broadcastAction(ctx: Context) = "${ctx.packageName}.PIU_CALL_ACTION"
  /** Ações que abrem o app (Atender, tocar no aviso, tela cheia). */
  fun activityAction(ctx: Context) = "${ctx.packageName}.PIU_CALL_OPEN"

  fun ensureChannel(ctx: Context, id: String, name: String, desc: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    // Recriar com o mesmo id só atualiza nome e descrição (idioma do app); o resto fica como nasceu.
    val importance = if (id == CH_INCOMING) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_LOW
    nm.createNotificationChannel(NotificationChannel(id, name.ifBlank { "Piu" }, importance).apply {
      description = desc
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    })
  }

  private fun icon(ctx: Context) = ctx.applicationInfo.icon

  private fun flags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  private fun broadcast(ctx: Context, action: String, callId: String, code: Int): PendingIntent =
    PendingIntent.getBroadcast(ctx, code, Intent(broadcastAction(ctx)).setPackage(ctx.packageName)
      .putExtra(EXTRA_ACTION, action).putExtra(EXTRA_CALL, callId), flags())

  /** Abre a Activity do app (explícita, sem URL: o expo-router não navega). */
  private fun open(ctx: Context, action: String, callId: String, code: Int): PendingIntent? {
    val component = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.component ?: return null
    val intent = Intent(activityAction(ctx)).setComponent(component)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra(EXTRA_ACTION, action).putExtra(EXTRA_CALL, callId).putExtra(EXTRA_NONCE, tokens.issue(action, callId))
    return PendingIntent.getActivity(ctx, code, intent, flags())
  }

  fun incoming(ctx: Context, n: IncomingNote, full: Boolean): Notification {
    val public = NotificationCompat.Builder(ctx, CH_INCOMING)
      .setSmallIcon(icon(ctx))
      .setContentTitle(n.publicTitle)
      .setContentText(n.publicBody)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .build()
    val b = NotificationCompat.Builder(ctx, CH_INCOMING)
      .setSmallIcon(icon(ctx))
      .setContentTitle(n.title)
      .setContentText(n.body)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(public)
      .setTimeoutAfter(INCOMING_TIMEOUT_MS)
      .addAction(0, n.decline, broadcast(ctx, "decline", n.callId, RC_DECLINE))
    open(ctx, "answer", n.callId, RC_ANSWER)?.let { b.addAction(0, n.answer, it) }
    open(ctx, "show", n.callId, RC_SHOW)?.let { b.setContentIntent(it) }
    // Tela cheia (Android 14+: só com USE_FULL_SCREEN_INTENT liberada; sem ela o sistema mostra o aviso no topo).
    if (full) open(ctx, "show", n.callId, RC_FULL)?.let { b.setFullScreenIntent(it, true) }
    return b.build()
  }

  fun ongoing(ctx: Context, e: Bundle): Notification {
    val callId = e.getString(EXTRA_CALL) ?: ""
    val public = NotificationCompat.Builder(ctx, CH_ONGOING)
      .setSmallIcon(icon(ctx))
      .setContentTitle(e.getString("publicTitle"))
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .build()
    val b = NotificationCompat.Builder(ctx, CH_ONGOING)
      .setSmallIcon(icon(ctx))
      .setContentTitle(e.getString("title"))
      .setContentText(e.getString("body"))
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(public)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .addAction(0, e.getString("hangup"), broadcast(ctx, "hangup", callId, RC_HANGUP))
    val since = e.getLong("since")
    if (since > 0) b.setWhen(since).setShowWhen(true).setUsesChronometer(true)
    open(ctx, "show", callId, RC_ONGOING)?.let { b.setContentIntent(it) }
    return b.build()
  }
}
