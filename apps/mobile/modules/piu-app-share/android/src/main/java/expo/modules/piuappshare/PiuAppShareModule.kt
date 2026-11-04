package expo.modules.piuappshare

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/** Provider próprio, para não colidir com o FileProvider de outras bibliotecas no manifesto. */
class PiuShareFileProvider : FileProvider()

private const val APK_TYPE = "application/vnd.android.package-archive"

/**
 * "Enviar o Piu": o instalador deste app vai para outro celular pelo compartilhamento do Android
 * (Bluetooth, Quick Share), sem loja e sem internet. O APK instalado (`sourceDir`) não pode ser
 * entregue direto a outro app, então vai uma cópia em cache/piu-share, servida pelo provider.
 */
class PiuAppShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PiuAppShare")

    AsyncFunction("shareApk") { fileName: String, chooserTitle: String, promise: Promise ->
      val ctx = appContext.reactContext ?: return@AsyncFunction promise.reject(CodedException("ERR_NO_CONTEXT", "Sem contexto do app.", null))
      val info = ctx.applicationInfo
      // Instalado em partes (App Bundle da loja): só o base.apk não instala sozinho.
      if (!info.splitSourceDirs.isNullOrEmpty()) return@AsyncFunction promise.reject(CodedException("ERR_SPLIT_APK", "Instalado em partes.", null))
      try {
        val dir = File(ctx.cacheDir, "piu-share").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() } // só a cópia mais recente fica
        val out = File(dir, File(fileName).name)
        File(info.sourceDir).copyTo(out, overwrite = true)
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.piushare", out)
        val send = Intent(Intent.ACTION_SEND).apply {
          type = APK_TYPE
          putExtra(Intent.EXTRA_STREAM, uri)
          clipData = ClipData.newRawUri(out.name, uri)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(send, chooserTitle).apply { addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        val activity = appContext.currentActivity
        if (activity != null) activity.startActivity(chooser)
        else ctx.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        promise.resolve(null)
      } catch (e: ActivityNotFoundException) {
        promise.reject(CodedException("ERR_NO_SHARE_TARGET", "Nenhum app para receber o arquivo.", e))
      } catch (e: Exception) {
        promise.reject(CodedException("ERR_SHARE", e.message ?: "Falha ao compartilhar.", e))
      }
    }
  }
}
