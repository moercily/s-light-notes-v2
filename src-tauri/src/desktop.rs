use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const DEFAULT_SYNCTHING_URL: &str = "http://127.0.0.1:8384";
const SIDECAR_SYNCTHING_URL: &str = "http://127.0.0.1:8385";
const SIDECAR_SOCKET: &str = "127.0.0.1:8385";
const SIDECAR_BINARY_NAME: &str = "syncthing-sidecar";
const SIDECAR_FOLDER_ID: &str = "s-light-notes";
const SIDECAR_SYNC_PORT: u16 = 22001;
const SIDECAR_DISCOVERY_PORT: u16 = 21028;
const SIDECAR_EVENT_FILTERS: &str = "DeviceConnected,DeviceDisconnected,DeviceRejected,PendingDevicesChanged,FolderSummary,FolderCompletion,FolderScanProgress,StateChanged,LocalIndexUpdated,RemoteIndexUpdated,FolderErrors,Failure";
const CONFIG_CONFIRMATION_TTL: Duration = Duration::from_secs(300);
const SYNCTHING_STARTUP_ATTEMPTS: usize = 40;
const SYNCTHING_STARTUP_INTERVAL: Duration = Duration::from_millis(250);
const SYNCTHING_SHUTDOWN_ATTEMPTS: usize = 30;
const SYNCTHING_SHUTDOWN_INTERVAL: Duration = Duration::from_millis(100);
static CONFIG_TOKEN_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct SyncthingProcess {
    child: Mutex<Option<Child>>,
}

#[derive(Default)]
struct SyncthingSidecar {
    child: Mutex<Option<CommandChild>>,
    runtime: Mutex<Option<SidecarRuntimeConfig>>,
    last_exit: Mutex<Option<Option<i32>>>,
    lifecycle_lock: Mutex<()>,
}

#[derive(Debug, Clone)]
struct SidecarRuntimeConfig {
    config_dir: PathBuf,
    data_dir: PathBuf,
    log_file: PathBuf,
    api_key: String,
}

#[derive(Debug, PartialEq)]
enum ManagedProcessInspection {
    NotManaged,
    Running,
    Exited(Option<i32>),
}

#[derive(Default)]
struct PendingFolderConfigs {
    items: Mutex<HashMap<String, PendingFolderConfig>>,
}

#[derive(Default)]
struct PendingDevicePairings {
    items: Mutex<HashMap<String, PendingDevicePairing>>,
}

#[derive(Debug, Clone)]
struct PendingFolderConfig {
    folder_id: String,
    path: String,
    device_ids: Vec<String>,
    created_at: Instant,
}

