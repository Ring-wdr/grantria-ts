package dev.ringwdr.grantria

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

// Landscape (manifest) and full screen like the original: the system bars stay hidden and come back only
// for a moment on a swipe from the edge. Sound plays without a first tap and stops in the background;
// the back button asks the game first (src/web/app.ts __grantriaBack) and offers to quit on the title.
class MainActivity : TauriActivity() {
  private var web: WebView? = null

  // the back button is ours, not the webview's history
  override val handleBackNavigation: Boolean = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    hideSystemBars()
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    webView.settings.mediaPlaybackRequiresUserGesture = false
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("window.__grantriaBack ? window.__grantriaBack() : 'exit'") { r ->
          if (r == "\"exit\"") confirmExit()
        }
      }
    })
  }

  private fun confirmExit() {
    AlertDialog.Builder(this)
      .setMessage("게임을 종료하시겠습니까?")
      .setPositiveButton("예") { _, _ -> finishAndRemoveTask() }
      .setNegativeButton("아니오", null)
      .show()
  }

  override fun onPause() {
    web?.evaluateJavascript("window.__grantriaPause && window.__grantriaPause(true)", null)
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    web?.evaluateJavascript("window.__grantriaPause && window.__grantriaPause(false)", null)
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
}
