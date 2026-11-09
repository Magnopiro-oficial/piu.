package expo.modules.piuvoice

import android.media.AudioManager
import org.junit.Assert.assertEquals
import org.junit.Test

class RingerNameTest {
  @Test fun modoDoToque() {
    assertEquals("normal", ringerName(dnd = false, mode = AudioManager.RINGER_MODE_NORMAL))
    assertEquals("vibrate", ringerName(dnd = false, mode = AudioManager.RINGER_MODE_VIBRATE))
    assertEquals("silent", ringerName(dnd = false, mode = AudioManager.RINGER_MODE_SILENT))
  }

  @Test fun naoPerturbeContaComoSilencioso() {
    assertEquals("silent", ringerName(dnd = true, mode = AudioManager.RINGER_MODE_NORMAL))
  }
}
