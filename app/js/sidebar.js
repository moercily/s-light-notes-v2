/* ============================================
   s-light notes — 侧边栏模块
   负责：笔记列表渲染、搜索、新建/删除、文件夹操作
   ============================================ */

// ========== 笔记列表渲染 ==========

/**
 * 渲染笔记列表
 * @param {Array} notes - 笔记数组
 * @param {string} [highlightId] - 高亮选中的笔记 ID
 */
function renderNoteList(notes, highlightId) {
    const listEl = $('#note-list');
    if (!listEl) return;
    const currentId = highlightId || AppState.currentNoteId;
    const renderKey = JSON.stringify([AppState._showTrash, currentId, (notes || []).map(note =>
        [note.id, note.title, note.updatedAt, note.version, note.isConflict, formatDate(note.updatedAt)])]);
    if (listEl.dataset.renderKey === renderKey) return;
    listEl.dataset.renderKey = renderKey;

    // 清空列表
    listEl.innerHTML = '';

    if (!notes || notes.length === 0) {
        listEl.innerHTML = '<li class="note-list-empty">' +
            (AppState._showTrash ? '回收站为空' : '暂无笔记') +
            '</li>';
        return;
    }

    notes.forEach(note => {
        const li = createNoteItem(note, note.id === currentId);
        li.addEventListener('click', (e) => {
            // 如果点击的是删除按钮，不触发选择
            if (e.target.closest('.note-item-delete')) return;
            onNoteSelected(note.id);
        });
        listEl.appendChild(li);
    });
}

/**
 * 创建单个笔记列表项
 * @param {Object} note
 * @param {boolean} isActive - 是否为当前选中笔记
 * @returns {HTMLElement}
 */
function createNoteItem(note, isActive) {
    const li = document.createElement('li');
    li.className = 'note-item' + (isActive ? ' active' : '');
    li.dataset.noteId = note.id;
    if (AppState.storageMode === 'desktop' && typeof openNoteAsSticky === 'function') {
        const menu = document.createElement('button');
        menu.textContent = '↗';
        menu.className = 'note-item-sticky';
        menu.title = '在便签中打开';
        menu.setAttribute('aria-label', '在便签中打开 ' + (note.title || '未命名'));
        menu.onclick = event => {
            event.stopPropagation();
            openNoteAsSticky(note.id, AppState._showTrash);
        };
        li.append(menu);
    }

    const content = document.createElement('div');
    content.className = 'note-item-content';

    const title = document.createElement('div');
    title.className = 'note-item-title';
    title.textContent = note.title || '未命名';

    if (note.isConflict) {
        const badge = document.createElement('span');
        badge.className = 'note-conflict-badge';
        badge.textContent = '冲突';
        title.appendChild(badge);
    }

    const time = document.createElement('div');
    time.className = 'note-item-time';
    time.textContent = formatDate(note.updatedAt);

    content.appendChild(title);
    content.appendChild(time);

    if (AppState._showTrash) {
        // 回收站模式：显示标题+时间 + 恢复和永久删除按钮
        li.appendChild(content);

        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'note-item-delete';
        restoreBtn.textContent = '↩';
        restoreBtn.title = '恢复笔记';
        restoreBtn.style.color = 'var(--accent)';
        restoreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onRestoreNote(note.id);
        });
        li.appendChild(restoreBtn);

        const permDeleteBtn = document.createElement('button');
        permDeleteBtn.className = 'note-item-delete';
        permDeleteBtn.textContent = '×';
        permDeleteBtn.title = '永久删除';
        permDeleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onDeleteRequested(note.id);
        });
        li.appendChild(permDeleteBtn);
        return li;
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'note-item-delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = '删除笔记';
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onDeleteRequested(note.id);
    });

    li.appendChild(content);
    li.appendChild(deleteBtn);
    return li;
}

let noteNavigation = 0;
let listRefresh = 0;

// ========== 笔记选择 ==========

/**
 * 笔记被选中时的处理
 * @param {string} id
 */
async function onNoteSelected(id) {
    const navigation = ++noteNavigation;
    if (id === AppState.currentNoteId) return;

    // 如果当前有未保存内容，先保存（新建笔记也会在这里创建）
    if (AppState.isDirty && !AppState._showTrash) {
        await saveCurrentNote();
        if (AppState.isDirty) return;
    }

    // 加载新笔记（回收站模式也从正常路径读取）
    const note = await readNote(id);
    if (navigation !== noteNavigation || AppState.isDirty) return;
    if (!note) {
        // 笔记可能已被删除
        await refreshNoteList();
        return;
    }

    AppState.currentNoteId = id;
    AppState.isDirty = false;
    AppState._currentNoteReadOnly = !!note.isConflict;

    // 回收站和 Syncthing 冲突副本：只读
    if (AppState._showTrash) {
        note._readOnly = true;
    } else if (note.isConflict) {
        note._readOnly = true;
    }

    loadNoteToEditor(note);
    highlightActiveNote(id);
    updateTrashModeUI();
}

