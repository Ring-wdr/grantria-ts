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

@InvokeArg
class VibrateArgs {
  var ms: Long = 0
}

@InvokeArg
class DisplayNameArgs {
  lateinit var uri: String
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
