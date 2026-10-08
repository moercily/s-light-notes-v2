use super::*;
use std::collections::HashSet;
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Placement {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    pinned: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct Settings {
    shortcut: String,
    placements: HashMap<String, Placement>,
    #[serde(skip)]
    error: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: String::new(),
            placements: HashMap::new(),
            error: None,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Context {
    id: Option<String>,
    in_trash: bool,
    pinned: bool,
    dirty: bool,
}

#[derive(Default)]
pub(super) struct StickyState {
    windows: Mutex<HashMap<String, Context>>,
    settings: Mutex<Settings>,
    quit_pending: Mutex<Option<QuitRequest>>,
    recording: Mutex<Option<u64>>,
    exit_ready: std::sync::atomic::AtomicBool,
}

struct QuitRequest {
    token: u64,
    labels: HashSet<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("sticky-settings.json"))
}

fn persist(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    ensure_directory(path.parent().ok_or("设置路径无效")?)?;
    let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    let temporary = path.with_file_name(format!(
        ".sticky-settings-{}.tmp",
        CONFIG_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = fs::write(&temporary, bytes).and_then(|_| fs::rename(&temporary, &path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|e| format!("无法保存便签设置：{e}"))
}

fn register_shortcut(app: &AppHandle, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    let shortcut = parse_shortcut(value)?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                let app = app.clone();
                let dispatcher = app.clone();
                let _ = dispatcher.run_on_main_thread(move || {
                    if let Err(error) = open(&app, None, false) {
                        let _ = app.emit("sticky-error", error);
                    }
                });
            }
        })
        .map_err(|e| format!("快捷键无法注册，可能已被占用：{e}"))
}

fn parse_shortcut(value: &str) -> Result<Shortcut, String> {
    let shortcut: Shortcut = value.parse().map_err(|e| format!("快捷键格式无效：{e}"))?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::SUPER | Modifiers::ALT)
    {
        return Err("快捷键必须包含 Control、Command 或 Alt 修饰键。".into());
    }
    Ok(shortcut)
}

pub(super) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.handle()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
    let mut settings = match settings_path(app.handle()).ok().filter(|p| p.exists()) {
        Some(path) => match fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
        {
            Some(value) => value,
            None => Settings {
                error: Some("便签设置损坏，已使用默认值。".into()),
                ..Settings::default()
            },
        },
        None => Settings::default(),
    };
    if let Err(error) = register_shortcut(app.handle(), &settings.shortcut) {
        settings.error = Some(error);
    }
    *app.state::<StickyState>().settings.lock().unwrap() = settings;
    Ok(())
}

fn focus(window: &WebviewWindow) -> Result<(), String> {
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

fn open(app: &AppHandle, id: Option<String>, in_trash: bool) -> Result<(), String> {
    let state = app.state::<StickyState>();
    if state.quit_pending.lock().unwrap().is_some() {
        return Err("正在保存并退出，请稍候。".into());
    }
    if let Some(ref id) = id {
        read_note_in_dir(&default_notes_dir(app)?, id, in_trash)?.ok_or("笔记不存在")?;
    }
    let existing = state
        .windows
        .lock()
        .unwrap()
        .iter()
        .find(|(_, ctx)| ctx.id == id && ctx.in_trash == in_trash && (id.is_some() || !ctx.dirty))
        .map(|(label, _)| label.clone());
    if let Some(window) = existing.and_then(|label| app.get_webview_window(&label)) {
        return focus(&window);
    }
    let label = format!(
        "sticky-{}",
        CONFIG_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let placement = id
        .as_ref()
        .and_then(|id| state.settings.lock().unwrap().placements.get(id).cloned());
    let pinned = placement.as_ref().is_some_and(|p| p.pinned);
    let context = Context {
        id,
        in_trash,
        pinned,
        dirty: false,
    };
    state.windows.lock().unwrap().insert(label.clone(), context);
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("sticky.html".into()))
        .title("便签 · s-light notes")
        .decorations(false)
        .resizable(true)
        .inner_size(360.0, 420.0)
        .min_inner_size(280.0, 240.0)
        .always_on_top(pinned)
        .visible(false);
    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            state.windows.lock().unwrap().remove(&label);
            return Err(error.to_string());
        }
    };
    if let Some(p) = placement {
        if p.width.is_finite() && p.height.is_finite() {
            let _ = window.set_size(tauri::LogicalSize::new(
                p.width.clamp(280.0, 1000.0),
                p.height.clamp(240.0, 1200.0),
            ));
        }
        let visible = window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .any(|monitor| {
                let area = monitor.work_area();
                p.x >= area.position.x
                    && p.y >= area.position.y
                    && i64::from(p.x) + 280
                        <= i64::from(area.position.x) + i64::from(area.size.width)
                    && i64::from(p.y) + 100
                        <= i64::from(area.position.y) + i64::from(area.size.height)
            });
        if visible {
            let _ = window.set_position(tauri::PhysicalPosition::new(p.x, p.y));
        } else {
            let _ = window.center();
        }
    } else {
        let _ = window.center();
    }
    focus(&window)
}