// ========== 新建笔记 ==========

/**
 * 新建笔记
 */
async function onNewNote() {
    const navigation = ++noteNavigation;
    // 如有未保存内容，先保存
    if (AppState.isDirty && !AppState._showTrash) {
        await saveCurrentNote();
        if (AppState.isDirty) return;
    }

    if (navigation !== noteNavigation) return;
    // 清空编辑器
    clearEditor();
    AppState.currentNoteId = null;
    AppState.isDirty = false;
    AppState._currentNoteReadOnly = false;
    AppState._showConflictsOnly = false;
    updateTrashModeUI();

    // 聚焦编辑器
    const editor = $('#note-editor');
    if (editor) editor.focus();

    // 更新侧边栏高亮
    highlightActiveNote(null);
    updateEditorToolbar(null);

    // 更新状态栏
    updateStatusBarText('save', '新建笔记中...');
    updateStatusBarText('stats', '字数：0');
    updateStatusBarText('time', '');
}

// ========== 删除笔记 ==========

/**
 * 请求删除笔记（弹出确认对话框）
 * @param {string} id
 */
function onDeleteRequested(id) {
    AppState._pendingDeleteId = id;
    if (AppState._showTrash) {
        $('#confirm-message').textContent = '确定要永久删除这条笔记吗？此操作不可撤销！';
        $('#confirm-yes').textContent = '永久删除';
    } else {
        $('#confirm-message').textContent = '确定要删除这条笔记吗？笔记将移入回收站。';
        $('#confirm-yes').textContent = '删除';
    }
    $('#confirm-dialog').classList.remove('hidden');
}

/**
 * 确认删除
 */
async function onDeleteConfirmed() {
    const id = AppState._pendingDeleteId;
    if (!id) return;

    $('#confirm-dialog').classList.add('hidden');

    try {
        if (AppState._showTrash) {
            await permanentlyDelete(id);
        } else {
            await deleteNote(id);
        }
        // 如果删除的是当前笔记，清空编辑器
        if (id === AppState.currentNoteId) {
            AppState.currentNoteId = null;
            AppState.isDirty = false;
            AppState._currentNoteReadOnly = false;
            clearEditor();
            updateEditorToolbar(null);
        }
        await refreshNoteList();
    } catch (err) {
        console.error('删除笔记失败:', err);
        alert('删除笔记失败：' + err.message);
    }

    AppState._pendingDeleteId = null;
}

/**
 * 恢复笔记（从回收站）
 */
async function onRestoreNote(id) {
    try {
        await restoreNote(id);
        await refreshNoteList();
        updateStatusBarText('save', '笔记已恢复');
    } catch (err) {
        console.error('恢复笔记失败:', err);
        alert('恢复笔记失败：' + err.message);
    }
}

/**
 * 取消删除
 */
function onDeleteCancelled() {
    AppState._pendingDeleteId = null;
    $('#confirm-dialog').classList.add('hidden');
}

// ========== 搜索 ==========

/**
 * 搜索输入处理（防抖 300ms）
 */
const handleSearch = debounce(async (query) => {
    AppState.searchQuery = query;
    AppState._showConflictsOnly = false;
    const notes = await searchNotes(query);
    if (query !== AppState.searchQuery) return;
    renderNoteList(notes, AppState.currentNoteId);
}, 300);

// ========== 文件夹操作 ==========

/**
 * 打开文件夹
 */
async function onOpenFolder() {
    try {
        if (AppState.storageMode === 'desktop') {
            await window.desktopService.openNotesFolder();
            return;
        }

        const handle = await fsaOpenFolder();
        if (!handle) return; // 用户取消

        AppState.folderHandle = handle;
        AppState.storageMode = 'fsa';
        AppState._showConflictsOnly = false;
        updateStorageUI();

        // 加载笔记列表
        await refreshNoteList();

        // 更新状态栏
        updateStatusBarText('storage', '存储：' + handle.name);

    } catch (err) {
        console.error('打开文件夹失败:', err);
        alert('打开文件夹失败：' + err.message);
    }
}

// ========== 导出/导入（IDB 模式） ==========

async function onExportAll() {
    try {
        if (AppState.isDirty) { await saveCurrentNote(); if (AppState.isDirty) return; }
        const count = await exportAllNotes();
        updateStatusBarText('save', '已导出 ' + count + ' 条笔记');
    } catch (err) {
        console.error('导出失败:', err);
        alert('导出失败：' + err.message);
    }
}

