// The game is the web app (src/tauri/main.ts -> src/web/app.ts). The shell opens the window, registers the
// plugins the Tauri platform uses (save store, open / save dialogs, file read / write) and, on desktop, tells
// the page when the window is minimised: WebView2 keeps the page "visible" then, so the game would not mute.
#[cfg(desktop)]
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    let builder = builder.on_window_event(|window, event| {
        if let WindowEvent::Resized(_) = event {
            let minimized = window.is_minimized().unwrap_or(false);
            if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                let _ = webview.eval(&format!("window.__grantriaPause && window.__grantriaPause({minimized})"));
            }
        }
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running the Grantria shell");
}