#[derive(Debug, Clone)]
struct PendingDevicePairing {
    device_id: String,
    device_name: String,
    created_at: Instant,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppPaths {
    app_data_dir: String,
    notes_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncthingStatus {
    available: bool,
    running: bool,
    managed: bool,
    engine_kind: String,
    api_base: String,
    executable: Option<String>,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProxyRequest {
    method: String,
    path: String,
    body: Option<String>,
    api_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyResponse {
    status: u16,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderConfigRequest {
    path: String,
    folder_id: Option<String>,
    selected_folder_id: Option<String>,
    selected_folder_path: Option<String>,
    #[serde(default)]
    device_ids: Vec<String>,
    #[serde(default)]
    selected_folder_device_ids: Vec<String>,
    #[serde(default)]
    existing_folder_ids: Vec<String>,
    restart_required: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmFolderConfigRequest {
    confirmation_token: String,
    api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevicePairingPreviewRequest {
    device_id: String,
    device_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmDevicePairingRequest {
    confirmation_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncthingEventsRequest {
    since: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteListRequest {
    in_trash: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteReadRequest {
    id: String,
    in_trash: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteSaveRequest {
    id: Option<String>,
    suggested_id: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct NoteTargetRequest {
    id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopNote {
    id: String,
    content: String,
    updated_at: u64,
    in_trash: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedNote {
    id: String,
    updated_at: u64,
}

#[tauri::command]
fn get_app_paths(app: AppHandle) -> Result<AppPaths, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法获取应用数据目录：{err}"))?;
    let notes_dir = default_notes_dir(&app)?;

    Ok(AppPaths {
        app_data_dir: app_data_dir.to_string_lossy().to_string(),
        notes_dir: notes_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn ensure_notes_folder(app: AppHandle) -> Result<AppPaths, String> {
    let notes_dir = default_notes_dir(&app)?;
    ensure_directory(&notes_dir)?;
    get_app_paths(app)
}

#[tauri::command]
fn desktop_list_notes(
    app: AppHandle,
    request: NoteListRequest,
) -> Result<Vec<DesktopNote>, String> {
    let notes_dir = default_notes_dir(&app)?;
    list_notes_in_dir(&notes_dir, request.in_trash)
}

#[tauri::command]
fn desktop_read_note(
    app: AppHandle,
    request: NoteReadRequest,
) -> Result<Option<DesktopNote>, String> {
    let notes_dir = default_notes_dir(&app)?;
    read_note_in_dir(&notes_dir, &request.id, request.in_trash)
}

#[tauri::command]
fn desktop_save_note(app: AppHandle, request: NoteSaveRequest) -> Result<SavedNote, String> {
    let notes_dir = default_notes_dir(&app)?;
    save_note_in_dir(
        &notes_dir,
        request.id.as_deref(),
        &request.suggested_id,
        &request.content,
    )
}

#[tauri::command]
fn desktop_move_to_trash(app: AppHandle, request: NoteTargetRequest) -> Result<(), String> {
    let notes_dir = default_notes_dir(&app)?;
    move_note_to_trash(&notes_dir, &request.id)
}

#[tauri::command]
fn desktop_restore_note(app: AppHandle, request: NoteTargetRequest) -> Result<(), String> {
    let notes_dir = default_notes_dir(&app)?;
    restore_note_from_trash(&notes_dir, &request.id)
}

#[tauri::command]
fn desktop_delete_note(app: AppHandle, request: NoteTargetRequest) -> Result<(), String> {
    let notes_dir = default_notes_dir(&app)?;
    permanently_delete_note(&notes_dir, &request.id)
}

fn external_syncthing_status_snapshot(managed: bool) -> SyncthingStatus {
    match syncthing_health() {
        Ok(message) => SyncthingStatus {
            available: true,
            running: true,
            managed,
            engine_kind: "external".to_string(),
            api_base: DEFAULT_SYNCTHING_URL.to_string(),
            executable: find_syncthing_executable()
                .ok()
                .flatten()
                .map(|path| path.to_string_lossy().to_string()),
            message,
        },
        Err(health_error) => match find_syncthing_executable() {
            Ok(Some(path)) => SyncthingStatus {
                available: true,
                running: false,
                managed,
                engine_kind: "external".to_string(),
                api_base: DEFAULT_SYNCTHING_URL.to_string(),
                executable: Some(path.to_string_lossy().to_string()),
                message: if managed {
                    "Syncthing 进程正在启动，管理接口尚未就绪。".to_string()
                } else {
                    "已检测到 Syncthing，但当前没有运行。".to_string()
                },
            },
            Ok(None) => SyncthingStatus {
                available: false,
                running: false,
                managed: false,
                engine_kind: "external".to_string(),
                api_base: DEFAULT_SYNCTHING_URL.to_string(),
                executable: None,
                message: "未找到 Syncthing。请先安装，或设置 SLIGHT_SYNCTHING_BIN。".to_string(),
            },
            Err(discovery_error) => SyncthingStatus {
                available: false,
                running: false,
                managed: false,
                engine_kind: "external".to_string(),
                api_base: DEFAULT_SYNCTHING_URL.to_string(),
                executable: None,
                message: format!("{discovery_error} {health_error}"),
            },
        },
    }
}

fn inspect_managed_process(state: &SyncthingProcess) -> Result<ManagedProcessInspection, String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "无法读取 Syncthing 进程状态。".to_string())?;
    let inspection = match guard.as_mut() {
        None => ManagedProcessInspection::NotManaged,
        Some(child) => match child
            .try_wait()
            .map_err(|err| format!("无法检查 Syncthing 进程：{err}"))?
        {
            None => ManagedProcessInspection::Running,
            Some(status) => ManagedProcessInspection::Exited(status.code()),
        },
    };
    if matches!(inspection, ManagedProcessInspection::Exited(_)) {
        guard.take();
    }
    Ok(inspection)
}

fn format_managed_exit(code: Option<i32>) -> String {
    match code {
        Some(value) => format!("应用启动的 Syncthing 已提前退出，退出码：{value}。"),
        None => "应用启动的 Syncthing 已提前退出。".to_string(),
    }
}

fn use_external_override() -> bool {
    env::var_os("SLIGHT_SYNCTHING_BIN").is_some_and(|value| !value.is_empty())
}

fn ensure_runtime_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|err| format!("无法创建 Syncthing 应用目录 {}：{err}", path.display()))?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|err| format!("无法检查 Syncthing 应用目录 {}：{err}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("Syncthing 应用目录不可用：{}", path.display()));
    }
    Ok(())
}

fn valid_managed_api_key(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn write_private_file(path: &Path, content: &str) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, content).map_err(|err| format!("无法保存 Syncthing 本机凭据：{err}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|err| format!("无法限制 Syncthing 本机凭据权限：{err}"))?;
    }
    fs::rename(&temporary, path).map_err(|err| format!("无法启用 Syncthing 本机凭据：{err}"))
}

fn load_or_create_api_key(runtime_dir: &Path) -> Result<String, String> {
    let path = runtime_dir.join("api-key");
    if path.exists() {
        let metadata = fs::symlink_metadata(&path)
            .map_err(|err| format!("无法检查 Syncthing 本机凭据：{err}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Syncthing 本机凭据路径不是普通文件。".to_string());
        }
        let key = fs::read_to_string(&path)
            .map_err(|err| format!("无法读取 Syncthing 本机凭据：{err}"))?;
        let key = key.trim().to_string();
        if valid_managed_api_key(&key) {
            return Ok(key);
        }
        return Err(
            "Syncthing 本机凭据已损坏。请删除应用数据中的 syncthing/runtime/api-key 后重试。"
                .to_string(),
        );
    }

    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|err| format!("无法生成 Syncthing 本机凭据：{err}"))?;
    let key = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    write_private_file(&path, &key)?;
    Ok(key)
}

fn build_sidecar_runtime(app: &AppHandle) -> Result<SidecarRuntimeConfig, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法获取应用数据目录：{err}"))?
        .join("syncthing");
    let config_dir = root.join("config");
    let data_dir = root.join("data");
    let log_dir = root.join("logs");
    let runtime_dir = root.join("runtime");
    for directory in [&config_dir, &data_dir, &log_dir, &runtime_dir] {
        ensure_runtime_directory(directory)?;
    }
    let api_key = load_or_create_api_key(&runtime_dir)?;
    Ok(SidecarRuntimeConfig {
        config_dir,
        data_dir,
        log_file: log_dir.join("syncthing.log"),
        api_key,
    })
}

fn sidecar_runtime(
    app: &AppHandle,
    state: &SyncthingSidecar,
) -> Result<SidecarRuntimeConfig, String> {
    let mut guard = state
        .runtime
        .lock()
        .map_err(|_| "无法读取 Syncthing sidecar 配置。".to_string())?;
    if let Some(runtime) = guard.clone() {
        return Ok(runtime);
    }
    let runtime = build_sidecar_runtime(app)?;
    *guard = Some(runtime.clone());
    Ok(runtime)
}

fn build_sidecar_args(runtime: &SidecarRuntimeConfig) -> Vec<OsString> {
    vec![
        "serve".into(),
        "--config".into(),
        runtime.config_dir.as_os_str().to_owned(),
        "--data".into(),
        runtime.data_dir.as_os_str().to_owned(),
        "--gui-address".into(),
        SIDECAR_SOCKET.into(),
        "--log-file".into(),
        runtime.log_file.as_os_str().to_owned(),
        "--log-max-old-files=3".into(),
        "--log-max-size=1048576".into(),
        "--no-browser".into(),
        "--no-restart".into(),
        "--no-upgrade".into(),
    ]
}

fn sidecar_process_is_tracked(state: &SyncthingSidecar) -> bool {
    state
        .child
        .lock()
        .map(|child| child.is_some())
        .unwrap_or(false)
}

fn sidecar_authenticated(runtime: &SidecarRuntimeConfig) -> bool {
    execute_syncthing_request_at(
        SIDECAR_SYNCTHING_URL,
        "GET",
        "/rest/system/status",
        None,
        Some(&runtime.api_key),
    )
    .map(|response| (200..300).contains(&response.status))
    .unwrap_or(false)
}

fn sidecar_port_is_occupied() -> bool {
    let address: SocketAddr = SIDECAR_SOCKET.parse().expect("valid sidecar socket");
    TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok()
}

fn sidecar_status_snapshot(
    runtime: &SidecarRuntimeConfig,
    state: &SyncthingSidecar,
) -> SyncthingStatus {
    let running = sidecar_authenticated(runtime);
    let managed = running || sidecar_process_is_tracked(state);
    let last_exit = state.last_exit.lock().ok().and_then(|value| *value);
    let message = if running {
        "内置 P2P 同步引擎运行正常。".to_string()
    } else if managed {
        "内置 P2P 同步引擎正在启动。".to_string()
    } else if let Some(code) = last_exit {
        format_managed_exit(code)
    } else {
        "内置 P2P 同步引擎尚未启动。".to_string()
    };
    SyncthingStatus {
        available: true,
        running,
        managed,
        engine_kind: "sidecar".to_string(),
        api_base: SIDECAR_SYNCTHING_URL.to_string(),
        executable: None,
        message,
    }
}

#[tauri::command]
fn syncthing_status(
    app: AppHandle,
    external: State<'_, SyncthingProcess>,
    sidecar: State<'_, SyncthingSidecar>,
) -> SyncthingStatus {
    if !use_external_override() {
        return match sidecar_runtime(&app, &sidecar) {
            Ok(runtime) => sidecar_status_snapshot(&runtime, &sidecar),
            Err(message) => SyncthingStatus {
                available: false,
                running: false,
                managed: false,
                engine_kind: "sidecar".to_string(),
                api_base: SIDECAR_SYNCTHING_URL.to_string(),
                executable: None,
                message,
            },
        };
    }

    match inspect_managed_process(&external) {
        Ok(ManagedProcessInspection::Running) => external_syncthing_status_snapshot(true),
        Ok(ManagedProcessInspection::Exited(code)) => {
            let mut status = external_syncthing_status_snapshot(false);
            if !status.running {
                status.message = format_managed_exit(code);
            }
            status
        }
        Ok(ManagedProcessInspection::NotManaged) => external_syncthing_status_snapshot(false),
        Err(err) => {
            let mut status = external_syncthing_status_snapshot(false);
            status.message = err;
            status
        }
    }
}

fn start_external_syncthing(state: &SyncthingProcess) -> Result<SyncthingStatus, String> {
    let already_managed = matches!(
        inspect_managed_process(state)?,
        ManagedProcessInspection::Running
    );
    if syncthing_health().is_ok() {
        return Ok(external_syncthing_status_snapshot(already_managed));
    }
    let executable = find_syncthing_executable()?
        .ok_or_else(|| "SLIGHT_SYNCTHING_BIN 指向的 Syncthing 可执行文件不存在。".to_string())?;
    let child = Command::new(&executable)
        .args(["serve", "--no-browser", "--no-restart", "--no-upgrade"])
        .spawn()
        .map_err(|err| format!("无法启动 Syncthing {}：{err}", executable.display()))?;
    *state
        .child
        .lock()
        .map_err(|_| "无法记录 Syncthing 进程状态。".to_string())? = Some(child);

    for _ in 0..SYNCTHING_STARTUP_ATTEMPTS {
        if syncthing_health_with_timeout(SYNCTHING_STARTUP_INTERVAL).is_ok() {
            return Ok(external_syncthing_status_snapshot(true));
        }
        match inspect_managed_process(state)? {
            ManagedProcessInspection::Running => std::thread::sleep(SYNCTHING_STARTUP_INTERVAL),
            ManagedProcessInspection::Exited(code) => return Err(format_managed_exit(code)),
            ManagedProcessInspection::NotManaged => {
                return Err("Syncthing 启动进程状态丢失，请重新尝试。".to_string());
            }
        }
    }
    Ok(external_syncthing_status_snapshot(true))
}

fn ensure_sidecar_notes_folder(
    app: &AppHandle,
    runtime: &SidecarRuntimeConfig,
) -> Result<(), String> {
    let notes_dir = default_notes_dir(app)?;
    ensure_directory(&notes_dir)?;
    let expected_path = canonical_existing_path(&notes_dir)?;
    let folders = request_syncthing_json_at(
        SIDECAR_SYNCTHING_URL,
        "GET",
        "/rest/config/folders",
        None,
        &runtime.api_key,
        "检查内置同步文件夹",
    )?;
    let folder_list = folders
        .as_array()
        .ok_or_else(|| "Syncthing folder 配置格式无效。".to_string())?;
    if folder_list
        .iter()
        .any(|folder| folder_path_matches(folder, &expected_path))
    {
        return Ok(());
    }
    if folder_list
        .iter()
        .any(|folder| folder["id"].as_str() == Some(SIDECAR_FOLDER_ID))
    {
        return Err("内置同步文件夹 ID 已指向其他目录。请在同步中心修复配置后重试。".to_string());
    }
    let config = PendingFolderConfig {
        folder_id: SIDECAR_FOLDER_ID.to_string(),
        path: expected_path.to_string_lossy().to_string(),
        device_ids: Vec::new(),
        created_at: Instant::now(),
    };
    apply_new_folder_config_at(SIDECAR_SYNCTHING_URL, &config, &runtime.api_key)?;
    Ok(())
}

fn configure_sidecar_options(mut options: serde_json::Value) -> Result<serde_json::Value, String> {
    let object = options
        .as_object_mut()
        .ok_or_else(|| "Syncthing options 配置格式无效。".to_string())?;
    object.insert(
        "listenAddresses".to_string(),
        serde_json::json!([
            format!("tcp://0.0.0.0:{SIDECAR_SYNC_PORT}"),
            format!("quic://0.0.0.0:{SIDECAR_SYNC_PORT}")
        ]),
    );
    object.insert(
        "localAnnouncePort".to_string(),
        serde_json::json!(SIDECAR_DISCOVERY_PORT),
    );
    object.insert(
        "localAnnounceMCAddr".to_string(),
        serde_json::json!(format!("[ff12::8384]:{SIDECAR_DISCOVERY_PORT}")),
    );
    object.insert("startBrowser".to_string(), serde_json::json!(false));
    object.insert("autoUpgradeIntervalH".to_string(), serde_json::json!(0));
    Ok(options)
}

fn sidecar_options_match(options: &serde_json::Value) -> bool {
    options["listenAddresses"]
        == serde_json::json!([
            format!("tcp://0.0.0.0:{SIDECAR_SYNC_PORT}"),
            format!("quic://0.0.0.0:{SIDECAR_SYNC_PORT}")
        ])
        && options["localAnnouncePort"] == serde_json::json!(SIDECAR_DISCOVERY_PORT)
        && options["startBrowser"] == serde_json::json!(false)
        && options["autoUpgradeIntervalH"] == serde_json::json!(0)
}

fn ensure_sidecar_options(runtime: &SidecarRuntimeConfig) -> Result<(), String> {
    let current = request_syncthing_json_at(
        SIDECAR_SYNCTHING_URL,
        "GET",
        "/rest/config/options",
        None,
        &runtime.api_key,
        "读取内置同步引擎端口配置",
    )?;
    if sidecar_options_match(&current) {
        return Ok(());
    }
    let desired = configure_sidecar_options(current)?;
    let body = serde_json::to_string(&desired)
        .map_err(|err| format!("无法生成内置同步引擎端口配置：{err}"))?;
    ensure_syncthing_success(
        execute_syncthing_request_at(
            SIDECAR_SYNCTHING_URL,
            "PUT",
            "/rest/config/options",
            Some(&body),
            Some(&runtime.api_key),
        )?,
        "写入内置同步引擎端口配置",
    )?;
    let verified = request_syncthing_json_at(
        SIDECAR_SYNCTHING_URL,
        "GET",
        "/rest/config/options",
        None,
        &runtime.api_key,
        "验证内置同步引擎端口配置",
    )?;
    if !sidecar_options_match(&verified) {
        return Err("内置同步引擎端口配置回读不一致，请检查 Syncthing 日志。".to_string());
    }
    Ok(())
}

fn spawn_sidecar(
    app: &AppHandle,
    state: &SyncthingSidecar,
    runtime: &SidecarRuntimeConfig,
) -> Result<(), String> {
    let command = app
        .shell()
        .sidecar(SIDECAR_BINARY_NAME)
        .map_err(|err| format!("安装包中的 Syncthing sidecar 不可用：{err}"))?
        .args(build_sidecar_args(runtime))
        .env("STGUIAPIKEY", &runtime.api_key)
        .env("STNODEFAULTFOLDER", "true")
        .env("STVERSIONEXTRA", "s-light-notes-v2");
    let (mut receiver, child) = command
        .spawn()
        .map_err(|err| format!("无法启动安装包中的 Syncthing sidecar：{err}"))?;
    let child_pid = child.pid();
    *state
        .child
        .lock()
        .map_err(|_| "无法记录 Syncthing sidecar 进程。".to_string())? = Some(child);
    *state
        .last_exit
        .lock()
        .map_err(|_| "无法清理 Syncthing sidecar 退出状态。".to_string())? = None;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Terminated(payload) => {
                    let state = app_handle.state::<SyncthingSidecar>();
                    if let Ok(mut child) = state.child.lock() {
                        if child
                            .as_ref()
                            .is_some_and(|tracked| tracked.pid() == child_pid)
                        {
                            child.take();
                        }
                    }
                    if let Ok(mut last_exit) = state.last_exit.lock() {
                        *last_exit = Some(payload.code);
                    }
                    break;
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("Syncthing sidecar: {}", String::from_utf8_lossy(&line));
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn start_syncthing_engine(
    app: &AppHandle,
    external: &SyncthingProcess,
    sidecar: &SyncthingSidecar,
) -> Result<SyncthingStatus, String> {
    if use_external_override() {
        return start_external_syncthing(external);
    }
    let _start_guard = sidecar
        .lifecycle_lock
        .lock()
        .map_err(|_| "无法锁定 Syncthing sidecar 启动流程。".to_string())?;
    let runtime = sidecar_runtime(app, sidecar)?;
    if sidecar_authenticated(&runtime) {
        ensure_sidecar_options(&runtime)?;
        ensure_sidecar_notes_folder(app, &runtime)?;
        return Ok(sidecar_status_snapshot(&runtime, sidecar));
    }
    if sidecar_port_is_occupied() {
        return Err("内置同步端口 8385 已被其他程序占用。请关闭占用程序后重试；系统 Syncthing 可继续使用默认 8384 端口。".to_string());
    }
    if !sidecar_process_is_tracked(sidecar) {
        spawn_sidecar(app, sidecar, &runtime)?;
    }
    for _ in 0..SYNCTHING_STARTUP_ATTEMPTS {
        if sidecar_authenticated(&runtime) {
            ensure_sidecar_options(&runtime)?;
            ensure_sidecar_notes_folder(app, &runtime)?;
            return Ok(sidecar_status_snapshot(&runtime, sidecar));
        }
        if !sidecar_process_is_tracked(sidecar) {
            let code = sidecar
                .last_exit
                .lock()
                .ok()
                .and_then(|value| *value)
                .flatten();
            return Err(format_managed_exit(code));
        }
        std::thread::sleep(SYNCTHING_STARTUP_INTERVAL);
    }
    Err("内置 P2P 同步引擎启动超时。日志位于应用数据目录的 syncthing/logs。".to_string())
}

#[tauri::command]
fn syncthing_start(
    app: AppHandle,
    external: State<'_, SyncthingProcess>,
    sidecar: State<'_, SyncthingSidecar>,
) -> Result<SyncthingStatus, String> {
    start_syncthing_engine(&app, &external, &sidecar)
}

#[tauri::command]
fn syncthing_stop(
    app: AppHandle,
    external: State<'_, SyncthingProcess>,
    sidecar: State<'_, SyncthingSidecar>,
) -> Result<SyncthingStatus, String> {
    if !use_external_override() {
        stop_managed_sidecar(&app, &sidecar)?;
        let runtime = sidecar_runtime(&app, &sidecar)?;
        return Ok(sidecar_status_snapshot(&runtime, &sidecar));
    }

    stop_external_managed_process(&external)?;
    Ok(external_syncthing_status_snapshot(false))
}

fn stop_external_managed_process(external: &SyncthingProcess) -> Result<(), String> {
    let mut guard = external
        .child
        .lock()
        .map_err(|_| "无法读取 Syncthing 进程状态。".to_string())?;

    if let Some(mut child) = guard.take() {
        if child
            .try_wait()
            .map_err(|err| format!("无法检查 Syncthing 进程：{err}"))?
            .is_none()
        {
            child
                .kill()
                .map_err(|err| format!("无法停止由 s-light notes 启动的 Syncthing：{err}"))?;
            child
                .wait()
                .map_err(|err| format!("等待 Syncthing 停止时发生错误：{err}"))?;
        }
    }
    Ok(())
}

fn request_sidecar_shutdown_at(api_base: &str, api_key: &str) -> Result<(), String> {
    let url = build_syncthing_url_at(api_base, "/rest/system/shutdown")?;
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(1))
        .timeout_read(Duration::from_secs(2))
        .timeout_write(Duration::from_secs(2))
        .build();
    let response = apply_api_key(agent.post(&url), validate_api_key(Some(api_key))?)
        .set("Content-Type", "application/json")
        .send_string("");
    match response {
        Ok(response) if (200..300).contains(&response.status()) => Ok(()),
        Ok(response) => Err(format!(
            "Syncthing 拒绝正常退出，状态码 {}。",
            response.status()
        )),
        Err(ureq::Error::Status(status, _)) => {
            Err(format!("Syncthing 拒绝正常退出，状态码 {status}。"))
        }
        Err(err) => Err(format!("无法请求 Syncthing 正常退出：{err}")),
    }
}

fn wait_for_sidecar_shutdown(runtime: &SidecarRuntimeConfig) -> bool {
    for _ in 0..SYNCTHING_SHUTDOWN_ATTEMPTS {
        if !sidecar_authenticated(runtime) {
            return true;
        }
        std::thread::sleep(SYNCTHING_SHUTDOWN_INTERVAL);
    }
    !sidecar_authenticated(runtime)
}

fn stop_managed_sidecar(app: &AppHandle, sidecar: &SyncthingSidecar) -> Result<(), String> {
    let _stop_guard = sidecar
        .lifecycle_lock
        .lock()
        .map_err(|_| "无法锁定内置同步引擎停止流程。".to_string())?;
    let runtime = sidecar_runtime(app, sidecar)?;
    let child = sidecar
        .child
        .lock()
        .map_err(|_| "无法读取 Syncthing sidecar 进程状态。".to_string())?
        .take();

    let was_authenticated = sidecar_authenticated(&runtime);
    let shutdown_error = if was_authenticated {
        let error = request_sidecar_shutdown_at(SIDECAR_SYNCTHING_URL, &runtime.api_key).err();
        if wait_for_sidecar_shutdown(&runtime) {
            return Ok(());
        }
        error
    } else {
        if child.is_none() {
            return Ok(());
        }
        None
    };

    if let Some(child) = child {
        child
            .kill()
            .map_err(|err| format!("无法停止内置 P2P 同步引擎：{err}"))?;
    }
    if wait_for_sidecar_shutdown(&runtime) {
        return Ok(());
    }

    Err(shutdown_error.unwrap_or_else(|| {
        "内置 P2P 同步引擎未在限定时间内退出，请结束残留进程后重试。".to_string()
    }))
}

fn cleanup_managed_sync(app: &AppHandle) {
    if !use_external_override() {
        let sidecar = app.state::<SyncthingSidecar>();
        if let Err(err) = stop_managed_sidecar(app, &sidecar) {
            eprintln!("Syncthing 退出清理失败：{err}");
        }
    }
    let external = app.state::<SyncthingProcess>();
    if let Err(err) = stop_external_managed_process(&external) {
        eprintln!("外部 Syncthing 退出清理失败：{err}");
    }
}

fn active_syncthing_target(
    app: &AppHandle,
    sidecar: &SyncthingSidecar,
    supplied_api_key: Option<&str>,
) -> Result<(String, Option<String>), String> {
    if use_external_override() {
        return Ok((
            DEFAULT_SYNCTHING_URL.to_string(),
            validate_api_key(supplied_api_key)?.map(str::to_string),
        ));
    }
    let runtime = sidecar_runtime(app, sidecar)?;
    Ok((SIDECAR_SYNCTHING_URL.to_string(), Some(runtime.api_key)))
}

#[tauri::command]
fn syncthing_proxy_request(
    app: AppHandle,
    request: ProxyRequest,
    sidecar: State<'_, SyncthingSidecar>,
) -> Result<ProxyResponse, String> {
    let method = request.method.to_uppercase();
    if method != "GET" && method != "POST" {
        return Err("暂不支持该 Syncthing 请求方法。".to_string());
    }
    let (api_base, api_key) = active_syncthing_target(&app, &sidecar, request.api_key.as_deref())?;
    execute_syncthing_request_at(
        &api_base,
        &method,
        &request.path,
        request.body.as_deref(),
        api_key.as_deref(),
    )
}

fn execute_syncthing_request_at(
    api_base: &str,
    method: &str,
    path: &str,
    body: Option<&str>,
    api_key: Option<&str>,
) -> Result<ProxyResponse, String> {
    let url = build_syncthing_url_at(api_base, path)?;
    let agent = ureq::AgentBuilder::new()
        .timeout_read(Duration::from_secs(10))
        .timeout_write(Duration::from_secs(10))
        .build();

    let api_key = validate_api_key(api_key)?;
    let response = match method {
        "GET" => apply_api_key(agent.get(&url), api_key).call(),
        "POST" => apply_api_key(agent.post(&url), api_key)
            .set("Content-Type", "application/json")
            .send_string(body.unwrap_or("")),
        "PUT" => apply_api_key(agent.put(&url), api_key)
            .set("Content-Type", "application/json")
            .send_string(body.unwrap_or("")),
        "PATCH" => apply_api_key(agent.request("PATCH", &url), api_key)
            .set("Content-Type", "application/json")
            .send_string(body.unwrap_or("")),
        "DELETE" => apply_api_key(agent.delete(&url), api_key).call(),
        _ => return Err("暂不支持该 Syncthing 请求方法。".to_string()),
    };

    match response {
        Ok(res) => Ok(ProxyResponse {
            status: res.status(),
            body: res.into_string().unwrap_or_default(),
        }),
        Err(ureq::Error::Status(status, res)) => Ok(ProxyResponse {
            status,
            body: res.into_string().unwrap_or_default(),
        }),
        Err(err) => Err(format!("Syncthing 请求失败：{err}")),
    }
}

#[tauri::command]
fn syncthing_apply_folder_config(
    app: AppHandle,
    request: FolderConfigRequest,
    pending: State<'_, PendingFolderConfigs>,
) -> Result<serde_json::Value, String> {
    let notes_dir = default_notes_dir(&app)?;
    ensure_directory(&notes_dir)?;
    let mut preview = build_folder_config_preview(&notes_dir, &request)?;
    if preview["requiresConfirmation"].as_bool() == Some(true) {
        let config = pending_config_from_preview(&preview)?;
        let token = store_pending_folder_config(&pending, config)?;
        preview["confirmationToken"] = serde_json::Value::String(token);
        preview["expiresInSeconds"] = serde_json::json!(CONFIG_CONFIRMATION_TTL.as_secs());
    }
    Ok(preview)
}

#[tauri::command]
fn syncthing_confirm_folder_config(
    app: AppHandle,
    request: ConfirmFolderConfigRequest,
    pending: State<'_, PendingFolderConfigs>,
    sidecar: State<'_, SyncthingSidecar>,
) -> Result<serde_json::Value, String> {
    let config = take_pending_folder_config(&pending, &request.confirmation_token)?;
    let (api_base, api_key) = active_syncthing_target(&app, &sidecar, Some(&request.api_key))?;
    let api_key = api_key
        .as_deref()
        .ok_or_else(|| "确认写入前需要有效的 Syncthing API Key。".to_string())?;
    apply_new_folder_config_at(&api_base, &config, api_key)
}

fn pairing_runtime(
    app: &AppHandle,
    sidecar: &SyncthingSidecar,
) -> Result<SidecarRuntimeConfig, String> {
    if use_external_override() {
        return Err("设备配对向导仅适用于应用内置同步引擎。".to_string());
    }
    let runtime = sidecar_runtime(app, sidecar)?;
    if !sidecar_authenticated(&runtime) {
        return Err("内置 P2P 同步引擎尚未就绪，请稍后重试。".to_string());
    }
    Ok(runtime)
}

fn validate_device_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() {
        return Ok("另一台设备".to_string());
    }
    if name.chars().count() > 64 || name.chars().any(char::is_control) {
        return Err("设备名称不能超过 64 个字符且不能包含控制字符。".to_string());
    }
    Ok(name.to_string())
}

fn normalize_device_id_at(
    api_base: &str,
    api_key: &str,
    candidate: &str,
) -> Result<String, String> {
    let compact = candidate
        .chars()
        .filter(|character| !character.is_ascii_whitespace())
        .collect::<String>();
    if compact.len() < 52
        || compact.len() > 64
        || !compact
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("设备代码格式无效，请检查是否完整复制。".to_string());
    }
    let response = request_syncthing_json_at(
        api_base,
        "GET",
        &format!("/rest/svc/deviceid?id={compact}"),
        None,
        api_key,
        "校验设备代码",
    )?;
    if let Some(error) = response["error"].as_str() {
        return Err(format!("设备代码无效：{error}"));
    }
    response["id"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "Syncthing 未返回有效的设备代码。".to_string())
}

fn local_device_id_at(api_base: &str, api_key: &str) -> Result<String, String> {
    let status = request_syncthing_json_at(
        api_base,
        "GET",
        "/rest/system/status",
        None,
        api_key,
        "读取本机设备代码",
    )?;
    status["myID"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "Syncthing 未返回本机设备代码。".to_string())
}

fn configured_devices_at(api_base: &str, api_key: &str) -> Result<Vec<serde_json::Value>, String> {
    request_syncthing_json_at(
        api_base,
        "GET",
        "/rest/config/devices",
        None,
        api_key,
        "读取已配对设备",
    )?
    .as_array()
    .cloned()
    .ok_or_else(|| "Syncthing 设备配置格式无效。".to_string())
}

fn sidecar_folder_at(api_base: &str, api_key: &str) -> Result<serde_json::Value, String> {
    let folders = request_syncthing_json_at(
        api_base,
        "GET",
        "/rest/config/folders",
        None,
        api_key,
        "读取默认同步文件夹",
    )?;
    folders
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|folder| folder["id"].as_str() == Some(SIDECAR_FOLDER_ID))
        })
        .cloned()
        .ok_or_else(|| "默认笔记同步文件夹尚未准备好。".to_string())
}

fn store_pending_device_pairing(
    pending: &PendingDevicePairings,
    pairing: PendingDevicePairing,
) -> Result<String, String> {
    let mut items = pending
        .items
        .lock()
        .map_err(|_| "无法保存设备配对确认信息。".to_string())?;
    items.retain(|_, item| item.created_at.elapsed() <= CONFIG_CONFIRMATION_TTL);
    let token = new_confirmation_token();
    items.insert(token.clone(), pairing);
    Ok(token)
}

fn take_pending_device_pairing(
    pending: &PendingDevicePairings,
    token: &str,
) -> Result<PendingDevicePairing, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("缺少设备配对确认凭证，请重新检查设备代码。".to_string());
    }
    let mut items = pending
        .items
        .lock()
        .map_err(|_| "无法读取设备配对确认信息。".to_string())?;
    let pairing = items
        .remove(token)
        .ok_or_else(|| "设备配对确认已失效或已使用，请重新检查设备代码。".to_string())?;
    if pairing.created_at.elapsed() > CONFIG_CONFIRMATION_TTL {
        return Err("设备配对确认已超过五分钟，请重新检查设备代码。".to_string());
    }
    Ok(pairing)
}

fn pairing_info_at(api_base: &str, api_key: &str) -> Result<serde_json::Value, String> {
    let local_device_id = local_device_id_at(api_base, api_key)?;
    let local_device_qr_svg = device_id_qr_svg(&local_device_id)?;
    let devices = configured_devices_at(api_base, api_key)?;
    let connections = request_syncthing_json_at(
        api_base,
        "GET",
        "/rest/system/connections",
        None,
        api_key,
        "读取设备连接状态",
    )?;
    let pending_devices = request_syncthing_json_at(
        api_base,
        "GET",
        "/rest/cluster/pending/devices",
        None,
        api_key,
        "读取待确认设备",
    )
    .unwrap_or_else(|_| serde_json::json!({}));
    Ok(serde_json::json!({
        "localDeviceId": local_device_id,
        "localDeviceQrSvg": local_device_qr_svg,
        "folderId": SIDECAR_FOLDER_ID,
        "devices": devices,
        "connections": connections,
        "pendingDevices": pending_devices
    }))
}

fn device_id_qr_svg(device_id: &str) -> Result<String, String> {
    let code = QrCode::with_error_correction_level(device_id.as_bytes(), EcLevel::M)
        .map_err(|err| format!("无法生成本机设备二维码：{err}"))?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(256, 256)
        .quiet_zone(true)
        .dark_color(svg::Color("#111111"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

#[tauri::command]
fn syncthing_pairing_info(
    app: AppHandle,
    sidecar: State<'_, SyncthingSidecar>,
) -> Result<serde_json::Value, String> {
    let runtime = pairing_runtime(&app, &sidecar)?;
    pairing_info_at(SIDECAR_SYNCTHING_URL, &runtime.api_key)
}

fn syncthing_events_path(since: Option<u64>) -> String {
    let since = since.unwrap_or(0);
    let (timeout, limit) = if since == 0 { (0, 1) } else { (2, 64) };
    format!(
        "/rest/events?since={since}&limit={limit}&timeout={timeout}&events={SIDECAR_EVENT_FILTERS}"
    )
}

fn syncthing_events_at(
    api_base: &str,
    api_key: &str,
    since: Option<u64>,
) -> Result<Vec<serde_json::Value>, String> {
    let events = request_syncthing_json_at(
        api_base,
        "GET",
        &syncthing_events_path(since),
        None,
        api_key,
        "读取 Syncthing 实时状态",
    )?;
    let events = events
        .as_array()
        .cloned()
        .ok_or_else(|| "Syncthing 事件响应格式无效。".to_string())?;
    if events
        .iter()
        .any(|event| event["id"].as_u64().is_none() || event["type"].as_str().is_none())
    {
        return Err("Syncthing 返回了格式无效的事件。".to_string());
    }
    Ok(events)
}

#[tauri::command]
async fn syncthing_events(
    app: AppHandle,
    request: SyncthingEventsRequest,
    sidecar: State<'_, SyncthingSidecar>,
) -> Result<Vec<serde_json::Value>, String> {
    let runtime = pairing_runtime(&app, &sidecar)?;
    tauri::async_runtime::spawn_blocking(move || {
        syncthing_events_at(SIDECAR_SYNCTHING_URL, &runtime.api_key, request.since)
    })
    .await
    .map_err(|err| format!("Syncthing 事件任务异常结束：{err}"))?
}

#[tauri::command]
fn syncthing_preview_device_pairing(
    app: AppHandle,
    request: DevicePairingPreviewRequest,
    sidecar: State<'_, SyncthingSidecar>,
    pending: State<'_, PendingDevicePairings>,
) -> Result<serde_json::Value, String> {
    let runtime = pairing_runtime(&app, &sidecar)?;
    let device_id =
        normalize_device_id_at(SIDECAR_SYNCTHING_URL, &runtime.api_key, &request.device_id)?;
    let local_device_id = local_device_id_at(SIDECAR_SYNCTHING_URL, &runtime.api_key)?;
    if device_id == local_device_id {
        return Err("不能把本机设备代码添加为远端设备。".to_string());
    }
    if configured_devices_at(SIDECAR_SYNCTHING_URL, &runtime.api_key)?
        .iter()
        .any(|device| device["deviceID"].as_str() == Some(&device_id))
    {
        return Err("这台设备已经添加，无需重复配对。".to_string());
    }
    let device_name = validate_device_name(&request.device_name)?;
    let token = store_pending_device_pairing(
        &pending,
        PendingDevicePairing {
            device_id: device_id.clone(),
            device_name: device_name.clone(),
            created_at: Instant::now(),
        },
    )?;
    Ok(serde_json::json!({
        "requiresConfirmation": true,
        "confirmationToken": token,
        "expiresInSeconds": CONFIG_CONFIRMATION_TTL.as_secs(),
        "localDeviceId": local_device_id,
        "remoteDeviceId": device_id,
        "deviceName": device_name,
        "folderId": SIDECAR_FOLDER_ID,
        "message": "确认后会添加这台设备并向它共享默认笔记文件夹。另一台设备仍需输入本机设备代码并确认。"
    }))
}

fn build_device_payload(
    template: serde_json::Value,
    pairing: &PendingDevicePairing,
) -> Result<serde_json::Value, String> {
    let mut object = template
        .as_object()
        .cloned()
        .ok_or_else(|| "Syncthing 默认设备模板格式无效。".to_string())?;
    object.insert("deviceID".to_string(), serde_json::json!(pairing.device_id));
    object.insert("name".to_string(), serde_json::json!(pairing.device_name));
    object.insert("addresses".to_string(), serde_json::json!(["dynamic"]));
    object.insert("paused".to_string(), serde_json::json!(false));
    Ok(serde_json::Value::Object(object))
}

fn rollback_device_pairing_at(
    api_base: &str,
    api_key: &str,
    device_id: &str,
    original_folder_devices: &[serde_json::Value],
    restore_folder: bool,
) -> Vec<String> {
    let mut errors = Vec::new();
    if restore_folder {
        let body = serde_json::json!({ "devices": original_folder_devices }).to_string();
        if let Err(err) = execute_syncthing_request_at(
            api_base,
            "PATCH",
            &format!("/rest/config/folders/{SIDECAR_FOLDER_ID}"),
            Some(&body),
            Some(api_key),
        )
        .and_then(|response| ensure_syncthing_success(response, "撤销文件夹共享"))
        {
            errors.push(err);
        }
    }
    if let Err(err) = execute_syncthing_request_at(
        api_base,
        "DELETE",
        &format!("/rest/config/devices/{device_id}"),
        None,
        Some(api_key),
    )
    .and_then(|response| ensure_syncthing_success(response, "撤销远端设备"))
    {
        errors.push(err);
    }
    errors
}

fn apply_device_pairing_at(
    api_base: &str,
    api_key: &str,
    pairing: &PendingDevicePairing,
) -> Result<serde_json::Value, String> {
    let normalized = normalize_device_id_at(api_base, api_key, &pairing.device_id)?;
    if normalized != pairing.device_id {
        return Err("确认前设备代码发生变化，未执行配对。".to_string());
    }
    if configured_devices_at(api_base, api_key)?
        .iter()
        .any(|device| device["deviceID"].as_str() == Some(&pairing.device_id))
    {
        return Err("确认前该设备已经被添加，未重复写入。".to_string());
    }
    let folder = sidecar_folder_at(api_base, api_key)?;
    let original_folder_devices = folder["devices"]
        .as_array()
        .cloned()
        .ok_or_else(|| "默认同步文件夹的设备列表格式无效。".to_string())?;
    let template = request_syncthing_json_at(
        api_base,
        "GET",
        "/rest/config/defaults/device",
        None,
        api_key,
        "读取 Syncthing 默认设备模板",
    )?;
    let payload = build_device_payload(template, pairing)?;
    let payload_text =
        serde_json::to_string(&payload).map_err(|err| format!("无法生成远端设备配置：{err}"))?;
    ensure_syncthing_success(
        execute_syncthing_request_at(
            api_base,
            "POST",
            "/rest/config/devices",
            Some(&payload_text),
            Some(api_key),
        )?,
        "添加远端设备",
    )?;

    let mut shared_devices = original_folder_devices.clone();
    shared_devices.push(serde_json::json!({ "deviceID": pairing.device_id }));
    let folder_patch = serde_json::json!({ "devices": shared_devices }).to_string();
    let share_result = execute_syncthing_request_at(
        api_base,
        "PATCH",
        &format!("/rest/config/folders/{SIDECAR_FOLDER_ID}"),
        Some(&folder_patch),
        Some(api_key),
    )
    .and_then(|response| ensure_syncthing_success(response, "共享默认笔记文件夹"));
    if let Err(err) = share_result {
        let rollback = rollback_device_pairing_at(
            api_base,
            api_key,
            &pairing.device_id,
            &original_folder_devices,
            false,
        );
        return Err(format!(
            "{err}{}",
            if rollback.is_empty() {
                " 已撤销本轮新增设备。".to_string()
            } else {
                format!(" 自动撤销失败：{}", rollback.join("；"))
            }
        ));
    }

    let verification = (|| -> Result<bool, String> {
        let verified_device = configured_devices_at(api_base, api_key)?
            .iter()
            .any(|device| device["deviceID"].as_str() == Some(&pairing.device_id));
        let verified_folder = sidecar_folder_at(api_base, api_key)?["devices"]
            .as_array()
            .is_some_and(|devices| {
                devices
                    .iter()
                    .any(|device| device["deviceID"].as_str() == Some(&pairing.device_id))
            });
        Ok(verified_device && verified_folder)
    })();
    if verification.as_ref().ok() != Some(&true) {
        let rollback = rollback_device_pairing_at(
            api_base,
            api_key,
            &pairing.device_id,
            &original_folder_devices,
            true,
        );
        return Err(if rollback.is_empty() {
            format!(
                "设备配对回读验证失败，已撤销本轮配置。{}",
                verification
                    .err()
                    .map(|error| format!(" {error}"))
                    .unwrap_or_default()
            )
        } else {
            format!("设备配对验证和自动撤销均失败：{}", rollback.join("；"))
        });
    }

    Ok(serde_json::json!({
        "paired": true,
        "remoteDeviceId": pairing.device_id,
        "deviceName": pairing.device_name,
        "folderId": SIDECAR_FOLDER_ID,
        "connectionState": "waitingForRemote",
        "message": "本机配置已完成。请在另一台设备上输入本机设备代码并确认，双方确认后会自动连接和同步。"
    }))
}

#[tauri::command]
fn syncthing_confirm_device_pairing(
    app: AppHandle,
    request: ConfirmDevicePairingRequest,
    sidecar: State<'_, SyncthingSidecar>,
    pending: State<'_, PendingDevicePairings>,
) -> Result<serde_json::Value, String> {
    let runtime = pairing_runtime(&app, &sidecar)?;
    let pairing = take_pending_device_pairing(&pending, &request.confirmation_token)?;
    apply_device_pairing_at(SIDECAR_SYNCTHING_URL, &runtime.api_key, &pairing)
}

#[tauri::command]
fn open_notes_folder(app: AppHandle) -> Result<(), String> {
    let notes_dir = default_notes_dir(&app)?;
    ensure_directory(&notes_dir)?;
    opener::open(notes_dir).map_err(|err| format!("无法打开笔记目录：{err}"))
}

#[tauri::command]
fn open_syncthing_web() -> Result<(), String> {
    if !use_external_override() {
        return Err("内置同步引擎由应用安全管理，不需要打开端口或高级网页。".to_string());
    }
    opener::open(DEFAULT_SYNCTHING_URL).map_err(|err| format!("无法打开 Syncthing：{err}"))
}

fn default_notes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|err| format!("无法获取默认目录：{err}"))?
        .join("s-light-notes"))
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|err| format!("无法创建笔记目录：{err}"))?;
    let metadata = fs::symlink_metadata(path).map_err(|err| format!("无法检查笔记目录：{err}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("笔记目录不是可用的本地文件夹。".to_string());
    }
    Ok(())
}

fn note_directory(notes_dir: &Path, in_trash: bool) -> Result<PathBuf, String> {
    ensure_directory(notes_dir)?;
    if !in_trash {
        return Ok(notes_dir.to_path_buf());
    }

    let trash_dir = notes_dir.join(".trash");
    ensure_directory(&trash_dir)?;
    Ok(trash_dir)
}

fn validate_note_id(id: &str) -> Result<&str, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("笔记名称不能为空。".to_string());
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed.contains(':')
        || trimmed.contains('*')
        || trimmed.contains('?')
        || trimmed.contains('"')
        || trimmed.contains('<')
        || trimmed.contains('>')
        || trimmed.contains('|')
    {
        return Err("笔记名称包含不安全字符。".to_string());
    }
    Ok(trimmed)
}

fn note_path(directory: &Path, id: &str) -> Result<PathBuf, String> {
    Ok(directory.join(format!("{}.md", validate_note_id(id)?)))
}

fn ensure_regular_note_file(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|err| format!("无法检查笔记文件：{err}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("笔记路径不是普通 Markdown 文件。".to_string());
    }
    Ok(())
}

fn modified_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .unwrap_or(SystemTime::now())
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn desktop_note_from_path(path: &Path, in_trash: bool) -> Result<DesktopNote, String> {
    ensure_regular_note_file(path)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "笔记文件名无效。".to_string())?;
    let id = file_name
        .strip_suffix(".md")
        .ok_or_else(|| "笔记文件扩展名无效。".to_string())?;
    validate_note_id(id)?;
    let content = fs::read_to_string(path).map_err(|err| format!("无法读取笔记：{err}"))?;
    let metadata = fs::metadata(path).map_err(|err| format!("无法读取笔记信息：{err}"))?;
    Ok(DesktopNote {
        id: id.to_string(),
        content,
        updated_at: modified_millis(&metadata),
        in_trash,
    })
}

fn list_notes_in_dir(notes_dir: &Path, in_trash: bool) -> Result<Vec<DesktopNote>, String> {
    let directory = note_directory(notes_dir, in_trash)?;
    let mut notes = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|err| format!("无法读取笔记目录：{err}"))?
    {
        let entry = entry.map_err(|err| format!("无法读取笔记目录项：{err}"))?;
        let path = entry.path();
        let is_markdown = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.ends_with(".md"))
            .unwrap_or(false);
        if !is_markdown {
            continue;
        }
        match desktop_note_from_path(&path, in_trash) {
            Ok(note) => notes.push(note),
            Err(err) => eprintln!("跳过无法读取的笔记 {}：{}", path.display(), err),
        }
    }
    notes.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(notes)
}

fn read_note_in_dir(
    notes_dir: &Path,
    id: &str,
    in_trash: bool,
) -> Result<Option<DesktopNote>, String> {
    let directory = note_directory(notes_dir, in_trash)?;
    let path = note_path(&directory, id)?;
    if !path.exists() {
        return Ok(None);
    }
    desktop_note_from_path(&path, in_trash).map(Some)
}

fn unique_note_id(directory: &Path, suggested_id: &str) -> Result<String, String> {
    let base = validate_note_id(suggested_id)?.to_string();
    let mut id = base.clone();
    let mut counter = 2;
    while note_path(directory, &id)?.exists() {
        id = format!("{base}-{counter}");
        counter += 1;
    }
    Ok(id)
}

fn save_note_in_dir(
    notes_dir: &Path,
    id: Option<&str>,
    suggested_id: &str,
    content: &str,
) -> Result<SavedNote, String> {
    let directory = note_directory(notes_dir, false)?;
    let id = match id {
        Some(value) => validate_note_id(value)?.to_string(),
        None => unique_note_id(&directory, suggested_id)?,
    };
    let path = note_path(&directory, &id)?;
    if path.exists() {
        ensure_regular_note_file(&path)?;
    }
    fs::write(&path, content).map_err(|err| format!("无法保存笔记：{err}"))?;
    let metadata = fs::metadata(&path).map_err(|err| format!("无法读取保存结果：{err}"))?;
    Ok(SavedNote {
        id,
        updated_at: modified_millis(&metadata),
    })
}

fn copy_then_remove(source: &Path, destination: &Path) -> Result<(), String> {
    ensure_regular_note_file(source)?;
    if destination.exists() {
        ensure_regular_note_file(destination)?;
    }
    fs::copy(source, destination).map_err(|err| format!("无法移动笔记：{err}"))?;
    fs::remove_file(source).map_err(|err| format!("无法清理原笔记：{err}"))
}

fn move_note_to_trash(notes_dir: &Path, id: &str) -> Result<(), String> {
    let source_dir = note_directory(notes_dir, false)?;
    let trash_dir = note_directory(notes_dir, true)?;
    let source = note_path(&source_dir, id)?;
    if !source.exists() {
        return Ok(());
    }
    let destination = note_path(&trash_dir, id)?;
    copy_then_remove(&source, &destination)
}

fn restore_note_from_trash(notes_dir: &Path, id: &str) -> Result<(), String> {
    let source_dir = note_directory(notes_dir, true)?;
    let destination_dir = note_directory(notes_dir, false)?;
    let source = note_path(&source_dir, id)?;
    if !source.exists() {
        return Ok(());
    }
    let destination = note_path(&destination_dir, id)?;
    copy_then_remove(&source, &destination)
}

fn permanently_delete_note(notes_dir: &Path, id: &str) -> Result<(), String> {
    let trash_dir = note_directory(notes_dir, true)?;
    let path = note_path(&trash_dir, id)?;
    if !path.exists() {
        return Ok(());
    }
    ensure_regular_note_file(&path)?;
    fs::remove_file(path).map_err(|err| format!("无法永久删除笔记：{err}"))
}

fn validate_config_id(value: &str, label: &str) -> Result<String, String> {
    let id = value.trim();
    if id.is_empty() {
        return Err(format!("{label}不能为空。"));
    }
    if id.len() > 128 || id.chars().any(char::is_control) || id.contains('/') || id.contains('\\') {
        return Err(format!("{label}格式无效。"));
    }
    Ok(id.to_string())
}

fn validate_folder_id(value: &str) -> Result<String, String> {
    let id = validate_config_id(value, "Syncthing folder ID")?;
    if !id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err("Syncthing folder ID 只能包含英文字母、数字、短横线、下划线和点。".to_string());
    }
    Ok(id)
}