async function onImportNotes() {
    try {
        const count = await importNotes();
        if (count > 0) {
            await refreshNoteList();
            updateStatusBarText('save', '已导入 ' + count + ' 条笔记');
        }
    } catch (err) {
        console.error('导入失败:', err);
        alert('导入失败：' + err.message);
    }
}

// ========== UI 更新 ==========

/**
 * 刷新笔记列表
 */
async function refreshNoteList() {
    try {
        const request = ++listRefresh;
        const inTrash = AppState._showTrash;
        const result = await listNotes();
        if (request !== listRefresh || inTrash !== AppState._showTrash) return;
        AppState.notes = result;
        const query = (AppState.searchQuery || '').trim().toLowerCase();
        const notes = AppState.notes.filter(note => (!AppState._showConflictsOnly || note.isConflict) &&
            (!query || note.title.toLowerCase().includes(query) || note.content.toLowerCase().includes(query)));
        renderNoteList(notes);
        updateTrashModeUI();
    } catch (err) {
        console.error('刷新笔记列表失败:', err);
    }
}

/**
 * 高亮侧边栏中的激活笔记
 * @param {string|null} id
 */
function highlightActiveNote(id) {
    $$('.note-item').forEach(item => {
        item.classList.remove('active');
        if (id && item.dataset.noteId === id) {
            item.classList.add('active');
        }
    });
}

/**
 * 更新存储模式相关的 UI
 */
function updateStorageUI() {
    if (AppState.storageMode === 'desktop') {
        $('#storage-info').textContent = '存储模式：桌面 Markdown 文件';
        $('#btn-open-folder').style.display = 'block';
        $('#btn-open-folder').textContent = '📂 打开笔记目录';
        $('#btn-open-folder').title = '在系统文件管理器中打开默认笔记目录';
        $$('.btn-idb-only').forEach(btn => btn.style.display = 'block');
        const path = AppState.desktopPaths && AppState.desktopPaths.notesDir;
        updateStatusBarText('storage', path ? '存储：' + path : '存储：桌面默认目录');
    } else if (AppState.storageMode === 'fsa') {
        $('#storage-info').textContent = '存储模式：📂 文件夹';
        $('#btn-open-folder').style.display = 'block';
        $('#btn-open-folder').textContent = '📂 打开文件夹';
        $('#btn-open-folder').title = '选择本地文件夹存储笔记';
        // 隐藏 IDB 专用按钮
        $$('.btn-idb-only').forEach(btn => btn.style.display = 'none');
        updateStatusBarText('storage', '存储：' + (AppState.folderHandle ? AppState.folderHandle.name : '未选择'));
    } else {
        $('#storage-info').textContent = '存储模式：🌐 浏览器本地';
        $('#btn-open-folder').style.display = 'none';
        $$('.btn-idb-only').forEach(btn => btn.style.display = 'block');
        updateStatusBarText('storage', '存储：浏览器本地 (IndexedDB)');
    }
}

/**
 * 更新编辑器工具栏（标题显示）
 */
function updateEditorToolbar(note) {
    const display = $('#note-title-display');
    if (display) {
        display.textContent = note ? note.title : '';
    }
}

/**
 * 更新状态栏文本
 * @param {string} id - 状态栏元素 ID（不含 'status-' 前缀）
 * @param {string} text
 */
function updateStatusBarText(id, text) {
    const el = $('#status-' + id);
    if (el) el.textContent = text;
}

/**
 * 更新回收站模式的 UI 状态
 */
function updateTrashModeUI() {
    const editor = $('#note-editor');
    const btnNew = $('#btn-new-note');
    const btnDelete = $('#btn-delete-note');
    const isReadOnly = AppState._showTrash || AppState._currentNoteReadOnly;

    if (isReadOnly) {
        // 回收站和冲突副本均只读；冲突副本仍保留删除入口
        if (editor) editor.contentEditable = 'false';
        if (btnNew) btnNew.style.display = AppState._showTrash ? 'none' : '';
        if (btnDelete) btnDelete.style.display = AppState._showTrash ? 'none' : '';
        updateStatusBarText('save', AppState._showTrash ? '回收站 — 只读' : '冲突副本 — 只读');
    } else {
        // 正常模式
        if (editor) editor.contentEditable = window.DesktopEditing?.isClosing() ? 'false' : 'true';
        if (btnNew) btnNew.style.display = '';
        if (btnDelete) btnDelete.style.display = '';
    }

    if (typeof updateConflictBanner === 'function') {
        const current = AppState.currentNoteId && AppState._currentNoteReadOnly
            ? AppState.notes.find(note => note.id === AppState.currentNoteId)
            : null;
        updateConflictBanner(current);
    }
}
