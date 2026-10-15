package dev.ringwdr.grantria

import android.os.Build
import android.os.Bundle
import android.view.InputDevice
import android.view.KeyEvent
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlin.math.abs

// Window only: landscape (manifest) and full screen like the original, the system bars hidden and back only
// for a moment on a swipe from the edge, at most 60 Hz, sound without a first tap. Everything the page talks to goes through
// Tauri: the back key is the app plugin's 'back-button' event, onPause / onResume reach the page as the
// 'host-pause' event (src-tauri/src/lib.rs), vibration and file names are NativePlugin.kt.
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    hideSystemBars()
    capRefreshRate()
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.settings.mediaPlaybackRequiresUserGesture = false
  }

  // A pad's B button the webview leaves unhandled comes back as a fallback BACK key. The game already reads
  // B through the Gamepad API, so passing it on would cancel twice.
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.keyCode == KeyEvent.KEYCODE_BACK && (event.flags and KeyEvent.FLAG_FALLBACK) != 0 &&
      (event.isFromSource(InputDevice.SOURCE_GAMEPAD) || event.isFromSource(InputDevice.SOURCE_JOYSTICK))) return true
    return super.dispatchKeyEvent(event)
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

  private fun hideSystemBars() {
    val c = WindowCompat.getInsetsController(window, window.decorView)
    c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    c.hide(WindowInsetsCompat.Type.systemBars())
  }

  // The game draws at 20 Hz and its UI animations need no more than 60: on a 90 / 120 Hz screen ask for the
  // display mode of the same resolution closest to 60 Hz, so the webview's frame loop and the panel run slower.
  private fun capRefreshRate() {
    @Suppress("DEPRECATION")
    val display = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else windowManager.defaultDisplay) ?: return
    val cur = display.mode
    if (cur.refreshRate <= 61f) return
    val mode = display.supportedModes
      .filter { it.physicalWidth == cur.physicalWidth && it.physicalHeight == cur.physicalHeight && it.refreshRate >= 59f }
      .minByOrNull { abs(it.refreshRate - 60f) } ?: return
    if (mode.refreshRate >= cur.refreshRate) return
    window.attributes = window.attributes.apply { preferredDisplayModeId = mode.modeId }
  }
}