fn canonical_existing_path(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|err| format!("无法确认文件夹路径 {}：{err}", path.display()))
}

fn build_folder_config_preview(
    notes_dir: &Path,
    request: &FolderConfigRequest,
) -> Result<serde_json::Value, String> {
    let expected_path = canonical_existing_path(notes_dir)?;
    let requested_path = canonical_existing_path(Path::new(request.path.trim()))?;
    if requested_path != expected_path {
        return Err("只能为 v2 默认笔记目录生成 Syncthing 配置预览。".to_string());
    }

    let selected_matches = request
        .selected_folder_path
        .as_deref()
        .and_then(|path| fs::canonicalize(Path::new(path.trim())).ok())
        .map(|path| path == expected_path)
        .unwrap_or(false);
    let proposed_id = validate_folder_id(request.folder_id.as_deref().unwrap_or("s-light-notes"))?;
    let folder_id = if selected_matches {
        validate_folder_id(
            request
                .selected_folder_id
                .as_deref()
                .unwrap_or(&proposed_id),
        )?
    } else {
        if request
            .existing_folder_ids
            .iter()
            .any(|id| id.trim() == proposed_id)
        {
            return Err("该 Syncthing folder ID 已存在，请更换一个 ID。".to_string());
        }
        proposed_id
    };

    let requested_device_ids = if selected_matches {
        &request.selected_folder_device_ids
    } else {
        &request.device_ids
    };
    let mut device_ids = Vec::new();
    for value in requested_device_ids {
        let id = validate_config_id(value, "设备 ID")?;
        if !device_ids.contains(&id) {
            device_ids.push(id);
        }
    }

    let operation = if selected_matches {
        "alreadyBound"
    } else {
        "createFolder"
    };
    let restart_impact = match request.restart_required {
        Some(true) => "alreadyRequired",
        Some(false) => "noneExpected",
        None => "unknown",
    };
    let message = if selected_matches {
        "默认笔记目录已经由所选 Syncthing folder 管理，无需写入配置。"
    } else {
        "当前只生成新 folder 配置摘要；正式写入前仍需二次确认。"
    };
    let device_count = device_ids.len();

    Ok(serde_json::json!({
        "operation": operation,
        "requiresConfirmation": !selected_matches,
        "writesConfiguration": false,
        "folderId": folder_id,
        "path": expected_path.to_string_lossy(),
        "deviceIds": device_ids,
        "deviceCount": device_count,
        "restartImpact": restart_impact,
        "message": message
    }))
}

