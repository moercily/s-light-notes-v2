/* ============================================
   s-light notes — 应用入口
   负责：全局状态、初始化、事件绑定、键盘快捷键
   ============================================ */

// ========== 全局状态 ==========

const AppState = {
    currentNoteId: null,        // 当前打开的笔记 ID
    notes: [],                  // 笔记列表缓存
    storageMode: null,          // 'fsa' 或 'idb'
    folderHandle: null,         // FSA 目录句柄
    isDirty: false,             // 是否有未保存的更改
    searchQuery: '',            // 当前搜索关键词
    _lastSavedTime: null,       // 上次保存时间（用于冲突检测）
    _pendingDeleteId: null,     // 待删除的笔记 ID
    _showTrash: false,          // 是否显示回收站
    _showConflictsOnly: false,  // 是否只显示 Syncthing 冲突副本
    _currentNoteReadOnly: false,// 当前笔记是否只读
    _theme: null,               // 'light' | 'dark' | null（null=跟随系统）
    sync: null,                 // Syncthing 同步状态
    desktopPaths: null,         // v2 桌面端默认目录信息
    pairingInfo: null,          // 内置同步引擎的设备配对状态
    pairingPreview: null,       // 等待用户二次确认的配对摘要
    pairingQrUrl: null,         // 本机设备二维码的临时 Blob URL
    syncEventSince: 0,          // 最近处理的 Syncthing 事件编号
    syncEventPolling: false,    // 同步中心打开时启用事件轮询
    syncEventTimer: null,       // 下一次事件轮询计时器
    syncEventGeneration: 0,     // 防止快速关闭重开产生重复轮询
};

// ========== 初始化 ==========

async function init() {
    // 初始化主题
    initTheme();

    // 初始化同步状态（第一阶段只做连接验证）
    syncInitState();

    // 注册 Service Worker
    registerSW();

    // 先绑定事件，避免存储初始化失败导致所有按钮失效
    bindEvents();
    bindKeyboardShortcuts();
    Settings.init();
    if (window.desktopService?.isAvailable()) {
        await DesktopEditing.init();
        await initDesktopStickyUI();
    }

    try {
        // 检测浏览器能力并初始化存储
        const mode = await initStorage();
        console.log('s-light notes 启动 — 存储模式:', mode);

        // 更新存储 UI
        updateStorageUI();
        if (mode === 'desktop') DesktopEditing.ready();

        if (mode === 'desktop' || mode === 'idb') {
            // 桌面默认目录和 IDB 模式可在启动时直接加载笔记
            await refreshNoteList();
        }
        // FSA 模式：等待用户选择文件夹
    } catch (err) {
        console.error('存储初始化失败:', err);
        updateStatusBarText('storage', '存储：初始化失败');
        updateStatusBarText('save', '请重新选择存储位置');
        if (window.desktopService?.isAvailable()) DesktopEditing.ready();
    }

    // 更新状态栏
    if ($('#status-save').textContent === '--') {
        updateStatusBarText('save', '就绪');
    }
    updateSyncStatusUI();
}

// ========== 事件绑定 ==========

function bindEvents() {
    // 新建笔记
    $('#btn-new-note').addEventListener('click', onNewNote);

    // 搜索
    $('#search-box').addEventListener('input', (e) => {
        handleSearch(e.target.value);
    });

    // 编辑器输入
    $('#note-editor').addEventListener('input', onEditorInput);

    // 打开文件夹
    $('#btn-open-folder').addEventListener('click', onOpenFolder);

    // 导出/导入
    $('#btn-export').addEventListener('click', onExportAll);
    $('#btn-import').addEventListener('click', onImportNotes);

    // 删除笔记
    $('#btn-delete-note').addEventListener('click', () => {
        if (AppState.currentNoteId) {
            onDeleteRequested(AppState.currentNoteId);
        }
    });

    // 确认对话框
    $('#confirm-yes').addEventListener('click', onDeleteConfirmed);
    $('#confirm-no').addEventListener('click', onDeleteCancelled);

    // 点击对话框遮罩关闭
    $('#confirm-dialog').addEventListener('click', (e) => {
        if (e.target === $('#confirm-dialog')) onDeleteCancelled();
    });

    // 冲突对话框
    $('#conflict-reload').addEventListener('click', onConflictReload);
    $('#conflict-overwrite').addEventListener('click', onConflictOverwrite);
    $('#conflict-cancel').addEventListener('click', () => {
        $('#conflict-dialog').classList.add('hidden');
    });

    // 主题切换
    $('#btn-theme-toggle').addEventListener('click', toggleTheme);

    // 回收站
    $('#btn-show-trash').addEventListener('click', toggleTrash);


    // Syncthing 冲突副本处理
    $('#conflict-keep-copy').addEventListener('click', onConflictKeepCopy);
    $('#conflict-copy-content').addEventListener('click', onConflictCopyContent);
    $('#conflict-delete-copy').addEventListener('click', onConflictDeleteCopy);

    // 格式工具栏
    initFormatToolbar();

    // 移动端侧边栏切换
    const btnToggleSidebar = $('#btn-toggle-sidebar');
    const sidebarOverlay = $('#sidebar-overlay');
    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', () => {
            const sidebar = $('#sidebar');
            sidebar.classList.toggle('open');
            if (sidebarOverlay) sidebarOverlay.classList.toggle('open');
        });
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            const sidebar = $('#sidebar');
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('open');
        });
    }

    // 选择笔记后自动关闭侧边栏（移动端）
    const noteList = $('#note-list');
    if (noteList) {
        noteList.addEventListener('click', (e) => {
            if (e.target.closest('.note-item') && window.innerWidth <= 768) {
                const sidebar = $('#sidebar');
                sidebar.classList.remove('open');
                if (sidebarOverlay) sidebarOverlay.classList.remove('open');
            }
        });
    }
}

