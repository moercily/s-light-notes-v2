async function openNoteAsSticky(id, inTrash = false) {
    try {
        if (AppState.isDirty) {
            await saveCurrentNote();
            if (AppState.isDirty) return;
        }
        await DesktopEditing.invoke('sticky_open', { id: id || null, inTrash });
    } catch (error) { DesktopEditing.report(error); }
}

async function initDesktopStickyUI() {
    const create = document.createElement('button');
    create.textContent = '＋ 便签';
    create.id = 'btn-new-sticky';
    create.onclick = () => openNoteAsSticky(null);
    $('#sidebar-footer').prepend(create);

    const open = document.createElement('button');
    open.textContent = '在便签中打开';
    open.id = 'btn-open-sticky';
    open.onclick = async () => {
        try {
            if (AppState.isDirty) await saveCurrentNote();
            if (!AppState.isDirty) await openNoteAsSticky(AppState.currentNoteId, AppState._showTrash);
        } catch (error) { DesktopEditing.report(error); }
    };
    $('#view-toolbar').insertBefore(open, $('#btn-delete-note'));
    $('#conflict-overwrite').textContent = '另存为新笔记';

    try {
        const value = await DesktopEditing.invoke('sticky_settings');
        updateStickyShortcutHint(value.shortcut);
        if (value.error) DesktopEditing.report(value.error);
    } catch (error) { DesktopEditing.report(error); }
}

function updateStickyShortcutHint(shortcut) {
    const button = $('#btn-new-sticky');
    if (button) button.title = shortcut
        ? '新建便签（' + (window.ShortcutRecorder?.display(shortcut) || shortcut) + '）'
        : '新建便签（未设置快捷键）';
}