fn pending_config_from_preview(preview: &serde_json::Value) -> Result<PendingFolderConfig, String> {
    let folder_id = preview["folderId"]
        .as_str()
        .ok_or_else(|| "配置预览缺少 folder ID。".to_string())?;
    let path = preview["path"]
        .as_str()
        .ok_or_else(|| "配置预览缺少笔记目录。".to_string())?;
    let device_ids = preview["deviceIds"]
        .as_array()
        .ok_or_else(|| "配置预览缺少共享设备信息。".to_string())?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| "配置预览中的设备 ID 无效。".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(PendingFolderConfig {
        folder_id: validate_folder_id(folder_id)?,
        path: path.to_string(),
        device_ids,
        created_at: Instant::now(),
    })
}

fn new_confirmation_token() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = CONFIG_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{timestamp:x}-{counter:x}")
}

fn store_pending_folder_config(
    pending: &PendingFolderConfigs,
    config: PendingFolderConfig,
) -> Result<String, String> {
    let mut items = pending
        .items
        .lock()
        .map_err(|_| "无法保存本次配置确认信息。".to_string())?;
    items.retain(|_, item| item.created_at.elapsed() <= CONFIG_CONFIRMATION_TTL);
    let token = new_confirmation_token();
    items.insert(token.clone(), config);
    Ok(token)
}

