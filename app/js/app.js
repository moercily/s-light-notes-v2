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

    try {
        // 检测浏览器能力并初始化存储
        const mode = await initStorage();
        console.log('s-light notes 启动 — 存储模式:', mode);

        // 更新存储 UI
        updateStorageUI();

        if (mode === 'desktop' || mode === 'idb') {
            // 桌面默认目录和 IDB 模式可在启动时直接加载笔记
            await refreshNoteList();
        }
        // FSA 模式：等待用户选择文件夹
    } catch (err) {
        console.error('存储初始化失败:', err);
        updateStatusBarText('storage', '存储：初始化失败');
        updateStatusBarText('save', '请重新选择存储位置');
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

    // Syncthing 同步设置
    $('#btn-sync-settings').addEventListener('click', openSyncDialog);
    $('#sync-close').addEventListener('click', closeSyncDialog);
    $('#sync-test-connection').addEventListener('click', onSyncTestConnection);
    $('#sync-open-web').addEventListener('click', openSyncthingWebUI);
    $('#sync-use-proxy').addEventListener('click', useLocalSyncProxy);
    $('#sync-show-conflicts').addEventListener('click', showConflictList);
    $('#desktop-ensure-notes-folder').addEventListener('click', onDesktopEnsureNotesFolder);
    $('#desktop-open-notes-folder').addEventListener('click', onDesktopOpenNotesFolder);
    $('#sync-scan-now').addEventListener('click', onSyncScanNow);
    $('#sync-start-engine').addEventListener('click', onSyncStartEngine);
    $('#sync-load-config-assist').addEventListener('click', onSyncLoadConfigAssist);
    $('#sync-refresh-status').addEventListener('click', onSyncRefreshStatus);
    $('#sync-folder-select').addEventListener('change', onSyncFolderSelected);
    $('#sync-preview-binding').addEventListener('click', onSyncPreviewBinding);
    $('#sync-open-confirm-binding').addEventListener('click', openSyncBindingConfirmation);
    $('#sync-binding-confirm-cancel').addEventListener('click', closeSyncBindingConfirmation);
    $('#sync-binding-confirm-apply').addEventListener('click', onSyncConfirmBinding);
    $('#sync-remember-key').addEventListener('change', updateSyncKeyWarning);
    $('#sync-dialog').addEventListener('click', (e) => {
        if (e.target === $('#sync-dialog')) closeSyncDialog();
    });
    $('#sync-binding-confirm-dialog').addEventListener('click', (e) => {
        if (e.target === $('#sync-binding-confirm-dialog')) closeSyncBindingConfirmation();
    });

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
            if (editor && !AppState._showTrash) {
                undo(editor);
            }
        }

        // Ctrl+Y 或 Ctrl+Shift+Z：重做
        if (isCtrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
            e.preventDefault();
            const editor = $('#note-editor');
            if (editor && !AppState._showTrash) {
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

// ========== Syncthing 同步设置 ==========

function openSyncDialog() {
    const desktopMode = !!(window.desktopService && window.desktopService.isAvailable());
    $('#sync-api-base').value = desktopMode
        ? 'http://127.0.0.1:8384'
        : (AppState.sync.apiBase || 'http://127.0.0.1:8384');
    $('#sync-api-base').disabled = desktopMode;
    $('#sync-use-proxy').style.display = desktopMode ? 'none' : '';
    $('#sync-api-key').value = AppState.sync.apiKey || '';
    $('#sync-remember-key').checked = !!AppState.sync.rememberKey;
    $('#sync-test-result').textContent = syncGetSummaryText();
    $('#sync-test-result').className = 'sync-test-result';
    renderSyncReadOnlyPanel();
    renderSyncCenterCards();
    refreshSyncEngineStatus();
    refreshDesktopPaths();
    updateSyncKeyWarning();
    $('#sync-dialog').classList.remove('hidden');
}

function closeSyncDialog() {
    closeSyncBindingConfirmation();
    const dialog = $('#sync-dialog');
    if (dialog) dialog.classList.add('hidden');
}

async function onSyncTestConnection() {
    const resultEl = $('#sync-test-result');
    const apiBase = $('#sync-api-base').value;
    const apiKey = $('#sync-api-key').value;
    const rememberKey = $('#sync-remember-key').checked;

    resultEl.className = 'sync-test-result';
    resultEl.textContent = '正在测试连接...';
    updateStatusBarText('sync', '同步：连接测试中');

    const options = {
        apiBase: apiBase,
        apiKey: apiKey,
        rememberKey: rememberKey,
        folderId: AppState.sync.folderId,
    };
    const result = await syncService.testConnection(options);
    applySyncConnectionResult(result, options);

    if (result.ok) {
        const deviceText = result.deviceId ? '本机设备：' + result.deviceId.slice(0, 12) + '...' : '已连接';
        resultEl.className = 'sync-test-result success';
        resultEl.textContent = '连接成功。' + deviceText + ' 文件夹：' + result.folders.length + ' 个，设备：' + result.devices.length + ' 台。';
        renderSyncReadOnlyPanel();
    } else {
        resultEl.className = 'sync-test-result error';
        resultEl.textContent = result.error.message;
        renderSyncReadOnlyPanel();
    }

    updateSyncStatusUI();
}

async function onSyncRefreshStatus() {
    const resultEl = $('#sync-test-result');
    const apiBase = $('#sync-api-base').value || AppState.sync.apiBase;
    const apiKey = $('#sync-api-key').value || AppState.sync.apiKey;
    resultEl.className = 'sync-test-result';
    resultEl.textContent = '正在刷新同步状态...';

    const options = {
        apiBase: apiBase,
        apiKey: apiKey,
        rememberKey: $('#sync-remember-key').checked,
        folderId: AppState.sync.folderId,
    };

    try {
        const result = await syncService.testConnection(options);
        applySyncConnectionResult(result, options);
        if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
        resultEl.className = 'sync-test-result success';
        resultEl.textContent = '已刷新。文件夹：' + result.folders.length + ' 个，设备：' + result.devices.length + ' 台。';
        renderSyncReadOnlyPanel();
    } catch (err) {
        const normalized = syncNormalizeError(err);
        AppState.sync.connected = false;
        AppState.sync.status = SyncStatus.ERROR;
        AppState.sync.lastError = normalized;
        resultEl.className = 'sync-test-result error';
        resultEl.textContent = normalized.message;
        renderSyncReadOnlyPanel();
    }

    updateSyncStatusUI();
}

async function onSyncScanNow() {
    const resultEl = $('#sync-test-result');
    const apiBase = $('#sync-api-base').value || AppState.sync.apiBase;
    const apiKey = $('#sync-api-key').value || AppState.sync.apiKey;
    resultEl.className = 'sync-test-result';
    resultEl.textContent = '正在请求 Syncthing 扫描...';

    try {
        AppState.sync.apiBase = syncNormalizeApiBase(apiBase);
        if (apiKey) AppState.sync.apiKey = apiKey;
        await syncService.scanFolder(AppState.sync.folderId, { apiKey: apiKey });
        const options = {
            apiBase: apiBase,
            apiKey: apiKey,
            rememberKey: $('#sync-remember-key').checked,
            folderId: AppState.sync.folderId,
        };
        const state = await syncService.testConnection(options);
        applySyncConnectionResult(state, options);
        if (!state.ok) throw Object.assign(new Error(state.error.message), state.error);
        resultEl.className = 'sync-test-result success';
        resultEl.textContent = '已请求扫描。' + syncGetFolderSummary() + '，设备：' + state.devices.length + ' 台。';
        renderSyncReadOnlyPanel();
    } catch (err) {
        const normalized = syncNormalizeError(err);
        AppState.sync.lastError = normalized;
        resultEl.className = 'sync-test-result error';
        resultEl.textContent = normalized.message;
        renderSyncReadOnlyPanel();
    }

    updateSyncStatusUI();
}

async function onSyncStartEngine() {
    const resultEl = $('#sync-test-result');
    resultEl.className = 'sync-test-result';
    resultEl.textContent = '正在启动 Syncthing 同步引擎...';

    try {
        AppState.syncDesktopStatus = await syncService.startEngine();
        resultEl.className = AppState.syncDesktopStatus.running ? 'sync-test-result success' : 'sync-test-result error';
        resultEl.textContent = AppState.syncDesktopStatus.message || (AppState.syncDesktopStatus.running ? '同步引擎已启动。' : '同步引擎未运行。');
    } catch (err) {
        AppState.syncDesktopStatus = {
            available: false,
            running: false,
            managed: false,
            message: err.message || '桌面同步引擎不可用',
        };
        resultEl.className = 'sync-test-result error';
        resultEl.textContent = AppState.syncDesktopStatus.message;
    }

    renderSyncCenterCards();
    updateSyncStatusUI();
}

async function onSyncLoadConfigAssist() {
    const resultEl = $('#sync-test-result');
    const apiBase = $('#sync-api-base').value || AppState.sync.apiBase;
    const apiKey = $('#sync-api-key').value || AppState.sync.apiKey;
    resultEl.className = 'sync-test-result';
    resultEl.textContent = '正在读取配置辅助信息...';

    try {
        AppState.sync.apiBase = syncNormalizeApiBase(apiBase);
        if (apiKey) AppState.sync.apiKey = apiKey;
        const state = await syncService.getConfigAssist({
            apiBase: AppState.sync.apiBase,
            apiKey: apiKey,
        });
        AppState.sync.defaultFolderTemplate = state.folderTemplate || null;
        AppState.sync.defaultDeviceTemplate = state.deviceTemplate || null;
        AppState.sync.restartRequired = state.restartRequired;
        resultEl.className = 'sync-test-result success';
        resultEl.textContent = '已读取配置辅助信息。本阶段不会写入 Syncthing 配置。';
        renderSyncReadOnlyPanel();
    } catch (err) {
        const normalized = syncNormalizeError(err);
        AppState.sync.lastError = normalized;
        resultEl.className = 'sync-test-result error';
        resultEl.textContent = normalized.message;
        renderSyncReadOnlyPanel();
    }

    updateSyncStatusUI();
}

async function onSyncFolderSelected(e) {
    AppState.sync.folderConfigPreview = null;
    syncSetFolderId(e.target.value);
    renderSyncReadOnlyPanel();
    updateSyncStatusUI();
    if (AppState.sync.connected) {
        await onSyncRefreshStatus();
    }
}

async function openSyncthingWebUI() {
    if (window.desktopService && window.desktopService.isAvailable()) {
        try {
            await syncService.openWeb();
        } catch (err) {
            $('#sync-test-result').className = 'sync-test-result error';
            $('#sync-test-result').textContent = err.message || '无法打开 Syncthing。';
        }
        return;
    }
    const apiBase = syncNormalizeApiBase($('#sync-api-base').value || AppState.sync.apiBase);
    window.open(apiBase, '_blank', 'noopener');
}

function applySyncConnectionResult(result, options) {
    const config = options || {};
    const desktopBase = result && result.desktopStatus && result.desktopStatus.apiBase;
    AppState.sync.apiBase = syncNormalizeApiBase(desktopBase || config.apiBase);
    AppState.sync.apiKey = (config.apiKey || '').trim() || null;
    AppState.sync.rememberKey = !!config.rememberKey;
    AppState.sync.enabled = true;
    AppState.sync.lastCheckedAt = Date.now();
    if (result && result.desktopStatus) AppState.syncDesktopStatus = result.desktopStatus;

    if (result && result.ok) {
        AppState.sync.folderConfigPreview = null;
        AppState.sync.connected = true;
        AppState.sync.status = SyncStatus.CONNECTED;
        AppState.sync.lastError = null;
        AppState.sync.folders = Array.isArray(result.folders) ? result.folders : [];
        AppState.sync.devices = Array.isArray(result.devices) ? result.devices : [];
        AppState.sync.connections = result.connections || null;
        AppState.sync.deviceId = result.deviceId || null;
        AppState.sync.folderStatus = result.folderStatus || null;
        AppState.sync.completions = Array.isArray(result.completions) ? result.completions : [];
        if (Object.prototype.hasOwnProperty.call(result, 'folderId')) {
            AppState.sync.folderId = result.folderId || null;
        }
    } else {
        AppState.sync.connected = false;
        AppState.sync.status = SyncStatus.ERROR;
        AppState.sync.lastError = result && result.error
            ? result.error
            : { type: 'network', message: '无法连接 Syncthing。' };
    }

    syncPersistSettings({ skipKey: !AppState.sync.rememberKey });
}

function useLocalSyncProxy() {
    $('#sync-api-base').value = '/syncthing';
    $('#sync-test-result').className = 'sync-test-result';
    $('#sync-test-result').textContent = '已切换到本地代理路径。请确认正在运行 node tools/syncthing-proxy.js。';
}

async function refreshDesktopPaths() {
    const summary = $('#desktop-path-summary');
    if (!summary || !window.desktopService) return;

    if (!window.desktopService.isAvailable()) {
        summary.textContent = '桌面默认笔记目录：仅 Tauri 桌面版可用';
        return;
    }

    try {
        AppState.desktopPaths = await window.desktopService.getAppPaths();
        summary.textContent = '桌面默认笔记目录：' + AppState.desktopPaths.notesDir;
        renderSyncBindingControls();
    } catch (err) {
        summary.textContent = '桌面默认笔记目录：' + (err.message || '读取失败');
    }
}

async function onDesktopEnsureNotesFolder() {
    const resultEl = $('#sync-test-result');
    resultEl.className = 'sync-test-result';
    resultEl.textContent = '正在创建默认笔记目录...';

    try {
        AppState.desktopPaths = await window.desktopService.ensureNotesFolder();
        resultEl.className = 'sync-test-result success';
        resultEl.textContent = '默认笔记目录已准备好。';
    } catch (err) {
        resultEl.className = 'sync-test-result error';
        resultEl.textContent = err.message || '创建默认笔记目录失败';
    }

    refreshDesktopPaths();
    renderSyncBindingControls();
}

async function onDesktopOpenNotesFolder() {
    const resultEl = $('#sync-test-result');
    resultEl.className = 'sync-test-result';
    resultEl.textContent = '正在打开默认笔记目录...';

    try {
        await window.desktopService.openNotesFolder();
        resultEl.className = 'sync-test-result success';
        resultEl.textContent = '已请求系统打开默认笔记目录。';
    } catch (err) {
        resultEl.className = 'sync-test-result error';
        resultEl.textContent = err.message || '打开默认笔记目录失败';
    }
}

function renderSyncReadOnlyPanel() {
    const panel = $('#sync-readonly-panel');
    const select = $('#sync-folder-select');
    const folderSummary = $('#sync-folder-summary');
    const summary = $('#sync-device-summary');
    const completionSummary = $('#sync-completion-summary');
    const configAssistSummary = $('#sync-config-assist-summary');
    const conflictSummary = $('#sync-conflict-summary');
    const conflictButton = $('#sync-show-conflicts');
    const ensureFolderButton = $('#desktop-ensure-notes-folder');
    const openFolderButton = $('#desktop-open-notes-folder');
    const scanButton = $('#sync-scan-now');
    const startEngineButton = $('#sync-start-engine');
    const configAssistButton = $('#sync-load-config-assist');
    if (!panel || !select || !folderSummary || !summary || !completionSummary || !configAssistSummary || !conflictSummary || !conflictButton || !ensureFolderButton || !openFolderButton || !scanButton || !startEngineButton || !configAssistButton) return;

    const folders = AppState.sync && AppState.sync.folders ? AppState.sync.folders : [];
    const conflictCount = getConflictNotes().length;
    panel.classList.toggle('hidden', !AppState.sync.connected);

    select.innerHTML = '<option value="">未绑定文件夹</option>';
    folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.id || '';
        option.textContent = syncGetFolderLabel(folder);
        if (option.value === AppState.sync.folderId) option.selected = true;
        select.appendChild(option);
    });

    folderSummary.textContent = syncGetFolderSummary();
    summary.textContent = syncGetDeviceSummary();
    completionSummary.textContent = syncGetCompletionSummary();
    configAssistSummary.textContent = syncGetConfigAssistSummary();
    conflictSummary.textContent = '冲突：' + conflictCount + ' 个';
    conflictButton.disabled = conflictCount === 0;
    conflictButton.title = conflictCount ? '在侧边栏显示 Syncthing 冲突副本' : '当前没有冲突副本';
    ensureFolderButton.disabled = !(window.desktopService && window.desktopService.isAvailable());
    ensureFolderButton.title = ensureFolderButton.disabled ? '仅 Tauri 桌面版可创建默认目录' : '创建 v2 默认笔记目录';
    openFolderButton.disabled = !(window.desktopService && window.desktopService.isAvailable());
    openFolderButton.title = openFolderButton.disabled ? '仅 Tauri 桌面版可打开默认目录' : '在系统文件管理器中打开默认笔记目录';
    scanButton.disabled = !syncCanScan();
    scanButton.title = scanButton.disabled ? syncGetScanDisabledReason() : '请求 Syncthing 扫描当前绑定文件夹';
    startEngineButton.title = '桌面版可尝试启动本机 Syncthing；Web/PWA 模式会提示不可用';
    configAssistButton.disabled = !(AppState.sync && AppState.sync.connected);
    configAssistButton.title = configAssistButton.disabled ? '请先连接 Syncthing' : '只读取默认配置模板和重启状态，不写入配置';
    renderSyncBindingControls();
    renderSyncCenterCards();
}