// ========== 键盘快捷键 ==========

function bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.isComposing || AppState._composing || e.keyCode === 229) return;
        if (e.altKey) return; // Global sticky shortcuts must not also trigger editor commands.
        const isCtrl = e.ctrlKey || e.metaKey; // Mac 上 metaKey = Cmd

        // Ctrl+N：新建笔记
        if (isCtrl && e.key === 'n') {
            e.preventDefault();
            onNewNote();
        }

        // Ctrl+S：手动保存
        if (isCtrl && e.key === 's') {
            e.preventDefault();
            onManualSave();
        }

        // Ctrl+F：聚焦搜索框
        if (isCtrl && e.key === 'f') {
            e.preventDefault();
            $('#search-box').focus();
        }

        // Ctrl+Shift+D：切换深色模式
        if (isCtrl && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            toggleTheme();
        }

        // Ctrl+Z：撤销
        if (isCtrl && !e.shiftKey && e.key === 'z') {
            e.preventDefault();
            const editor = $('#note-editor');
            if (editor && !AppState._showTrash && !AppState._currentNoteReadOnly) {
                undo(editor);
            }
        }

        // Ctrl+Y 或 Ctrl+Shift+Z：重做
        if (isCtrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
            e.preventDefault();
            const editor = $('#note-editor');
            if (editor && !AppState._showTrash && !AppState._currentNoteReadOnly) {
                redo(editor);
            }
        }

        // Escape：关闭对话框
        if (e.key === 'Escape') {
            onDeleteCancelled();
            closeSyncBindingConfirmation();
            closeSyncDialog();
            // 如果搜索框有焦点，失焦
            if (document.activeElement === $('#search-box')) {
                $('#search-box').blur();
            }
        }
    });
}


// ========== Syncthing 冲突副本处理 ==========

function getConflictNotes() {
    return (AppState.notes || []).filter(note => note.isConflict);
}

function updateConflictBanner(note) {
    const banner = $('#conflict-banner');
    if (!banner) return;
    const isConflict = !!(note && note.isConflict);
    banner.classList.toggle('hidden', !isConflict);
}

function showConflictList() {
    closeSyncDialog();
    AppState._showTrash = false;
    AppState._showConflictsOnly = true;
    AppState.searchQuery = '';
    $('#search-box').value = '';
    const trashBtn = $('#btn-show-trash');
    trashBtn.textContent = '🗑 回收站';
    trashBtn.style.background = '';
    trashBtn.style.color = '';
    renderNoteList(getConflictNotes(), AppState.currentNoteId);
    updateTrashModeUI();
    updateStatusBarText('save', '正在查看 Syncthing 冲突副本');
}

async function onConflictKeepCopy() {
    const note = await getCurrentConflictNote();
    if (!note) return;

    try {
        const content = note.content;
        const result = await saveNote(null, content);
        AppState.currentNoteId = result.id;
        AppState._currentNoteReadOnly = false;
        AppState._showConflictsOnly = false;
        const newNote = await readNote(result.id);
        loadNoteToEditor(newNote);
        await refreshNoteList();
        highlightActiveNote(result.id);
        updateStatusBarText('save', '已保留为新笔记');
    } catch (err) {
        console.error('保留冲突副本失败:', err);
        updateStatusBarText('save', '保留冲突副本失败');
    }
}

async function onConflictCopyContent() {
    if (!AppState._currentNoteReadOnly || !AppState.currentNoteId) return;

    try {
        await navigator.clipboard.writeText(getEditorContent());
        updateStatusBarText('save', '已复制冲突内容');
    } catch (err) {
        console.error('复制冲突内容失败:', err);
        updateStatusBarText('save', '复制失败，请手动选择内容');
    }
}