fn take_pending_folder_config(
    pending: &PendingFolderConfigs,
    token: &str,
) -> Result<PendingFolderConfig, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("缺少配置确认凭证，请重新生成预览。".to_string());
    }
    let mut items = pending
        .items
        .lock()
        .map_err(|_| "无法读取本次配置确认信息。".to_string())?;
    let config = items
        .remove(token)
        .ok_or_else(|| "配置确认已失效或已使用，请重新生成预览。".to_string())?;
    if config.created_at.elapsed() > CONFIG_CONFIRMATION_TTL {
        return Err("配置预览已超过五分钟，请重新生成后再确认。".to_string());
    }
    Ok(config)
}

fn ensure_syncthing_success(
    response: ProxyResponse,
    operation: &str,
) -> Result<ProxyResponse, String> {
    if (200..300).contains(&response.status) {
        return Ok(response);
    }
    if response.status == 401 || response.status == 403 {
        return Err("Syncthing 拒绝访问，请检查 API Key。".to_string());
    }
    Err(format!(
        "{operation}失败，Syncthing 返回状态码 {}。{}",
        response.status,
        if response.body.trim().is_empty() {
            String::new()
        } else {
            format!(" {}", response.body.trim())
        }
    ))
}

fn request_syncthing_json_at(
    api_base: &str,
    method: &str,
    path: &str,
    body: Option<&str>,
    api_key: &str,
    operation: &str,
) -> Result<serde_json::Value, String> {
    let response = execute_syncthing_request_at(api_base, method, path, body, Some(api_key))?;
    let response = ensure_syncthing_success(response, operation)?;
    serde_json::from_str(&response.body)
        .map_err(|err| format!("{operation}返回了无法识别的数据：{err}"))
}

fn folder_path_matches(folder: &serde_json::Value, expected: &Path) -> bool {
    folder["path"]
        .as_str()
        .and_then(|value| fs::canonicalize(Path::new(value.trim())).ok())
        .map(|path| path == expected)
        .unwrap_or(false)
}

fn build_folder_payload(
    template: serde_json::Value,
    config: &PendingFolderConfig,
) -> Result<serde_json::Value, String> {
    let mut object = template
        .as_object()
        .cloned()
        .ok_or_else(|| "Syncthing 默认 folder 模板格式无效。".to_string())?;
    object.insert("id".to_string(), serde_json::json!(config.folder_id));
    object.insert("label".to_string(), serde_json::json!("s-light notes"));
    object.insert("path".to_string(), serde_json::json!(config.path));
    object.insert(
        "devices".to_string(),
        serde_json::Value::Array(
            config
                .device_ids
                .iter()
                .map(|device_id| serde_json::json!({ "deviceID": device_id }))
                .collect(),
        ),
    );
    Ok(serde_json::Value::Object(object))
}

