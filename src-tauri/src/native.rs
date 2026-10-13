// Plugin "native": the device features the page asks the shell for, the same commands on every target.
// Desktop answers in Rust; Android hands them to NativePlugin.kt (gen/android/.../NativePlugin.kt), registered
// below. The ACL entry is the inlined plugin in build.rs; the page calls it through src/tauri/platform.ts.
use std::path::Path;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct Android<R: Runtime>(tauri::plugin::PluginHandle<R>);

/// option 진동 (500 ms hits). Android: the phone's vibrator. Desktop has no motor of its own: the webview's
/// Gamepad API rumbles XInput pads, and on Windows a DualSense, which the webview cannot drive, gets it here.
#[tauri::command]
async fn vibrate<R: Runtime>(app: AppHandle<R>, ms: u32) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        #[derive(serde::Serialize)]
        struct Args { ms: u32 }
        app.state::<Android<R>>().0.run_mobile_plugin::<()>("vibrate", Args { ms }).map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    crate::rumble::rumble(ms);
    #[cfg(not(target_os = "android"))]
    let _ = (app, ms);
    Ok(())
}

/// The name of a file picked in the open dialog. On Android the dialog returns a content:// URI, whose
/// own name only the ContentResolver knows; the original save import reads the member number from it.
#[tauri::command]
async fn display_name<R: Runtime>(app: AppHandle<R>, path: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content:") {
        #[derive(serde::Serialize)]
        struct Args<'a> { uri: &'a str }
        #[derive(serde::Deserialize)]
        struct Name { name: Option<String> }
        let r: Name = app.state::<Android<R>>().0.run_mobile_plugin("displayName", Args { uri: &path }).map_err(|e| e.to_string())?;
        if let Some(n) = r.name { return Ok(n); }
    }
    #[cfg(not(target_os = "android"))]
    let _ = app;
    Ok(Path::new(&path).file_name().and_then(|n| n.to_str()).map(str::to_owned).unwrap_or(path))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("native")
        .invoke_handler(tauri::generate_handler![vibrate, display_name])
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _app.manage(Android(_api.register_android_plugin("dev.ringwdr.grantria", "NativePlugin")?));
            Ok(())
        })
        .build()
}