#[tauri::command]
pub(super) async fn sticky_open(
    app: AppHandle,
    id: Option<String>,
    in_trash: bool,
) -> Result<(), String> {
    // Window creation is dispatched to the UI thread on every platform.
    let (sender, receiver) = std::sync::mpsc::channel();
    let target = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(open(&target, id, in_trash));
    })
    .map_err(|e| e.to_string())?;
    receiver.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub(super) fn sticky_context(window: WebviewWindow) -> Result<Context, String> {
    window
        .state::<StickyState>()
        .windows
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
        .ok_or("不是便签窗口".into())
}

pub(super) fn bind_saved_note(window: &WebviewWindow, id: &str) {
    if let Some(context) = window
        .state::<StickyState>()
        .windows
        .lock()
        .unwrap()
        .get_mut(window.label())
    {
        context.id = Some(id.into());
        context.in_trash = false;
    }
}

#[tauri::command]
pub(super) fn sticky_dirty(window: WebviewWindow, dirty: bool) {
    if let Some(context) = window
        .state::<StickyState>()
        .windows
        .lock()
        .unwrap()
        .get_mut(window.label())
    {
        context.dirty = dirty;
    }
}

fn remember(window: &WebviewWindow) -> Result<(), String> {
    let state = window.state::<StickyState>();
    let context = state.windows.lock().unwrap().get(window.label()).cloned();
    if let Some(Context {
        id: Some(id),
        pinned,
        ..
    }) = context
    {
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let size = window
            .inner_size()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
        let mut settings = state.settings.lock().unwrap();
        settings.placements.insert(
            id,
            Placement {
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                pinned,
            },
        );
        persist(window.app_handle(), &settings)?;
    }
    Ok(())
}

#[tauri::command]
pub(super) fn sticky_pin(window: WebviewWindow, pinned: bool) -> Result<(), String> {
    if !window
        .state::<StickyState>()
        .windows
        .lock()
        .unwrap()
        .contains_key(window.label())
    {
        return Err("不是便签窗口".into());
    }
    window
        .set_always_on_top(pinned)
        .map_err(|e| e.to_string())?;
    window
        .state::<StickyState>()
        .windows
        .lock()
        .unwrap()
        .get_mut(window.label())
        .unwrap()
        .pinned = pinned;
    remember(&window)
}

#[tauri::command]
pub(super) async fn sticky_main(app: AppHandle) -> Result<(), String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let target = app.clone();
    app.run_on_main_thread(move || {
        let result = show_main(&target);
        let _ = sender.send(result);
    })
    .map_err(|e| e.to_string())?;
    receiver.recv().map_err(|e| e.to_string())?
}

