// The game is the web app (src/tauri/main.ts -> src/web/app.ts). The shell only opens the window and
// registers the plugins the Tauri platform uses: save store, open / save dialogs, file read / write.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running the Grantria shell");
}
