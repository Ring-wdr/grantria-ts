// The game is the web app (src/tauri/main.ts -> src/web/app.ts). The shell opens the window and wires the
// native side through Tauri itself, never by evaluating scripts in the page:
// - plugins: open / save dialogs and reading / writing the picked files, and "native" (native.rs: vibration,
//   names of picked files; Android code in NativePlugin.kt)
// - commands: the saves (saves.rs), whether the build is a touch device
// - the 'host-pause' event: the window minimised or restored (desktop: WebView2 keeps a minimised page
//   "visible", so the game would not mute) and the app suspended or resumed (Android onPause / onResume)
// The Android back key is Tauri's own (app plugin 'back-button' event, src/tauri/platform.ts).
mod native;
mod saves;

use tauri::{Emitter, WindowEvent};

/// phones and tablets start with touch controls at the screen edges
#[tauri::command]
fn touch_first() -> bool {
    cfg!(mobile)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(native::init())
        .invoke_handler(tauri::generate_handler![touch_first, saves::saves_load, saves::saves_write])
        .on_window_event(|window, event| {
            let paused = match event {
                #[cfg(desktop)]
                WindowEvent::Resized(_) => window.is_minimized().unwrap_or(false),
                #[cfg(mobile)]
                WindowEvent::Suspended => true,
                #[cfg(mobile)]
                WindowEvent::Resumed => false,
                _ => return,
            };
            let _ = window.emit("host-pause", paused);
        })
        .run(tauri::generate_context!())
        .expect("error while running the Grantria shell");
}
