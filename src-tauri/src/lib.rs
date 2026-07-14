use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const DEFAULT_SYNCTHING_URL: &str = "http://127.0.0.1:8384";
const CONFIG_CONFIRMATION_TTL: Duration = Duration::from_secs(300);
static CONFIG_TOKEN_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct SyncthingProcess {
    child: Mutex<Option<Child>>,
}

#[derive(Default)]
struct PendingFolderConfigs {
    items: Mutex<HashMap<String, PendingFolderConfig>>,
}

#[derive(Debug, Clone)]
struct PendingFolderConfig {
    folder_id: String,
    path: String,
    device_ids: Vec<String>,
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
    api_base: String,
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

#[tauri::command]
fn syncthing_status() -> SyncthingStatus {
    match syncthing_health() {
        Ok(message) => SyncthingStatus {
            available: true,
            running: true,
            managed: false,
            api_base: DEFAULT_SYNCTHING_URL.to_string(),
            message,
        },
        Err(err) => SyncthingStatus {
            available: false,
            running: false,
            managed: false,
            api_base: DEFAULT_SYNCTHING_URL.to_string(),
            message: err,
        },
    }
}

#[tauri::command]
fn syncthing_start(state: State<'_, SyncthingProcess>) -> Result<SyncthingStatus, String> {
    if syncthing_health().is_ok() {
        return Ok(syncthing_status());
    }

    let executable = env::var("SLIGHT_SYNCTHING_BIN").unwrap_or_else(|_| "syncthing".to_string());
    let child = Command::new(executable)
        .arg("--no-browser")
        .spawn()
        .map_err(|err| {
            format!("无法启动 Syncthing。请先安装 Syncthing 或设置 SLIGHT_SYNCTHING_BIN：{err}")
        })?;

    let mut guard = state
        .child
        .lock()
        .map_err(|_| "无法记录 Syncthing 进程状态。".to_string())?;
    *guard = Some(child);

    std::thread::sleep(Duration::from_millis(800));
    Ok(syncthing_status())
}

#[tauri::command]
fn syncthing_stop(state: State<'_, SyncthingProcess>) -> Result<SyncthingStatus, String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "无法读取 Syncthing 进程状态。".to_string())?;

    if let Some(mut child) = guard.take() {
        child
            .kill()
            .map_err(|err| format!("无法停止由 s-light notes 启动的 Syncthing：{err}"))?;
    }

    Ok(syncthing_status())
}

#[tauri::command]
fn syncthing_proxy_request(request: ProxyRequest) -> Result<ProxyResponse, String> {
    let method = request.method.to_uppercase();
    if method != "GET" && method != "POST" {
        return Err("暂不支持该 Syncthing 请求方法。".to_string());
    }
    execute_syncthing_request(
        &method,
        &request.path,
        request.body.as_deref(),
        request.api_key.as_deref(),
    )
}

fn execute_syncthing_request(
    method: &str,
    path: &str,
    body: Option<&str>,
    api_key: Option<&str>,
) -> Result<ProxyResponse, String> {
    let url = build_syncthing_url(path)?;
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
    request: ConfirmFolderConfigRequest,
    pending: State<'_, PendingFolderConfigs>,
) -> Result<serde_json::Value, String> {
    let api_key = validate_api_key(Some(&request.api_key))?
        .ok_or_else(|| "确认写入前需要有效的 Syncthing API Key。".to_string())?;
    let config = take_pending_folder_config(&pending, &request.confirmation_token)?;
    apply_new_folder_config(&config, api_key)
}

#[tauri::command]
fn open_notes_folder(app: AppHandle) -> Result<(), String> {
    let notes_dir = default_notes_dir(&app)?;
    ensure_directory(&notes_dir)?;
    opener::open(notes_dir).map_err(|err| format!("无法打开笔记目录：{err}"))
}

#[tauri::command]
fn open_syncthing_web() -> Result<(), String> {
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

fn request_syncthing_json(
    method: &str,
    path: &str,
    body: Option<&str>,
    api_key: &str,
    operation: &str,
) -> Result<serde_json::Value, String> {
    let response = execute_syncthing_request(method, path, body, Some(api_key))?;
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

fn apply_new_folder_config(
    config: &PendingFolderConfig,
    api_key: &str,
) -> Result<serde_json::Value, String> {
    let expected_path = canonical_existing_path(Path::new(&config.path))?;
    let folders = request_syncthing_json(
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

    let template = request_syncthing_json(
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
        execute_syncthing_request(
            "POST",
            "/rest/config/folders",
            Some(&payload_text),
            Some(api_key),
        )?,
        "写入 Syncthing folder 配置",
    )?;

    let verification = request_syncthing_json(
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
        let rollback = execute_syncthing_request("DELETE", &rollback_path, None, Some(api_key))
            .and_then(|response| ensure_syncthing_success(response, "撤销 Syncthing folder 配置"));
        return Err(match rollback {
            Ok(_) => "写入后未能验证配置，已撤销本次新建，请重新尝试。".to_string(),
            Err(err) => {
                format!("写入后未能验证配置，自动撤销也失败：{err} 请打开 Syncthing 检查。")
            }
        });
    }

    let restart_required = request_syncthing_json(
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

fn syncthing_health() -> Result<String, String> {
    let url = format!("{DEFAULT_SYNCTHING_URL}/rest/noauth/health");
    let response = ureq::get(&url)
        .timeout(Duration::from_secs(3))
        .call()
        .map_err(|err| format!("Syncthing 未运行或无法访问：{err}"))?;
    response.into_string().map_err(|err| err.to_string())
}

fn build_syncthing_url(path: &str) -> Result<String, String> {
    if !path.starts_with('/') {
        return Err("Syncthing API path 必须以 / 开头。".to_string());
    }
    if path.contains("://") || path.contains("..") {
        return Err("Syncthing API path 不安全。".to_string());
    }
    Ok(format!("{DEFAULT_SYNCTHING_URL}{path}"))
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SyncthingProcess::default())
        .manage(PendingFolderConfigs::default())
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
            open_notes_folder,
            open_syncthing_web
        ])
        .run(tauri::generate_context!())
        .expect("error while running s-light notes");
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