pub(super) fn show_main(target: &AppHandle) -> Result<(), String> {
    let window = match target.get_webview_window("main") {
        Some(window) => window,
        None => WebviewWindowBuilder::new(target, "main", WebviewUrl::App("index.html".into()))
            .title("s-light notes")
            .inner_size(1180.0, 820.0)
            .min_inner_size(920.0, 620.0)
            .build()
            .map_err(|e| e.to_string())?,
    };
    focus(&window)
}

#[tauri::command]
pub(super) fn sticky_settings(app: AppHandle) -> Settings {
    app.state::<StickyState>().settings.lock().unwrap().clone()
}

#[tauri::command]
pub(super) fn sticky_set_shortcut(
    app: AppHandle,
    shortcut: String,
    recording_token: Option<u64>,
) -> Result<Settings, String> {
    if shortcut.len() > 100 || (!shortcut.is_empty() && !shortcut.contains('+')) {
        return Err("请使用带修饰键的快捷键，例如 Control+Alt+N".into());
    }
    let state = app.state::<StickyState>();
    let mut recording = state.recording.lock().unwrap();
    if recording_token != *recording {
        return Err("录制已结束，请重新点击录制。".into());
    }
    let mut settings = state.settings.lock().unwrap();
    let next_parsed = if shortcut.is_empty() {
        None
    } else {
        Some(parse_shortcut(&shortcut)?)
    };
    let same_shortcut = next_parsed == parse_shortcut(&settings.shortcut).ok();
    if same_shortcut && settings.error.is_none() && recording.is_none() {
        return Ok(settings.clone());
    }
    register_shortcut(&app, &shortcut)?;
    let mut next = settings.clone();
    next.shortcut = shortcut.clone();
    next.error = None;
    if let Err(error) = persist(&app, &next) {
        if !shortcut.is_empty() {
            let _ = app.global_shortcut().unregister(shortcut.as_str());
        }
        return Err(error);
    }
    if !same_shortcut && !settings.shortcut.is_empty() && recording.is_none() {
        if let Err(error) = app.global_shortcut().unregister(settings.shortcut.as_str()) {
            if !shortcut.is_empty() {
                let _ = app.global_shortcut().unregister(shortcut.as_str());
            }
            persist(&app, &settings)?;
            return Err(format!("无法移除原快捷键：{error}"));
        }
    }
    *settings = next;
    *recording = None;
    Ok(settings.clone())
}

#[tauri::command]
pub(super) fn sticky_begin_recording(app: AppHandle) -> Result<u64, String> {
    let state = app.state::<StickyState>();
    let mut recording = state.recording.lock().unwrap();
    if let Some(token) = *recording {
        return Ok(token);
    }
    let settings = state.settings.lock().unwrap();
    if !settings.shortcut.is_empty()
        && app
            .global_shortcut()
            .is_registered(settings.shortcut.as_str())
    {
        app.global_shortcut()
            .unregister(settings.shortcut.as_str())
            .map_err(|e| e.to_string())?;
    }
    let token = CONFIG_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);
    *recording = Some(token);
    // Restore the old binding even if the settings webview stops responding.
    let target = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(120));
        let dispatcher = target.clone();
        let _ = dispatcher.run_on_main_thread(move || {
            if end_recording(&target, Some(token)).unwrap_or(false) {
                let _ = target.emit("sticky-recording-cancelled", ());
            }
        });
    });
    Ok(token)
}

fn end_recording(app: &AppHandle, token: Option<u64>) -> Result<bool, String> {
    let state = app.state::<StickyState>();
    let mut recording = state.recording.lock().unwrap();
    if recording.is_none() || (token.is_some() && token != *recording) {
        return Ok(false);
    }
    let mut settings = state.settings.lock().unwrap();
    if let Err(error) = register_shortcut(app, &settings.shortcut) {
        settings.error = Some(error.clone());
        *recording = None;
        let _ = app.emit("sticky-error", error.clone());
        return Err(error);
    }
    *recording = None;
    Ok(true)
}

