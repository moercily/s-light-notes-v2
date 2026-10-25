use super::*;

// Paths come only from the native picker; webviews never receive arbitrary filesystem access.
#[tauri::command]
pub(super) async fn desktop_import_notes(app: AppHandle) -> Result<usize, String> {
    let files = rfd::AsyncFileDialog::new()
        .set_title("导入 Markdown（同名笔记保留为副本）")
        .add_filter("Markdown / 文本", &["md", "markdown", "txt"])
        .pick_files()
        .await;
    let Some(files) = files else {
        return Ok(0);
    };
    let paths: Vec<PathBuf> = files.iter().map(|file| file.path().to_path_buf()).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let writes = app.state::<NoteWrites>();
        let _guard = writes.0.lock().map_err(|_| "保存锁不可用")?;
        let directory = default_notes_dir(&app)?;
        let count = import_files(&directory, &paths)?;
        let _ = app.emit("notes-changed", serde_json::json!({"source": "import"}));
        Ok(count)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn desktop_export_notes(app: AppHandle) -> Result<usize, String> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("选择导出位置，将创建独立备份文件夹")
        .pick_folder()
        .await;
    let Some(folder) = folder else {
        return Ok(0);
    };
    tauri::async_runtime::spawn_blocking(move || {
        let writes = app.state::<NoteWrites>();
        let _guard = writes.0.lock().map_err(|_| "保存锁不可用")?;
        export_notes(&default_notes_dir(&app)?, folder.path()).map(|(_, count)| count)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) fn desktop_open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") && !url.starts_with("mailto:") {
        return Err("仅允许打开 HTTP、HTTPS 和邮件链接。".into());
    }
    if url.chars().any(|ch| ch.is_control()) {
        return Err("链接包含无效字符。".into());
    }
    opener::open(url).map_err(|error| format!("无法打开链接：{error}"))
}

fn import_files(directory: &Path, paths: &[PathBuf]) -> Result<usize, String> {
    if paths.len() > 2000 {
        return Err("一次最多导入 2000 个文件。".into());
    }
    // Validate every source before the first write. Never silently skip unreadable files.
    let mut sources = Vec::new();
    for path in paths {
        ensure_regular_note_file(path)?;
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !["md", "markdown", "txt"].contains(&extension.as_str()) {
            return Err("请选择 Markdown 或文本文件。".into());
        }
        if fs::metadata(path).map_err(|error| error.to_string())?.len() > 32 * 1024 * 1024 {
            return Err("单条笔记不能超过 32 MB。".into());
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("文件名无效")?;
        validate_note_id(name)?;
        let content = fs::read_to_string(path)
            .map_err(|error| format!("无法读取 UTF-8 笔记 {}：{error}", path.display()))?;
        // Imported conflict names become ordinary copies; the source file is unchanged.
        sources.push((name.replace(".sync-conflict-", "-conflict-copy-"), content));
    }
    let mut created = Vec::new();
    for (name, content) in &sources {
        match save_note_in_dir(directory, None, name, content) {
            Ok(saved) => created.push(saved.id),
            Err(error) => {
                let mut failed = Vec::new();
                for id in &created {
                    if let Err(failure) = fs::remove_file(note_path(directory, id)?) {
                        failed.push(failure.to_string());
                    }
                }
                return Err(format!(
                    "导入失败，已回退本次创建的笔记：{error}{}",
                    if failed.is_empty() {
                        String::new()
                    } else {
                        format!("；部分回退失败：{}", failed.join("；"))
                    }
                ));
            }
        }
    }
    Ok(created.len())
}

fn export_notes(directory: &Path, parent: &Path) -> Result<(PathBuf, usize), String> {
    let notes = list_notes_in_dir(directory, false)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let destination = parent.join(format!(
        "s-light-notes-backup-{timestamp}-{}",
        CONFIG_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&destination).map_err(|error| format!("无法创建备份目录：{error}"))?;
    let result = (|| {
        let mut files = Vec::new();
        for note in &notes {
            let path = note_path(&destination, &note.id)?;
            fs::write(&path, &note.content).map_err(|error| error.to_string())?;
            let copied = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            if content_version(&copied) != note.version {
                return Err("备份内容校验失败。".to_string());
            }
            files.push(
                serde_json::json!({"file": format!("{}.md", note.id), "sha256": note.version}),
            );
        }
        fs::write(destination.join("manifest.json"), serde_json::to_vec_pretty(&serde_json::json!({
            "format": "s-light-notes-markdown-backup", "version": 1, "files": files,
            "scope": "active notes and conflict copies; excludes trash, settings, and sync credentials"
        })).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        Ok((destination.clone(), notes.len()))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&destination);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_and_import_preserve_bytes_and_duplicate_names() {
        let root = temporary_root();
        let notes = root.join("notes");
        let saved =
            save_note_in_dir(&notes, None, "中文", "# 标题\n\n```rust\nlet x = 1;\n```\n").unwrap();
        let (backup, count) = export_notes(&notes, &root).unwrap();
        assert_eq!(count, 1);
        let file = backup.join("中文.md");
        assert_eq!(
            fs::read(&file).unwrap(),
            fs::read(notes.join("中文.md")).unwrap()
        );
        assert!(backup.join("manifest.json").is_file());
        assert_eq!(import_files(&notes, &[file]).unwrap(), 1);
        assert_eq!(
            read_note_in_dir(&notes, "中文-2", false)
                .unwrap()
                .unwrap()
                .version,
            saved.version
        );
        assert_eq!(list_notes_in_dir(&notes, false).unwrap().len(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn bad_import_is_rejected_before_any_write() {
        let root = temporary_root();
        fs::write(root.join("good.md"), "good").unwrap();
        fs::write(root.join("bad.md"), [0xff, 0xfe]).unwrap();
        let notes = root.join("notes");
        assert!(import_files(&notes, &[root.join("good.md"), root.join("bad.md")]).is_err());
        assert!(!notes.exists());
        fs::remove_dir_all(root).unwrap();
    }
    fn temporary_root() -> PathBuf {
        let root = env::temp_dir().join(format!(
            "slight-transfer-{}-{}",
            std::process::id(),
            CONFIG_TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        root
    }
}
