use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, State, Wry};

const ANDROID_PLUGIN_IDENTIFIER: &str = "com.slightnotes.v2";

struct AndroidNative(PluginHandle<Wry>);

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidPlatformStatus {
    platform: String,
    sdk_int: u32,
    engine_state: String,
}

fn android_native_plugin() -> TauriPlugin<Wry> {
    Builder::<Wry>::new("android-native")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin(ANDROID_PLUGIN_IDENTIFIER, "AndroidBridgePlugin")?;
            app.manage(AndroidNative(handle));
            Ok(())
        })
        .build()
}

#[tauri::command]
fn android_platform_status(
    native: State<'_, AndroidNative>,
) -> Result<AndroidPlatformStatus, String> {
    native
        .0
        .run_mobile_plugin("getPlatformStatus", ())
        .map_err(|error| format!("无法读取 Android 平台状态：{error}"))
}

#[tauri::mobile_entry_point]
pub fn run() {
    tauri::Builder::default()
        .plugin(android_native_plugin())
        .invoke_handler(tauri::generate_handler![android_platform_status])
        .run(tauri::generate_context!())
        .expect("error while running s-light notes on Android");
}
