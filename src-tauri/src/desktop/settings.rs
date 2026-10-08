use super::*;
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub(super) fn settings_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| format!("无法读取开机自启状态：{error}"))
}

#[tauri::command]
pub(super) fn settings_set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    let previous = manager
        .is_enabled()
        .map_err(|error| format!("无法读取开机自启状态：{error}"))?;
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|error| format!("无法更改开机自启：{error}"))?;
    match manager.is_enabled() {
        Ok(actual) if actual == enabled => Ok(actual),
        result => {
            let _ = if previous {
                manager.enable()
            } else {
                manager.disable()
            };
            Err(format!("开机自启设置未生效：{result:?}"))
        }
    }
}
