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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AndroidNote {
    id: String,
    content: String,
    updated_at: u64,
    in_trash: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageListRequest {
    in_trash: bool,
}

#[derive(Deserialize)]
struct StorageNotesResponse {
    notes: Vec<AndroidNote>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageReadRequest {
    id: String,
    in_trash: bool,
}

#[derive(Deserialize)]
struct StorageNoteResponse {
    note: Option<AndroidNote>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageSaveRequest {
    id: Option<String>,
    suggested_id: String,
    content: String,
}

#[derive(Deserialize, Serialize)]
struct StorageTargetRequest {
    id: String,
}

#[derive(Deserialize)]
struct StorageReadyResponse {
    ready: bool,
}

#[derive(Deserialize)]
struct StorageDeleteResponse {
    deleted: bool,
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

#[tauri::command]
fn mobile_storage_ensure(native: State<'_, AndroidNative>) -> Result<bool, String> {
    let response: StorageReadyResponse = native_call(&native, "ensureStorage", ())?;
    Ok(response.ready)
}

#[tauri::command]
fn mobile_storage_list(
    native: State<'_, AndroidNative>,
    request: StorageListRequest,
) -> Result<Vec<AndroidNote>, String> {
    let response: StorageNotesResponse = native_call(&native, "listNotes", request)?;
    Ok(response.notes)
}

#[tauri::command]
fn mobile_storage_read(
    native: State<'_, AndroidNative>,
    request: StorageReadRequest,
) -> Result<Option<AndroidNote>, String> {
    let response: StorageNoteResponse = native_call(&native, "readNote", request)?;
    Ok(response.note)
}

#[tauri::command]
fn mobile_storage_save(
    native: State<'_, AndroidNative>,
    request: StorageSaveRequest,
) -> Result<AndroidNote, String> {
    let response: StorageNoteResponse = native_call(&native, "saveNote", request)?;
    response
        .note
        .ok_or_else(|| "Android 保存完成但未返回笔记。".to_string())
}

#[tauri::command]
fn mobile_storage_trash(
    native: State<'_, AndroidNative>,
    request: StorageTargetRequest,
) -> Result<AndroidNote, String> {
    storage_target_call(&native, "trashNote", request)
}

#[tauri::command]
fn mobile_storage_restore(
    native: State<'_, AndroidNative>,
    request: StorageTargetRequest,
) -> Result<AndroidNote, String> {
    storage_target_call(&native, "restoreNote", request)
}

#[tauri::command]
fn mobile_storage_delete(
    native: State<'_, AndroidNative>,
    request: StorageTargetRequest,
) -> Result<bool, String> {
    let response: StorageDeleteResponse = native_call(&native, "deleteNote", request)?;
    Ok(response.deleted)
}

fn storage_target_call(
    native: &AndroidNative,
    command: &str,
    request: StorageTargetRequest,
) -> Result<AndroidNote, String> {
    let response: StorageNoteResponse = native_call(native, command, request)?;
    response
        .note
        .ok_or_else(|| "Android 存储操作完成但未返回笔记。".to_string())
}

fn native_call<T: for<'de> Deserialize<'de>>(
    native: &AndroidNative,
    command: &str,
    payload: impl Serialize,
) -> Result<T, String> {
    native
        .0
        .run_mobile_plugin(command, payload)
        .map_err(|error| format!("Android 原生操作失败：{error}"))
}

#[tauri::mobile_entry_point]
pub fn run() {
    tauri::Builder::default()
        .plugin(android_native_plugin())
        .invoke_handler(tauri::generate_handler![
            android_platform_status,
            mobile_storage_ensure,
            mobile_storage_list,
            mobile_storage_read,
            mobile_storage_save,
            mobile_storage_trash,
            mobile_storage_restore,
            mobile_storage_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running s-light notes on Android");
}
