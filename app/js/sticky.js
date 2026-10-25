const AppState = {
    currentNoteId: null, storageMode: 'desktop', isDirty: false,
    _showTrash: false, _currentNoteReadOnly: false, _version: null, _editSession: 0,
};
let pinned = false;
function updateEditorToolbar(note) { $('#note-title-display').textContent = note?.title || '新便签'; }
function updateStatusBarText(id, text) { const node = $('#status-' + id); if (node) node.textContent = text; }
async function refreshNoteList() {
    $('#sticky-readonly').hidden = !AppState._showTrash && !AppState._currentNoteReadOnly;
    await DesktopEditing.invoke('sticky_dirty', { dirty: AppState.isDirty });
}
function applyStickyTheme() {
    const theme = localStorage.getItem('s-light-theme');
    if (theme) document.documentElement.dataset.theme = theme;
    else document.documentElement.removeAttribute('data-theme');
}
function action(fn) { return async () => { try { await fn(); } catch (error) { DesktopEditing.report(error); } }; }
async function initSticky() {
    $('#sticky-close').onclick = () => DesktopEditing.flush();
    applyStickyTheme();
    window.addEventListener('storage', applyStickyTheme);
    await DesktopEditing.init();
    const context = await DesktopEditing.invoke('sticky_context');
    AppState.currentNoteId = context.id;
    AppState._showTrash = context.inTrash;
    pinned = context.pinned;
    updatePin();
    $('#sticky-pin').onclick = action(async () => {
        await DesktopEditing.invoke('sticky_pin', { pinned: !pinned });
        pinned = !pinned;
        updatePin();
    });
    $('#sticky-new').onclick = action(async () => {
        await saveCurrentNote();
        if (!AppState.isDirty) await DesktopEditing.invoke('sticky_open', { id: null, inTrash: false });
    });
    $('#sticky-main').onclick = action(() => DesktopEditing.invoke('sticky_main'));
    $('#sticky-save').onclick = action(() => saveCurrentNote());
    $('#sticky-copy').onclick = action(() => DesktopEditing.saveCopy());
    $('#conflict-copy').onclick = action(() => DesktopEditing.saveCopy());
    $('#conflict-reload').onclick = action(() => DesktopEditing.reload());
    $('#conflict-cancel').onclick = () => $('#conflict-dialog').classList.add('hidden');
    $('#note-title-display').onmousedown = event => {
        if (event.button === 0) window.__TAURI__.window.getCurrentWindow().startDragging().catch(DesktopEditing.report);
    };
    if (context.id) {
        const note = await readNote(context.id);
        if (!note) throw new Error('笔记已不存在。');
        AppState._currentNoteReadOnly = note.isConflict;
        loadNoteToEditor(note);
    } else updateStatusBarText('save', '自动保存');
    $('#note-editor').contentEditable = (AppState._showTrash || AppState._currentNoteReadOnly) ? 'false' : 'true';
    $('#note-editor').addEventListener('input', () => {
        onEditorInput();
        DesktopEditing.invoke('sticky_dirty', { dirty: AppState.isDirty }).catch(DesktopEditing.report);
    });
    initFormatToolbar();
    document.addEventListener('keydown', event => {
        if (event.isComposing || AppState._composing || event.keyCode === 229) return;
        if (!(event.ctrlKey || event.metaKey)) return;
        const key = event.key.toLowerCase();
        if (key === 's') { event.preventDefault(); action(() => saveCurrentNote())(); }
        if (key === 'w') { event.preventDefault(); DesktopEditing.flush(); }
        if (AppState._showTrash || AppState._currentNoteReadOnly) return;
        if (key === 'z') { event.preventDefault(); (event.shiftKey ? redo : undo)($('#note-editor')); }
        if (key === 'y') { event.preventDefault(); redo($('#note-editor')); }
    });
    await refreshNoteList();
    DesktopEditing.ready();
    $('#note-editor').focus();
}
function updatePin() {
    $('#sticky-pin').setAttribute('aria-pressed', String(pinned));
    $('#sticky-pin').title = pinned ? '取消置顶' : '置顶';
    $('#sticky-pin').setAttribute('aria-label', pinned ? '取消置顶' : '置顶');
}
initSticky().catch(error => {
    DesktopEditing.report(error);
    // A failed initial read must still allow this unedited window to close.
    DesktopEditing.ready();
});