async function onConflictDeleteCopy() {
    const note = await getCurrentConflictNote();
    if (!note) return;
    onDeleteRequested(note.id);
}

async function getCurrentConflictNote() {
    if (!AppState.currentNoteId) return null;
    const note = await readNote(AppState.currentNoteId);
    if (!note || !note.isConflict) return null;
    return note;
}

function stripLeadingTitle(content) {
    return (content || '').replace(/^#\s+.*(?:\r?\n){1,2}/, '');
}

// ========== 冲突处理 ==========

/**
 * 检查外部修改冲突
 * 文件模式下，打开笔记前检查文件是否被外部修改
 */
async function checkConflict(id) {
    if (AppState.storageMode !== 'fsa' && AppState.storageMode !== 'desktop') return false;
    if (!AppState._lastSavedTime) return false;

    try {
        const note = AppState.storageMode === 'desktop'
            ? await desktopReadNote(id)
            : await fsaReadNote(id);
        if (!note) return false;
        // 文件修改时间晚于我们上次保存的时间 = 外部修改
        if (note.updatedAt > AppState._lastSavedTime + 1000) { // 1 秒容差
            return true;
        }
    } catch (err) {
        // 忽略错误
    }
    return false;
}

async function onConflictReload() {
    if (AppState.storageMode === 'desktop') {
        try { await DesktopEditing.reload(); } catch (error) { DesktopEditing.report(error); }
        return;
    }
    $('#conflict-dialog').classList.add('hidden');
    const note = await readNote(AppState.currentNoteId);
    if (note) {
        loadNoteToEditor(note);
        AppState._lastSavedTime = note.updatedAt;
        updateStatusBarText('save', '已重新加载外部版本');
    }
}

async function onConflictOverwrite() {
    if (AppState.storageMode === 'desktop') {
        try { await DesktopEditing.saveCopy(); } catch (error) { DesktopEditing.report(error); }
        return;
    }
    $('#conflict-dialog').classList.add('hidden');
    await saveCurrentNote({ forceOverwrite: true });
    updateStatusBarText('save', '已用当前内容覆盖');
}

// ========== 主题管理 ==========

/**
 * 初始化主题
 */
function initTheme() {
    // 从 localStorage 读取保存的主题设置
    const saved = localStorage.getItem('s-light-theme');
    if (saved === 'light' || saved === 'dark') {
        AppState._theme = saved;
        applyTheme(saved);
    } else {
        AppState._theme = null;
        // 跟随系统，不设置 data-theme
        document.documentElement.removeAttribute('data-theme');
    }
    updateThemeButton();
}

/**
 * 切换主题
 */
function toggleTheme() {
    if (AppState._theme === 'dark') {
        AppState._theme = 'light';
        applyTheme('light');
        localStorage.setItem('s-light-theme', 'light');
    } else if (AppState._theme === 'light') {
        AppState._theme = null;
        document.documentElement.removeAttribute('data-theme');
        localStorage.removeItem('s-light-theme');
    } else {
        AppState._theme = 'dark';
        applyTheme('dark');
        localStorage.setItem('s-light-theme', 'dark');
    }
    updateThemeButton();
}

/**
 * 应用主题
 */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

/**
 * 更新主题按钮图标
 */
function updateThemeButton() {
    const btn = $('#btn-theme-toggle');
    if (!btn) return;
    if (AppState._theme === 'dark') {
        btn.textContent = '☀️';
        btn.title = '切换浅色模式';
    } else if (AppState._theme === 'light') {
        btn.textContent = '🌙';
        btn.title = '切换深色模式';
    } else {
        btn.textContent = '🖥';
        btn.title = '跟随系统（点击切换）';
    }
}

// ========== Service Worker 注册 ==========

function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('[SW] 注册成功:', reg.scope);
            })
            .catch(err => {
                console.warn('[SW] 注册失败（file:// 协议或网络问题）:', err.message);
            });
    }
}

// ========== 回收站 ==========

async function toggleTrash() {
    AppState._showTrash = !AppState._showTrash;
    const btn = $('#btn-show-trash');
    if (AppState._showTrash) {
        btn.textContent = '📋 返回笔记';
        btn.style.background = 'var(--accent)';
        btn.style.color = 'white';
    } else {
        btn.textContent = '🗑 回收站';
        btn.style.background = '';
        btn.style.color = '';
    }

    // 切换模式时清空编辑器状态
    AppState.currentNoteId = null;
    AppState.isDirty = false;
    AppState._currentNoteReadOnly = false;
    AppState._showConflictsOnly = false;
    clearEditor();
    updateEditorToolbar(null);

    await refreshNoteList();
}

// ========== 启动 ==========

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
        console.error('s-light notes 初始化失败:', err);
        updateStatusBarText('save', '初始化失败');
    });
});