#[tauri::command]
pub(super) fn sticky_end_recording(app: AppHandle, recording_token: u64) -> Result<(), String> {
    end_recording(&app, Some(recording_token)).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shortcut_aliases_are_equal_and_plain_typing_is_rejected() {
        assert_eq!(
            parse_shortcut("Control+Alt+N").unwrap(),
            parse_shortcut("Ctrl+Alt+KeyN").unwrap()
        );
        assert!(parse_shortcut("Shift+A").is_err());
        assert!(parse_shortcut("A").is_err());
        assert!(parse_shortcut("Control+garbage").is_err());
    }

    #[test]
    fn new_settings_have_no_shortcut_and_existing_bindings_are_preserved() {
        assert!(Settings::default().shortcut.is_empty());
        let previous: Settings = serde_json::from_str(r#"{"shortcut":"Command+Alt+N"}"#).unwrap();
        assert_eq!(previous.shortcut, "Command+Alt+N");
        let cleared: Settings = serde_json::from_str(r#"{"shortcut":""}"#).unwrap();
        assert!(cleared.shortcut.is_empty());
    }
}

pub(super) fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            if window.label() == "main" {
                let _ = end_recording(window.app_handle(), None);
            }
            api.prevent_close();
            let token = window
                .state::<StickyState>()
                .quit_pending
                .lock()
                .unwrap()
                .as_ref()
                .map(|q| q.token);
            let _ = window.emit_to(
                window.label(),
                "desktop-flush",
                serde_json::json!({"token": token}),
            );
        }
        tauri::WindowEvent::Destroyed => {
            window
                .state::<StickyState>()
                .windows
                .lock()
                .unwrap()
                .remove(window.label());
            let state = window.state::<StickyState>();
            let mut pending = state.quit_pending.lock().unwrap();
            if let Some(request) = pending.as_mut() {
                request.labels.remove(window.label());
                if request.labels.is_empty() {
                    state.exit_ready.store(true, Ordering::SeqCst);
                    window.app_handle().exit(0);
                }
            }
        }
        _ => {}
    }
}

pub(super) fn request_exit(app: &AppHandle) -> bool {
    let _ = end_recording(app, None);
    let state = app.state::<StickyState>();
    if state.exit_ready.load(Ordering::SeqCst) || app.webview_windows().is_empty() {
        return false;
    }
    let mut pending = state.quit_pending.lock().unwrap();
    if pending.is_none() {
        let windows = app.webview_windows();
        let token = CONFIG_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);
        *pending = Some(QuitRequest {
            token,
            labels: windows.keys().cloned().collect(),
        });
        for window in windows.values() {
            let _ = window.emit_to(
                window.label(),
                "desktop-flush",
                serde_json::json!({"token": token}),
            );
        }
    }
    true
}

#[tauri::command]
pub(super) fn desktop_close_ready(
    window: WebviewWindow,
    success: bool,
    token: Option<u64>,
) -> Result<(), String> {
    let state = window.state::<StickyState>();
    let mut pending = state.quit_pending.lock().unwrap();
    // Ignore late acknowledgements from a cancelled quit attempt.
    if token.is_some() && pending.as_ref().map(|q| q.token) != token {
        return Ok(());
    }
    if !success {
        *pending = None;
        let _ = window.app_handle().emit("desktop-close-cancelled", ());
        return Ok(());
    }
    if let Err(error) = remember(&window) {
        *pending = None;
        let _ = window.app_handle().emit("desktop-close-cancelled", ());
        return Err(error);
    }
    if let Some(request) = pending.as_mut() {
        if token.is_none() {
            return Ok(());
        }
        request.labels.remove(window.label());
        if request.labels.is_empty() {
            state.exit_ready.store(true, Ordering::SeqCst);
            window.app_handle().exit(0);
        }
        return Ok(());
    }
    drop(pending);
    window.destroy().map_err(|e| e.to_string())
}