function normalizeBindingPath(path) {
    return (path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function getSelectedSyncFolder() {
    const folders = AppState.sync && Array.isArray(AppState.sync.folders)
        ? AppState.sync.folders
        : [];
    return folders.find(folder => folder.id === AppState.sync.folderId) || null;
}

function getFolderDeviceIds(folder) {
    if (!folder || !Array.isArray(folder.devices)) return [];
    return folder.devices
        .map(device => typeof device === 'string' ? device : (device.deviceID || device.deviceId || ''))
        .filter(Boolean);
}

function renderSyncBindingControls() {
    const panel = $('#sync-binding-panel');
    const summary = $('#sync-binding-summary');
    const folderIdInput = $('#sync-binding-folder-id');
    const devicesContainer = $('#sync-binding-devices');
    const previewButton = $('#sync-preview-binding');
    if (!panel || !summary || !folderIdInput || !devicesContainer || !previewButton) return;

    const desktopMode = !!(window.desktopService && window.desktopService.isAvailable());
    panel.classList.toggle('hidden', !desktopMode);
    if (!desktopMode) return;

    const notesPath = AppState.desktopPaths && AppState.desktopPaths.notesDir;
    const connected = !!(AppState.sync && AppState.sync.connected);
    const selectedFolder = getSelectedSyncFolder();
    const likelyBound = !!(notesPath && selectedFolder &&
        normalizeBindingPath(selectedFolder.path) === normalizeBindingPath(notesPath));
    const previousSelected = new Set(Array.from(
        devicesContainer.querySelectorAll('input[type="checkbox"]:checked')
    ).map(input => input.value));

    if (!connected) {
        summary.textContent = '请先连接 Syncthing';
    } else if (!notesPath) {
        summary.textContent = '桌面默认笔记目录尚未准备好';
    } else if (likelyBound) {
        summary.textContent = '已检测到所选 folder 管理默认笔记目录';
    } else {
        summary.textContent = '默认笔记目录尚未匹配到所选 Syncthing folder';
    }

    if (likelyBound) {
        folderIdInput.value = selectedFolder.id;
    } else if (folderIdInput.disabled || !folderIdInput.value.trim()) {
        folderIdInput.value = 's-light-notes';
    }
    folderIdInput.disabled = likelyBound;

    devicesContainer.innerHTML = '';
    const devices = AppState.sync && Array.isArray(AppState.sync.devices)
        ? AppState.sync.devices.filter(device => {
            const id = device.deviceID || device.deviceId || '';
            return id && id !== AppState.sync.deviceId;
        })
        : [];
    const boundDeviceIds = new Set(likelyBound ? getFolderDeviceIds(selectedFolder) : []);
    if (!devices.length) {
        const empty = document.createElement('span');
        empty.className = 'sync-device-empty';
        empty.textContent = '暂无可选远端设备';
        devicesContainer.appendChild(empty);
    } else {
        devices.forEach(device => {
            const id = device.deviceID || device.deviceId;
            const label = document.createElement('label');
            label.className = 'sync-device-option';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = id;
            checkbox.checked = likelyBound ? boundDeviceIds.has(id) : previousSelected.has(id);
            checkbox.disabled = likelyBound;
            const text = document.createElement('span');
            text.textContent = (device.name || '未命名设备') + ' — ' + id;
            label.appendChild(checkbox);
            label.appendChild(text);
            devicesContainer.appendChild(label);
        });
    }

    previewButton.disabled = !connected || !notesPath;
    previewButton.title = previewButton.disabled
        ? '请先连接 Syncthing 并准备默认笔记目录'
        : '仅生成配置摘要，不写入 Syncthing';
    renderSyncBindingPreview(AppState.sync && AppState.sync.folderConfigPreview);
}

async function onSyncPreviewBinding() {
    const previewEl = $('#sync-binding-preview');
    const notesPath = AppState.desktopPaths && AppState.desktopPaths.notesDir;
    if (!previewEl || !notesPath) return;

    const selectedFolder = getSelectedSyncFolder();
    const deviceIds = Array.from(
        $('#sync-binding-devices').querySelectorAll('input[type="checkbox"]:checked')
    ).map(input => input.value);
    previewEl.classList.remove('hidden', 'error');
    previewEl.textContent = '正在生成配置预览...';

    try {
        const preview = await syncService.bindNotesFolder(
            notesPath,
            $('#sync-binding-folder-id').value,
            {
                selectedFolderId: selectedFolder && selectedFolder.id,
                selectedFolderPath: selectedFolder && selectedFolder.path,
                selectedFolderDeviceIds: getFolderDeviceIds(selectedFolder),
                deviceIds: deviceIds,
                existingFolderIds: AppState.sync.folders.map(folder => folder.id).filter(Boolean),
                restartRequired: syncIsRestartRequired(AppState.sync.restartRequired),
            }
        );
        AppState.sync.folderConfigPreview = preview;
        renderSyncBindingPreview(preview);
    } catch (err) {
        AppState.sync.folderConfigPreview = null;
        $('#sync-open-confirm-binding').classList.add('hidden');
        previewEl.classList.add('error');
        previewEl.textContent = err.message || String(err);
    }
}

function renderSyncBindingPreview(preview) {
    const container = $('#sync-binding-preview');
    const confirmButton = $('#sync-open-confirm-binding');
    if (!container || !confirmButton) return;
    container.innerHTML = '';
    container.classList.remove('error');
    container.classList.toggle('hidden', !preview);
    confirmButton.classList.toggle(
        'hidden',
        !(preview && preview.requiresConfirmation && preview.confirmationToken)
    );
    if (!preview) return;

    const title = document.createElement('strong');
    title.textContent = preview.operation === 'alreadyBound'
        ? '目录已经绑定'
        : '新建 Syncthing folder 预览';
    container.appendChild(title);
    const lines = [
        'Folder ID：' + preview.folderId,
        '目录：' + preview.path,
        '共享设备：' + (preview.deviceCount ? preview.deviceCount + ' 台' : '未选择'),
        '重启影响：' + formatRestartImpact(preview.restartImpact),
        preview.message,
        '配置写入：未执行',
    ];
    lines.forEach(value => {
        const line = document.createElement('span');
        line.textContent = value;
        container.appendChild(line);
    });
}

function openSyncBindingConfirmation() {
    const preview = AppState.sync && AppState.sync.folderConfigPreview;
    if (!preview || !preview.confirmationToken || !preview.requiresConfirmation) return;

    const summary = $('#sync-binding-confirm-summary');
    summary.innerHTML = '';
    [
        'Folder ID：' + preview.folderId,
        '目录：' + preview.path,
        '共享设备：' + (preview.deviceCount ? preview.deviceCount + ' 台' : '未选择'),
        '确认有效期：' + (preview.expiresInSeconds || 300) + ' 秒',
    ].forEach(value => {
        const line = document.createElement('span');
        line.textContent = value;
        summary.appendChild(line);
    });
    const result = $('#sync-binding-confirm-result');
    result.className = 'sync-test-result hidden';
    result.textContent = '';
    $('#sync-binding-confirm-apply').disabled = false;
    $('#sync-binding-confirm-dialog').classList.remove('hidden');
}

function closeSyncBindingConfirmation() {
    const dialog = $('#sync-binding-confirm-dialog');
    if (dialog) dialog.classList.add('hidden');
}

async function onSyncConfirmBinding() {
    const preview = AppState.sync && AppState.sync.folderConfigPreview;
    if (!preview || !preview.confirmationToken) return;

    const applyButton = $('#sync-binding-confirm-apply');
    const resultEl = $('#sync-binding-confirm-result');
    applyButton.disabled = true;
    resultEl.className = 'sync-test-result';
    resultEl.textContent = '正在重新检查并写入 Syncthing...';

    try {
        const applied = await syncService.confirmNotesFolder(
            preview.confirmationToken,
            $('#sync-api-key').value || AppState.sync.apiKey
        );
        AppState.sync.folderConfigPreview = null;
        AppState.sync.folderId = applied.folderId;
        closeSyncBindingConfirmation();
        renderSyncBindingPreview(null);
        await onSyncRefreshStatus();
        $('#sync-test-result').className = 'sync-test-result success';
        $('#sync-test-result').textContent = applied.message + (
            applied.restartRequired ? ' Syncthing 提示需要重启。' : ' 当前无需重启。'
        );
    } catch (err) {
        resultEl.className = 'sync-test-result error';
        resultEl.textContent = err.message || String(err);
        applyButton.disabled = false;
    }
}

function formatRestartImpact(value) {
    if (value === 'alreadyRequired') return 'Syncthing 当前已提示需要重启';
    if (value === 'noneExpected') return '预计无需重启';
    return '未知';
}

async function refreshSyncEngineStatus() {
    if (!window.syncService || !window.SyncCenter) return;
    try {
        AppState.syncDesktopStatus = await window.syncService.getStatus();
    } catch (err) {
        AppState.syncDesktopStatus = {
            available: false,
            running: false,
            managed: false,
            message: err.message || '桌面同步引擎不可用',
        };
    }
    renderSyncCenterCards();
}

function renderSyncCenterCards() {
    const container = $('#sync-center-cards');
    if (!container || !window.SyncCenter) return;
    const model = window.SyncCenter.createModel({
        appState: AppState,
        desktopStatus: AppState.syncDesktopStatus,
    });
    window.SyncCenter.renderCards(container, model);
}

function updateSyncKeyWarning() {
    const warning = $('#sync-key-warning');
    if (!warning) return;
    warning.classList.toggle('hidden', !$('#sync-remember-key').checked);
}

function updateSyncStatusUI() {
    updateStatusBarText('sync', syncGetSummaryText());
    renderSyncCenterCards();
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
        const title = note.title || note.id;
        const content = '# ' + title + '（冲突副本）\n\n' + stripLeadingTitle(note.content);
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
    $('#conflict-dialog').classList.add('hidden');
    const note = await readNote(AppState.currentNoteId);
    if (note) {
        loadNoteToEditor(note);
        AppState._lastSavedTime = note.updatedAt;
        updateStatusBarText('save', '已重新加载外部版本');
    }
}

async function onConflictOverwrite() {
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
