package dev.ringwdr.grantria

import android.app.Activity
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.OpenableColumns
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import kotlin.math.abs

@InvokeArg
class VibrateArgs {
  var ms: Long = 0
}

@InvokeArg
class DisplayNameArgs {
  lateinit var uri: String
}

@InvokeArg
class RefreshCapArgs {
  var on: Boolean = false
}

// Android side of the "native" plugin (src-tauri/src/native.rs registers it; the page calls the Rust commands).
@TauriPlugin
class NativePlugin(private val activity: Activity) : Plugin(activity) {
  private val vibrator: Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) activity.getSystemService(VibratorManager::class.java)?.defaultVibrator
    else @Suppress("DEPRECATION") activity.getSystemService(Vibrator::class.java)

  @Command
  fun vibrate(invoke: Invoke) {
    val ms = invoke.parseArgs(VibrateArgs::class.java).ms
    vibrator?.takeIf { it.hasVibrator() }?.let { v ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
      else @Suppress("DEPRECATION") v.vibrate(ms)
    }
    invoke.resolve()
  }

  /** 절전 모드: the game draws at 20 Hz and its UI animations need no more than 60, so on a 90 / 120 Hz screen ask
   *  for the display mode of the same resolution closest to 60 Hz (the webview's frame loop and the panel run
   *  slower); off, mode 0 leaves the choice to the system again */
  @Command
  fun refreshCap(invoke: Invoke) {
    val on = invoke.parseArgs(RefreshCapArgs::class.java).on
    activity.runOnUiThread {
      val id = if (on) sixtyHzMode() else 0
      val w = activity.window
      if (w.attributes.preferredDisplayModeId != id) w.attributes = w.attributes.apply { preferredDisplayModeId = id }
    }
    invoke.resolve()
  }

  /** the 60 Hz-nearest mode of the current resolution, 0 when the screen has nothing faster than 60 Hz */
  private fun sixtyHzMode(): Int {
    @Suppress("DEPRECATION")
    val display = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) activity.display else activity.windowManager.defaultDisplay) ?: return 0
    val cur = display.mode
    val same = display.supportedModes.filter { it.physicalWidth == cur.physicalWidth && it.physicalHeight == cur.physicalHeight }
    if (same.none { it.refreshRate > 61f }) return 0
    return same.filter { it.refreshRate >= 59f }.minByOrNull { abs(it.refreshRate - 60f) }?.modeId ?: 0
  }

  /** the picked document's own name (the dialog plugin hands the page only its content:// URI) */
  @Command
  fun displayName(invoke: Invoke) {
    val uri = invoke.parseArgs(DisplayNameArgs::class.java).uri
    val name = try {
      activity.contentResolver.query(Uri.parse(uri), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    } catch (e: Exception) {
      null
    }
    invoke.resolve(JSObject().apply { if (name != null) put("name", name) })
  }
}
