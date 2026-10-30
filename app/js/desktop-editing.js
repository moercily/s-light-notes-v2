/* Shared desktop save queue and cross-window lifecycle. Used by main and sticky. */
(function () {
    let queue = Promise.resolve();
    let saving = false;
    let closing = false;
    let refreshing = false;
    let initialized = false;
    let nextFlush = null;
    const invoke = (command, args) => window.__TAURI__.core.invoke(command, args || {});
    const readOnly = () => AppState._showTrash || AppState._currentNoteReadOnly;
    const conflict = error => String(error).includes('NOTE_CONFLICT:');

    function report(error) {
        updateStatusBarText('save', String(error));
        if (conflict(error)) $('#conflict-dialog')?.classList.remove('hidden');
    }

    async function saveSnapshot() {
        if (readOnly()) return;
        if (AppState._composing) throw new Error('请完成中文输入后再保存或关闭。');
        const content = getEditorContent();
        const id = AppState.currentNoteId;
        if (!id && !content.trim()) { AppState.isDirty = false; return; }
        if (!AppState.isDirty) return;
        const session = AppState._editSession;
        saving = true;
        updateStatusBarText('save', '保存中…');
        try {
            const result = await desktopService.saveNote(id, generateNoteId(extractTitle(content)), content, AppState._version || null);
            if (session !== AppState._editSession) return result;
            AppState.currentNoteId = result.id;
            AppState._version = result.version;
            AppState._lastSavedTime = result.updatedAt;
            AppState.isDirty = getEditorContent() !== content;
            updateEditorToolbar({ title: extractTitle(content) });
            updateStatusBarText('save', AppState.isDirty ? '未保存…' : '已保存 ' + formatDate(result.updatedAt));
            await refreshNoteList();
            if (typeof syncScheduleScanAfterSave === 'function') syncScheduleScanAfterSave();
            return result;
        } catch (error) {
            report(error);
            throw error;
        } finally { saving = false; }
    }

    function save() {
        const task = queue.catch(() => {}).then(saveSnapshot);
        queue = task;
        return task;
    }

    async function refresh() {
        if (refreshing || saving || closing || !initialized) return;
        refreshing = true;
        const id = AppState.currentNoteId;
        const session = AppState._editSession;
        try {
            await refreshNoteList();
            if (!id) return;
            const note = await readNote(id);
            if (saving || closing || session !== AppState._editSession || id !== AppState.currentNoteId) return;
            if (!note) {
                AppState.isDirty = !readOnly();
                report('NOTE_CONFLICT: 笔记已删除或移动。当前内容仍保留，可另存副本。');
            } else if (note.version !== AppState._version) {
                if (AppState.isDirty) report('NOTE_CONFLICT: 笔记已在其他位置更新。请选择重新加载或另存副本。');
                else loadNoteToEditor(note);
            }
        } catch (error) { report('读取更新失败：' + error); }
        finally { refreshing = false; }
    }

    function unlock() {
        $('#note-editor').contentEditable = readOnly() ? 'false' : 'true';
        closing = false;
        nextFlush = null;
    }

    async function flush(event = {}) {
        if (closing) { if (event.payload?.token) nextFlush = event; return; }
        closing = true;
        const token = event.payload?.token || null;
        const editor = $('#note-editor');
        editor.contentEditable = 'false';
        try {
            if (!initialized) throw new Error('笔记尚未加载完成，请稍后关闭。');
            await save();
            if (AppState.isDirty && !readOnly()) throw new Error('仍有未保存内容，请处理后再关闭。');
            await invoke('desktop_close_ready', { success: true, token });
            // All windows remain frozen until the quit is committed or cancelled.
            if (nextFlush) {
                const pending = nextFlush;
                nextFlush = null;
                closing = false;
                await flush(pending);
            }
        } catch (error) {
            report(error);
            unlock();
            await invoke('desktop_close_ready', { success: false, token });
        }
    }

    function saveCopy() {
        if (closing) return Promise.reject(new Error('正在保存并关闭，请稍候。'));
        const task = queue.catch(() => {}).then(copySnapshot);
        queue = task;
        return task;
    }

    async function copySnapshot() {
        saving = true;
        const session = AppState._editSession;
        const content = getEditorContent();
        try {
            const result = await desktopService.saveNote(null, generateNoteId(extractTitle(content)), content);
            if (session !== AppState._editSession) return result;
            AppState.currentNoteId = result.id;
            AppState._showTrash = false;
            AppState._currentNoteReadOnly = false;
            AppState._version = result.version;
            AppState._lastSavedTime = result.updatedAt;
            AppState.isDirty = getEditorContent() !== content;
            $('#note-editor').contentEditable = closing ? 'false' : 'true';
            $('#conflict-dialog')?.classList.add('hidden');
            updateEditorToolbar({ title: extractTitle(content) });
            updateStatusBarText('save', '已另存副本');
            await refreshNoteList();
            return result;
        } finally { saving = false; }
    }

    async function reload() {
        if (saving || closing) return;
        const id = AppState.currentNoteId;
        const session = AppState._editSession;
        const content = getEditorContent();
        const note = await readNote(id);
        if (session !== AppState._editSession || id !== AppState.currentNoteId || content !== getEditorContent()) return;
        if (!note) throw new Error('原笔记已删除或移动，请另存副本。');
        loadNoteToEditor(note);
        $('#conflict-dialog')?.classList.add('hidden');
    }

    async function init() {
        // Also block shortcuts and toolbar actions while waiting for other windows.
        for (const type of ['keydown', 'beforeinput', 'paste', 'drop', 'click']) {
            window.addEventListener(type, event => {
                if (!closing) return;
                event.preventDefault();
                event.stopImmediatePropagation();
            }, true);
        }
        // Register before reading data: close requests must never bypass saving.
        const current = window.__TAURI__.webviewWindow.getCurrentWebviewWindow();
        await current.listen('desktop-flush', flush);
        await window.__TAURI__.event.listen('desktop-close-cancelled', unlock);
        await window.__TAURI__.event.listen('notes-changed', event => {
            if (event.payload.source !== current.label) refresh();
        });
        await window.__TAURI__.event.listen('sticky-error', event => report(event.payload));
        window.addEventListener('focus', refresh);
        // Includes edits arriving through Syncthing while the window remains focused.
        setInterval(() => { if (!document.hidden) refresh(); }, 2000);
    }

    window.DesktopEditing = { save, init, ready: () => { initialized = true; }, isClosing: () => closing, refresh, flush, saveCopy, reload, report, invoke };
})();