fn ensure_no_folder_conflicts(
    folder_list: &[serde_json::Value],
    config: &PendingFolderConfig,
    expected_path: &Path,
) -> Result<(), String> {
    if folder_list
        .iter()
        .any(|folder| folder["id"].as_str() == Some(&config.folder_id))
    {
        return Err("预览后该 folder ID 已被占用，未执行写入，请刷新后重新预览。".to_string());
    }
    if folder_list
        .iter()
        .any(|folder| folder_path_matches(folder, expected_path))
    {
        return Err("预览后该笔记目录已被 Syncthing 管理，未执行写入，请刷新状态。".to_string());
    }
    Ok(())
}

fn apply_new_folder_config_at(
    api_base: &str,
    config: &PendingFolderConfig,
    api_key: &str,
) -> Result<serde_json::Value, String> {
    let expected_path = canonical_existing_path(Path::new(&config.path))?;
    let folders = request_syncthing_json_at(
        api_base,
        "GET",
        "/rest/config/folders",
        None,
        api_key,
        "读取 Syncthing folder 配置",
    )?;
    let folder_list = folders
        .as_array()
        .ok_or_else(|| "Syncthing folder 配置格式无效。".to_string())?;
    ensure_no_folder_conflicts(folder_list, config, &expected_path)?;

    let template = request_syncthing_json_at(
        api_base,
        "GET",
        "/rest/config/defaults/folder",
        None,
        api_key,
        "读取 Syncthing 默认 folder 模板",
    )?;
    let payload = build_folder_payload(template, config)?;
    let payload_text = serde_json::to_string(&payload)
        .map_err(|err| format!("无法生成 Syncthing folder 配置：{err}"))?;
    ensure_syncthing_success(
        execute_syncthing_request_at(
            api_base,
            "POST",
            "/rest/config/folders",
            Some(&payload_text),
            Some(api_key),
        )?,
        "写入 Syncthing folder 配置",
    )?;

    let verification = request_syncthing_json_at(
        api_base,
        "GET",
        "/rest/config/folders",
        None,
        api_key,
        "验证 Syncthing folder 配置",
    );
    let verified = verification
        .as_ref()
        .ok()
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items.iter().any(|folder| {
                folder["id"].as_str() == Some(&config.folder_id)
                    && folder_path_matches(folder, &expected_path)
            })
        })
        .unwrap_or(false);
    if !verified {
        let rollback_path = format!("/rest/config/folders/{}", config.folder_id);
        let rollback =
            execute_syncthing_request_at(api_base, "DELETE", &rollback_path, None, Some(api_key))
                .and_then(|response| {
                    ensure_syncthing_success(response, "撤销 Syncthing folder 配置")
                });
        return Err(match rollback {
            Ok(_) => "写入后未能验证配置，已撤销本次新建，请重新尝试。".to_string(),
            Err(err) => {
                format!("写入后未能验证配置，自动撤销也失败：{err} 请打开 Syncthing 检查。")
            }
        });
    }

    let restart_required = request_syncthing_json_at(
        api_base,
        "GET",
        "/rest/config/restart-required",
        None,
        api_key,
        "读取 Syncthing 重启状态",
    )
    .ok()
    .and_then(|value| value["requiresRestart"].as_bool())
    .unwrap_or(false);

    Ok(serde_json::json!({
        "applied": true,
        "folderId": config.folder_id,
        "path": config.path,
        "deviceCount": config.device_ids.len(),
        "restartRequired": restart_required,
        "message": "Syncthing folder 已创建并通过回读验证。"
    }))
}

