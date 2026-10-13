// ACL: the app's own commands and the inlined "native" plugin (src/native.rs) get permissions like any
// plugin, and capabilities/default.json grants them.
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["touch_first", "saves_load", "saves_write"]))
            .plugin(
                "native",
                tauri_build::InlinedPlugin::new()
                    .commands(&["vibrate", "display_name"])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            ),
    )
    .expect("failed to run tauri-build");
}