fn is_executable_file(path: &Path) -> bool {
    path.metadata()
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

fn resolve_syncthing_executable(
    configured: Option<PathBuf>,
    path_directories: &[PathBuf],
    common_paths: &[PathBuf],
) -> Option<PathBuf> {
    if let Some(configured_path) = configured {
        if is_executable_file(&configured_path) {
            return Some(configured_path);
        }
        if configured_path.components().count() == 1 {
            for directory in path_directories {
                let candidate = directory.join(&configured_path);
                if is_executable_file(&candidate) {
                    return Some(candidate);
                }
            }
        }
        return None;
    }

    let executable_names: &[&str] = if cfg!(windows) {
        &["syncthing.exe", "syncthing"]
    } else {
        &["syncthing"]
    };
    for directory in path_directories {
        for name in executable_names {
            let candidate = directory.join(name);
            if is_executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    common_paths
        .iter()
        .find(|path| is_executable_file(path))
        .cloned()
}

fn common_syncthing_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if cfg!(target_os = "macos") {
        paths.extend([
            PathBuf::from("/Applications/Syncthing.app/Contents/MacOS/syncthing"),
            PathBuf::from("/opt/homebrew/bin/syncthing"),
            PathBuf::from("/usr/local/bin/syncthing"),
        ]);
    }
    if cfg!(target_os = "linux") {
        paths.extend([
            PathBuf::from("/usr/bin/syncthing"),
            PathBuf::from("/usr/local/bin/syncthing"),
        ]);
    }
    if cfg!(windows) {
        for variable in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(base) = env::var_os(variable) {
                paths.push(PathBuf::from(base).join("Syncthing").join("syncthing.exe"));
            }
        }
    }
    paths
}

fn find_syncthing_executable() -> Result<Option<PathBuf>, String> {
    let configured = env::var_os("SLIGHT_SYNCTHING_BIN")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let path_directories = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    let resolved = resolve_syncthing_executable(
        configured.clone(),
        &path_directories,
        &common_syncthing_paths(),
    );
    if configured.is_some() && resolved.is_none() {
        return Err("SLIGHT_SYNCTHING_BIN 指向的 Syncthing 可执行文件不存在。".to_string());
    }
    Ok(resolved)
}

fn syncthing_health() -> Result<String, String> {
    syncthing_health_at(DEFAULT_SYNCTHING_URL, Duration::from_secs(3))
}

fn syncthing_health_with_timeout(timeout: Duration) -> Result<String, String> {
    syncthing_health_at(DEFAULT_SYNCTHING_URL, timeout)
}

fn syncthing_health_at(api_base: &str, timeout: Duration) -> Result<String, String> {
    let url = format!("{}/rest/noauth/health", api_base.trim_end_matches('/'));
    let response = ureq::get(&url)
        .timeout(timeout)
        .call()
        .map_err(|err| format!("Syncthing 未运行或无法访问：{err}"))?;
    response.into_string().map_err(|err| err.to_string())
}

#[cfg(test)]
fn build_syncthing_url(path: &str) -> Result<String, String> {
    build_syncthing_url_at(DEFAULT_SYNCTHING_URL, path)
}

fn build_syncthing_url_at(api_base: &str, path: &str) -> Result<String, String> {
    if !path.starts_with('/') {
        return Err("Syncthing API path 必须以 / 开头。".to_string());
    }
    if path.contains("://") || path.contains("..") {
        return Err("Syncthing API path 不安全。".to_string());
    }
    Ok(format!("{}{path}", api_base.trim_end_matches('/')))
}

fn validate_api_key(api_key: Option<&str>) -> Result<Option<&str>, String> {
    let key = api_key.map(str::trim).filter(|value| !value.is_empty());
    if let Some(value) = key {
        if value.len() > 512 || value.contains('\r') || value.contains('\n') {
            return Err("Syncthing API Key 格式无效。".to_string());
        }
    }
    Ok(key)
}

fn apply_api_key(request: ureq::Request, api_key: Option<&str>) -> ureq::Request {
    match api_key {
        Some(value) => request.set("X-API-Key", value),
        None => request,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SyncthingProcess::default())
        .manage(SyncthingSidecar::default())
        .manage(PendingFolderConfigs::default())
        .manage(PendingDevicePairings::default())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let external = handle.state::<SyncthingProcess>();
                let sidecar = handle.state::<SyncthingSidecar>();
                if let Err(err) = start_syncthing_engine(&handle, &external, &sidecar) {
                    eprintln!("Syncthing 自动启动失败：{err}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if !matches!(event, tauri::WindowEvent::Destroyed) {
                return;
            }
            cleanup_managed_sync(window.app_handle());
        })
        .invoke_handler(tauri::generate_handler![
            get_app_paths,
            ensure_notes_folder,
            desktop_list_notes,
            desktop_read_note,
            desktop_save_note,
            desktop_move_to_trash,
            desktop_restore_note,
            desktop_delete_note,
            syncthing_status,
            syncthing_start,
            syncthing_stop,
            syncthing_proxy_request,
            syncthing_apply_folder_config,
            syncthing_confirm_folder_config,
            syncthing_pairing_info,
            syncthing_events,
            syncthing_preview_device_pairing,
            syncthing_confirm_device_pairing,
            open_notes_folder,
            open_syncthing_web
        ])
        .build(tauri::generate_context!())
        .expect("error while running s-light notes");
    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            cleanup_managed_sync(app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{ErrorKind, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::Arc;
    use std::thread::{self, JoinHandle};

    #[test]
    fn rejects_relative_proxy_paths() {
        assert!(build_syncthing_url("rest/system/status").is_err());
    }

    #[test]
    fn rejects_proxy_paths_with_parent_traversal() {
        assert!(build_syncthing_url("/rest/../config").is_err());
    }

    #[test]
    fn builds_local_syncthing_url() {
        assert_eq!(
            build_syncthing_url("/rest/noauth/health").unwrap(),
            "http://127.0.0.1:8384/rest/noauth/health"
        );
    }

    #[test]
    fn applies_valid_api_key_header_without_persisting_it() {
        let request = apply_api_key(
            ureq::get("http://127.0.0.1:8384/rest/system/status"),
            validate_api_key(Some("  test-key  ")).unwrap(),
        );
        assert_eq!(request.header("X-API-Key"), Some("test-key"));
    }

    #[test]
    fn rejects_api_key_header_injection() {
        assert!(validate_api_key(Some("key\r\nInjected: value")).is_err());
        assert_eq!(validate_api_key(Some("   ")).unwrap(), None);
    }

    fn temporary_notes_dir(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("s-light-notes-{test_name}-{unique}"))
    }

    #[derive(Debug, Clone)]
    struct CapturedHttpRequest {
        method: String,
        path: String,
        headers: HashMap<String, String>,
        body: String,
    }

    fn read_http_request(stream: &mut TcpStream) -> CapturedHttpRequest {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut data = Vec::new();
        let mut buffer = [0_u8; 2048];
        let mut expected_length = None;
        loop {
            let count = stream.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            data.extend_from_slice(&buffer[..count]);
            if expected_length.is_none() {
                if let Some(header_end) = data.windows(4).position(|window| window == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&data[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .unwrap_or(0);
                    expected_length = Some(header_end + 4 + content_length);
                }
            }
            if expected_length.is_some_and(|length| data.len() >= length) {
                break;
            }
        }

        let header_end = data
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap();
        let header_text = String::from_utf8_lossy(&data[..header_end]);
        let mut lines = header_text.lines();
        let request_line = lines.next().unwrap();
        let mut request_parts = request_line.split_whitespace();
        let method = request_parts.next().unwrap().to_string();
        let path = request_parts.next().unwrap().to_string();
        let headers = lines
            .filter_map(|line| {
                let (name, value) = line.split_once(':')?;
                Some((name.to_ascii_lowercase(), value.trim().to_string()))
            })
            .collect();
        let body = String::from_utf8_lossy(&data[header_end + 4..]).to_string();
        CapturedHttpRequest {
            method,
            path,
            headers,
            body,
        }
    }

    fn write_json_response(stream: &mut TcpStream, status: u16, body: &str) {
        let reason = if status == 200 { "OK" } else { "Error" };
        let response = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).unwrap();
    }

    fn spawn_folder_config_server(
        verify_write: bool,
    ) -> (String, Arc<Mutex<Vec<CapturedHttpRequest>>>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let api_base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut folder_reads = 0;
            let mut stored_folder: Option<serde_json::Value> = None;
            while captured.lock().unwrap().len() < 5 && Instant::now() < deadline {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(err) if err.kind() == ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(err) => panic!("mock Syncthing listener failed: {err}"),
                };
                let request = read_http_request(&mut stream);
                let response_body = match (request.method.as_str(), request.path.as_str()) {
                    ("GET", "/rest/config/folders") => {
                        folder_reads += 1;
                        if folder_reads == 1 || !verify_write {
                            "[]".to_string()
                        } else {
                            serde_json::to_string(&vec![stored_folder.clone().unwrap()]).unwrap()
                        }
                    }
                    ("GET", "/rest/config/defaults/folder") => {
                        r#"{"type":"sendreceive","devices":[]}"#.to_string()
                    }
                    ("POST", "/rest/config/folders") => {
                        stored_folder = Some(serde_json::from_str(&request.body).unwrap());
                        "{}".to_string()
                    }
                    ("GET", "/rest/config/restart-required") => {
                        r#"{"requiresRestart":false}"#.to_string()
                    }
                    ("DELETE", path) if path.starts_with("/rest/config/folders/") => {
                        "{}".to_string()
                    }
                    _ => "{}".to_string(),
                };
                captured.lock().unwrap().push(request);
                write_json_response(&mut stream, 200, &response_body);
            }
        });
        (api_base, requests, handle)
    }

    fn spawn_device_pairing_server(
        remote_device_id: &'static str,
    ) -> (String, Arc<Mutex<Vec<CapturedHttpRequest>>>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let api_base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let local_device_id = "LOCALAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG-HHHHHHH";
            let mut devices = vec![serde_json::json!({
                "deviceID": local_device_id,
                "name": "Local"
            })];
            let mut folder_devices = vec![serde_json::json!({ "deviceID": local_device_id })];
            while captured.lock().unwrap().len() < 8 && Instant::now() < deadline {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(err) if err.kind() == ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(err) => panic!("mock pairing listener failed: {err}"),
                };
                let request = read_http_request(&mut stream);
                let response_body = if request.method == "GET"
                    && request.path.starts_with("/rest/svc/deviceid?id=")
                {
                    serde_json::json!({ "id": remote_device_id }).to_string()
                } else {
                    match (request.method.as_str(), request.path.as_str()) {
                        ("GET", "/rest/config/devices") => serde_json::to_string(&devices).unwrap(),
                        ("GET", "/rest/config/folders") => serde_json::json!([{
                            "id": SIDECAR_FOLDER_ID,
                            "path": "/tmp/notes",
                            "devices": folder_devices
                        }])
                        .to_string(),
                        ("GET", "/rest/config/defaults/device") => serde_json::json!({
                            "deviceID": "",
                            "name": "",
                            "addresses": ["dynamic"],
                            "paused": false
                        })
                        .to_string(),
                        ("POST", "/rest/config/devices") => {
                            devices.push(serde_json::from_str(&request.body).unwrap());
                            "{}".to_string()
                        }
                        ("PATCH", path)
                            if path == format!("/rest/config/folders/{SIDECAR_FOLDER_ID}") =>
                        {
                            let patch: serde_json::Value =
                                serde_json::from_str(&request.body).unwrap();
                            folder_devices = patch["devices"].as_array().unwrap().clone();
                            "{}".to_string()
                        }
                        _ => "{}".to_string(),
                    }
                };
                captured.lock().unwrap().push(request);
                write_json_response(&mut stream, 200, &response_body);
            }
        });
        (api_base, requests, handle)
    }

    fn spawn_events_server() -> (String, Arc<Mutex<Vec<CapturedHttpRequest>>>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let api_base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            captured.lock().unwrap().push(request);
            write_json_response(
                &mut stream,
                200,
                r#"[{"id":42,"type":"StateChanged","data":{"folder":"s-light-notes","to":"idle"}}]"#,
            );
        });
        (api_base, requests, handle)
    }

    fn spawn_shutdown_server() -> (String, Arc<Mutex<Vec<CapturedHttpRequest>>>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let api_base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            captured.lock().unwrap().push(request);
            write_json_response(&mut stream, 200, "{}");
        });
        (api_base, requests, handle)
    }

    #[test]
    fn resolves_configured_and_path_syncthing_executables() {
        let bin_dir = temporary_notes_dir("syncthing-bin");
        ensure_directory(&bin_dir).unwrap();
        let configured_binary = bin_dir.join("custom-syncthing");
        let path_binary = bin_dir.join(if cfg!(windows) {
            "syncthing.exe"
        } else {
            "syncthing"
        });
        fs::write(&configured_binary, b"test").unwrap();
        fs::write(&path_binary, b"test").unwrap();

        assert_eq!(
            resolve_syncthing_executable(Some(configured_binary.clone()), &[], &[]),
            Some(configured_binary)
        );
        assert_eq!(
            resolve_syncthing_executable(None, std::slice::from_ref(&bin_dir), &[]),
            Some(path_binary)
        );
        fs::remove_dir_all(bin_dir).unwrap();
    }

    #[test]
    fn configured_syncthing_path_does_not_silently_fall_back() {
        let common_dir = temporary_notes_dir("syncthing-common");
        ensure_directory(&common_dir).unwrap();
        let common_binary = common_dir.join("syncthing");
        fs::write(&common_binary, b"test").unwrap();

        assert_eq!(
            resolve_syncthing_executable(
                Some(PathBuf::from("missing-custom-syncthing")),
                &[],
                std::slice::from_ref(&common_binary),
            ),
            None
        );
        assert_eq!(
            resolve_syncthing_executable(None, &[], std::slice::from_ref(&common_binary)),
            Some(common_binary)
        );
        fs::remove_dir_all(common_dir).unwrap();
    }

    fn completed_test_child(exit_code: i32) -> Child {
        #[cfg(windows)]
        let mut child = Command::new("cmd")
            .args(["/C", &format!("exit {exit_code}")])
            .spawn()
            .unwrap();
        #[cfg(not(windows))]
        let mut child = Command::new("sh")
            .args(["-c", &format!("exit {exit_code}")])
            .spawn()
            .unwrap();
        child.wait().unwrap();
        child
    }

    #[test]
    fn managed_process_inspection_cleans_up_exited_children() {
        let state = SyncthingProcess::default();
        *state.child.lock().unwrap() = Some(completed_test_child(7));

        assert_eq!(
            inspect_managed_process(&state).unwrap(),
            ManagedProcessInspection::Exited(Some(7))
        );
        assert_eq!(
            inspect_managed_process(&state).unwrap(),
            ManagedProcessInspection::NotManaged
        );
        assert_eq!(
            format_managed_exit(Some(7)),
            "应用启动的 Syncthing 已提前退出，退出码：7。"
        );
    }

    #[test]
    fn managed_sidecar_key_is_random_private_and_persistent() {
        let runtime_dir = temporary_notes_dir("sidecar-key");
        ensure_runtime_directory(&runtime_dir).unwrap();
        let first = load_or_create_api_key(&runtime_dir).unwrap();
        let second = load_or_create_api_key(&runtime_dir).unwrap();

        assert_eq!(first, second);
        assert!(valid_managed_api_key(&first));
        assert_eq!(first.len(), 64);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(runtime_dir.join("api-key"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
        fs::remove_dir_all(runtime_dir).unwrap();
    }

    #[test]
    fn sidecar_arguments_isolate_state_and_never_contain_the_api_key() {
        let root = temporary_notes_dir("sidecar-args");
        let runtime = SidecarRuntimeConfig {
            config_dir: root.join("config"),
            data_dir: root.join("data"),
            log_file: root.join("logs").join("syncthing.log"),
            api_key: "a".repeat(64),
        };
        let arguments = build_sidecar_args(&runtime)
            .iter()
            .map(|value| value.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        let command_line = arguments.join(" ");

        assert!(arguments.contains(&"serve".to_string()));
        assert!(arguments.contains(&"127.0.0.1:8385".to_string()));
        assert!(arguments.contains(&"--no-browser".to_string()));
        assert!(arguments.contains(&"--no-restart".to_string()));
        assert!(arguments.contains(&"--no-upgrade".to_string()));
        assert!(command_line.contains(root.join("config").to_string_lossy().as_ref()));
        assert!(command_line.contains(root.join("data").to_string_lossy().as_ref()));
        assert!(!command_line.contains(&runtime.api_key));
    }

    #[test]
    fn sidecar_options_use_app_owned_sync_and_discovery_ports() {
        let options = configure_sidecar_options(serde_json::json!({
            "listenAddresses": ["default"],
            "localAnnouncePort": 21027,
            "startBrowser": true,
            "autoUpgradeIntervalH": 12,
            "unrelatedOption": "preserved"
        }))
        .unwrap();

        assert!(sidecar_options_match(&options));
        assert_eq!(
            options["listenAddresses"],
            serde_json::json!(["tcp://0.0.0.0:22001", "quic://0.0.0.0:22001"])
        );
        assert_eq!(options["localAnnouncePort"], 21028);
        assert_eq!(options["localAnnounceMCAddr"], "[ff12::8384]:21028");
        assert_eq!(options["unrelatedOption"], "preserved");
    }

    #[test]
    fn device_pairing_validates_names_and_rejects_incomplete_codes() {
        assert_eq!(validate_device_name("  Laptop  ").unwrap(), "Laptop");
        assert_eq!(validate_device_name("   ").unwrap(), "另一台设备");
        assert!(validate_device_name(&"x".repeat(65)).is_err());
        assert!(normalize_device_id_at("http://127.0.0.1:1", "key", "short-code").is_err());
    }

    #[test]
    fn device_id_qr_is_offline_svg_without_embedded_credentials() {
        let device_id = "MFZWI3D-BONSGYC-YLTMRWG-C43ENR5-QXGZDMM-FZWI3DP-BONSGYY-LTMRWAD";
        let svg = device_id_qr_svg(device_id).unwrap();

        assert!(svg.contains("<svg"));
        assert!(svg.contains("#111111"));
        assert!(!svg.contains(device_id));
        assert!(!svg.contains("apiKey"));
    }

    #[test]
    fn event_polling_uses_fixed_filters_and_incremental_ids() {
        assert!(syncthing_events_path(None).contains("since=0&limit=1&timeout=0"));
        assert!(syncthing_events_path(Some(41)).contains("since=41&limit=64&timeout=2"));
        assert!(syncthing_events_path(Some(41)).contains("DeviceConnected"));
        assert!(syncthing_events_path(Some(41)).contains("FolderErrors"));

        let (api_base, requests, server) = spawn_events_server();
        let events = syncthing_events_at(&api_base, "events-key", Some(41)).unwrap();
        server.join().unwrap();
        let captured = requests.lock().unwrap();

        assert_eq!(events[0]["id"], 42);
        assert_eq!(events[0]["type"], "StateChanged");
        assert_eq!(
            captured[0].headers.get("x-api-key").map(String::as_str),
            Some("events-key")
        );
        assert!(captured[0].path.starts_with("/rest/events?since=41"));
    }

    #[test]
    fn graceful_shutdown_uses_authenticated_syncthing_endpoint() {
        let (api_base, requests, server) = spawn_shutdown_server();

        request_sidecar_shutdown_at(&api_base, "shutdown-key").unwrap();
        server.join().unwrap();
        let captured = requests.lock().unwrap();

        assert_eq!(captured[0].method, "POST");
        assert_eq!(captured[0].path, "/rest/system/shutdown");
        assert_eq!(
            captured[0].headers.get("x-api-key").map(String::as_str),
            Some("shutdown-key")
        );
        assert!(captured[0].body.is_empty());
    }

    #[test]
    fn device_pairing_tokens_are_single_use() {
        let pending = PendingDevicePairings::default();
        let token = store_pending_device_pairing(
            &pending,
            PendingDevicePairing {
                device_id: "REMOTE".to_string(),
                device_name: "Laptop".to_string(),
                created_at: Instant::now(),
            },
        )
        .unwrap();

        assert_eq!(
            take_pending_device_pairing(&pending, &token)
                .unwrap()
                .device_name,
            "Laptop"
        );
        assert!(take_pending_device_pairing(&pending, &token).is_err());
    }

    #[test]
    fn device_pairing_payload_uses_safe_dynamic_defaults() {
        let pairing = PendingDevicePairing {
            device_id: "REMOTE-ID".to_string(),
            device_name: "Laptop".to_string(),
            created_at: Instant::now(),
        };
        let payload = build_device_payload(
            serde_json::json!({
                "deviceID": "",
                "name": "",
                "addresses": [],
                "paused": true,
                "compression": "metadata"
            }),
            &pairing,
        )
        .unwrap();

        assert_eq!(payload["deviceID"], "REMOTE-ID");
        assert_eq!(payload["name"], "Laptop");
        assert_eq!(payload["addresses"], serde_json::json!(["dynamic"]));
        assert_eq!(payload["paused"], false);
        assert_eq!(payload["compression"], "metadata");
    }

    #[test]
    fn rejects_unsafe_note_ids() {
        assert!(validate_note_id("../outside").is_err());
        assert!(validate_note_id("folder/note").is_err());
        assert!(validate_note_id("folder\\note").is_err());
        assert!(validate_note_id("valid-note.sync-conflict-20260714").is_ok());
    }

    #[test]
    fn saves_reads_and_lists_markdown_notes() {
        let notes_dir = temporary_notes_dir("save-read-list");
        let saved =
            save_note_in_dir(&notes_dir, None, "第一条笔记", "# 第一条笔记\n\n正文").unwrap();
        assert_eq!(saved.id, "第一条笔记");

        let read = read_note_in_dir(&notes_dir, &saved.id, false)
            .unwrap()
            .unwrap();
        assert_eq!(read.content, "# 第一条笔记\n\n正文");

        let duplicate = save_note_in_dir(&notes_dir, None, "第一条笔记", "第二份").unwrap();
        assert_eq!(duplicate.id, "第一条笔记-2");
        assert_eq!(list_notes_in_dir(&notes_dir, false).unwrap().len(), 2);
        fs::remove_dir_all(notes_dir).unwrap();
    }

    #[test]
    fn moves_restores_and_permanently_deletes_notes() {
        let notes_dir = temporary_notes_dir("trash");
        save_note_in_dir(&notes_dir, Some("回收测试"), "回收测试", "内容").unwrap();
        move_note_to_trash(&notes_dir, "回收测试").unwrap();
        assert!(read_note_in_dir(&notes_dir, "回收测试", false)
            .unwrap()
            .is_none());
        assert!(read_note_in_dir(&notes_dir, "回收测试", true)
            .unwrap()
            .is_some());

        restore_note_from_trash(&notes_dir, "回收测试").unwrap();
        assert!(read_note_in_dir(&notes_dir, "回收测试", false)
            .unwrap()
            .is_some());

        move_note_to_trash(&notes_dir, "回收测试").unwrap();
        permanently_delete_note(&notes_dir, "回收测试").unwrap();
        assert!(read_note_in_dir(&notes_dir, "回收测试", true)
            .unwrap()
            .is_none());
        fs::remove_dir_all(notes_dir).unwrap();
    }

    fn preview_request(path: &Path) -> FolderConfigRequest {
        FolderConfigRequest {
            path: path.to_string_lossy().to_string(),
            folder_id: Some("s-light-notes".to_string()),
            selected_folder_id: None,
            selected_folder_path: None,
            device_ids: vec!["DEVICE-A".to_string(), "DEVICE-A".to_string()],
            selected_folder_device_ids: Vec::new(),
            existing_folder_ids: Vec::new(),
            restart_required: Some(false),
        }
    }

    #[test]
    fn previews_new_folder_without_writing_configuration() {
        let notes_dir = temporary_notes_dir("folder-preview");
        ensure_directory(&notes_dir).unwrap();
        let preview =
            build_folder_config_preview(&notes_dir, &preview_request(&notes_dir)).unwrap();

        assert_eq!(preview["operation"], "createFolder");
        assert_eq!(preview["requiresConfirmation"], true);
        assert_eq!(preview["writesConfiguration"], false);
        assert_eq!(preview["deviceCount"], 1);
        assert_eq!(preview["restartImpact"], "noneExpected");
        fs::remove_dir_all(notes_dir).unwrap();
    }

    #[test]
    fn recognizes_an_existing_folder_bound_to_notes_path() {
        let notes_dir = temporary_notes_dir("folder-bound");
        ensure_directory(&notes_dir).unwrap();
        let mut request = preview_request(&notes_dir);
        request.selected_folder_id = Some("existing-notes".to_string());
        request.selected_folder_path = Some(notes_dir.to_string_lossy().to_string());
        request.existing_folder_ids = vec!["existing-notes".to_string()];
        let preview = build_folder_config_preview(&notes_dir, &request).unwrap();

        assert_eq!(preview["operation"], "alreadyBound");
        assert_eq!(preview["folderId"], "existing-notes");
        assert_eq!(preview["requiresConfirmation"], false);
        fs::remove_dir_all(notes_dir).unwrap();
    }

    #[test]
    fn rejects_outside_paths_and_duplicate_folder_ids() {
        let notes_dir = temporary_notes_dir("folder-boundary");
        let outside_dir = temporary_notes_dir("folder-outside");
        ensure_directory(&notes_dir).unwrap();
        ensure_directory(&outside_dir).unwrap();

        let outside_request = preview_request(&outside_dir);
        assert!(build_folder_config_preview(&notes_dir, &outside_request).is_err());

        let mut duplicate_request = preview_request(&notes_dir);
        duplicate_request.existing_folder_ids = vec!["s-light-notes".to_string()];
        assert!(build_folder_config_preview(&notes_dir, &duplicate_request).is_err());

        fs::remove_dir_all(notes_dir).unwrap();
        fs::remove_dir_all(outside_dir).unwrap();
    }

    fn pending_config(created_at: Instant) -> PendingFolderConfig {
        PendingFolderConfig {
            folder_id: "s-light-notes".to_string(),
            path: "/tmp/s-light-notes".to_string(),
            device_ids: vec!["DEVICE-A".to_string()],
            created_at,
        }
    }

    #[test]
    fn confirmation_tokens_are_single_use() {
        let pending = PendingFolderConfigs::default();
        let token = store_pending_folder_config(&pending, pending_config(Instant::now())).unwrap();

        assert_eq!(
            take_pending_folder_config(&pending, &token)
                .unwrap()
                .folder_id,
            "s-light-notes"
        );
        assert!(take_pending_folder_config(&pending, &token).is_err());
    }

    #[test]
    fn expired_confirmation_tokens_are_rejected() {
        let pending = PendingFolderConfigs::default();
        let expired_at = Instant::now()
            .checked_sub(CONFIG_CONFIRMATION_TTL + Duration::from_secs(1))
            .unwrap();
        pending
            .items
            .lock()
            .unwrap()
            .insert("expired".to_string(), pending_config(expired_at));

        assert!(take_pending_folder_config(&pending, "expired").is_err());
    }

    #[test]
    fn folder_ids_are_safe_for_confirmed_delete_paths() {
        assert_eq!(validate_folder_id("notes_2026.1").unwrap(), "notes_2026.1");
        assert!(validate_folder_id("notes?remove=true").is_err());
        assert!(validate_folder_id("笔记").is_err());
    }

    #[test]
    fn confirmed_payload_uses_syncthing_template_and_selected_devices() {
        let template = serde_json::json!({
            "type": "sendreceive",
            "rescanIntervalS": 3600,
            "devices": []
        });
        let config = pending_config(Instant::now());
        let payload = build_folder_payload(template, &config).unwrap();

        assert_eq!(payload["id"], "s-light-notes");
        assert_eq!(payload["path"], "/tmp/s-light-notes");
        assert_eq!(payload["type"], "sendreceive");
        assert_eq!(payload["devices"][0]["deviceID"], "DEVICE-A");
    }

    #[test]
    fn confirmed_write_rechecks_folder_id_and_path_conflicts() {
        let notes_dir = temporary_notes_dir("confirmed-conflict");
        ensure_directory(&notes_dir).unwrap();
        let expected_path = canonical_existing_path(&notes_dir).unwrap();
        let mut config = pending_config(Instant::now());
        config.path = expected_path.to_string_lossy().to_string();

        let id_conflict = vec![serde_json::json!({
            "id": "s-light-notes",
            "path": "/tmp/another-folder"
        })];
        assert!(ensure_no_folder_conflicts(&id_conflict, &config, &expected_path).is_err());

        let path_conflict = vec![serde_json::json!({
            "id": "another-id",
            "path": expected_path.to_string_lossy()
        })];
        assert!(ensure_no_folder_conflicts(&path_conflict, &config, &expected_path).is_err());
        assert!(ensure_no_folder_conflicts(&[], &config, &expected_path).is_ok());
        fs::remove_dir_all(notes_dir).unwrap();
    }

    #[test]
    fn confirmed_write_uses_authenticated_syncthing_protocol() {
        let notes_dir = temporary_notes_dir("confirmed-http-success");
        ensure_directory(&notes_dir).unwrap();
        let mut config = pending_config(Instant::now());
        config.path = canonical_existing_path(&notes_dir)
            .unwrap()
            .to_string_lossy()
            .to_string();
        let (api_base, requests, server) = spawn_folder_config_server(true);

        let result = apply_new_folder_config_at(&api_base, &config, "integration-key").unwrap();
        server.join().unwrap();
        let captured = requests.lock().unwrap().clone();

        assert_eq!(result["applied"], true);
        assert_eq!(result["restartRequired"], false);
        assert_eq!(captured.len(), 5);
        assert_eq!(
            captured
                .iter()
                .map(|request| format!("{} {}", request.method, request.path))
                .collect::<Vec<_>>(),
            vec![
                "GET /rest/config/folders",
                "GET /rest/config/defaults/folder",
                "POST /rest/config/folders",
                "GET /rest/config/folders",
                "GET /rest/config/restart-required",
            ]
        );
        assert!(captured.iter().all(|request| {
            request.headers.get("x-api-key").map(String::as_str) == Some("integration-key")
        }));
        let post = captured
            .iter()
            .find(|request| request.method == "POST")
            .unwrap();
        assert_eq!(
            post.headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
        let payload: serde_json::Value = serde_json::from_str(&post.body).unwrap();
        assert_eq!(payload["id"], "s-light-notes");
        assert_eq!(payload["path"], config.path);
        assert_eq!(payload["devices"][0]["deviceID"], "DEVICE-A");
        fs::remove_dir_all(notes_dir).unwrap();
    }

    #[test]
    fn confirmed_write_rolls_back_when_readback_does_not_match() {
        let notes_dir = temporary_notes_dir("confirmed-http-rollback");
        ensure_directory(&notes_dir).unwrap();
        let mut config = pending_config(Instant::now());
        config.path = canonical_existing_path(&notes_dir)
            .unwrap()
            .to_string_lossy()
            .to_string();
        let (api_base, requests, server) = spawn_folder_config_server(false);

        let error = apply_new_folder_config_at(&api_base, &config, "integration-key")
            .expect_err("verification mismatch should roll back");
        server.join().unwrap();
        let captured = requests.lock().unwrap().clone();

        assert!(error.contains("已撤销本次新建"));
        assert_eq!(captured.len(), 5);
        assert_eq!(captured[4].method, "DELETE");
        assert_eq!(captured[4].path, "/rest/config/folders/s-light-notes");
        assert_eq!(
            captured[4].headers.get("x-api-key").map(String::as_str),
            Some("integration-key")
        );
        fs::remove_dir_all(notes_dir).unwrap();
    }

    #[test]
    fn device_pairing_uses_validated_device_and_folder_patch_protocol() {
        let remote_device_id = "P56IOI7-MZJNU2Y-IQGDREY-DM2MGTI-MGL3BXN-PQ6W5BM-TBBZ4TJ-XZWICQ2";
        let pairing = PendingDevicePairing {
            device_id: remote_device_id.to_string(),
            device_name: "Laptop".to_string(),
            created_at: Instant::now(),
        };
        let (api_base, requests, server) = spawn_device_pairing_server(remote_device_id);

        let result = apply_device_pairing_at(&api_base, "pairing-key", &pairing).unwrap();
        server.join().unwrap();
        let captured = requests.lock().unwrap().clone();

        assert_eq!(result["paired"], true);
        assert_eq!(result["connectionState"], "waitingForRemote");
        assert_eq!(captured.len(), 8);
        assert_eq!(captured[4].method, "POST");
        assert_eq!(captured[4].path, "/rest/config/devices");
        assert_eq!(captured[5].method, "PATCH");
        assert_eq!(
            captured[5].path,
            format!("/rest/config/folders/{SIDECAR_FOLDER_ID}")
        );
        assert!(captured.iter().all(|request| {
            request.headers.get("x-api-key").map(String::as_str) == Some("pairing-key")
        }));
        let device_payload: serde_json::Value = serde_json::from_str(&captured[4].body).unwrap();
        assert_eq!(device_payload["deviceID"], remote_device_id);
        assert_eq!(device_payload["name"], "Laptop");
        let folder_patch: serde_json::Value = serde_json::from_str(&captured[5].body).unwrap();
        assert!(folder_patch["devices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|device| device["deviceID"].as_str() == Some(remote_device_id)));
    }
}
