// Sync settings controller, sharing the existing SyncCenter/SyncService models.
function bindSyncSettingsEvents() {
    // Syncthing 同步设置
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
    $('#sync-copy-device-id').addEventListener('click', onCopyLocalDeviceId);
    $('#sync-toggle-device-qr').addEventListener('click', onToggleLocalDeviceQr);
    $('#sync-preview-pairing').addEventListener('click', onPreviewDevicePairing);
    $('#sync-confirm-pairing').addEventListener('click', onConfirmDevicePairing);
    $('#sync-remember-key').addEventListener('change', updateSyncKeyWarning);
    $('#sync-binding-confirm-dialog').addEventListener('click', (e) => {
        if (e.target === $('#sync-binding-confirm-dialog')) closeSyncBindingConfirmation();
    });

}

// ========== Syncthing 同步设置 ==========

function openSyncDialog() {
    return Settings.open('sync');
}

function enterSyncSettings() {
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
    renderSyncConnectionMode();
    renderPairingPanel();
    refreshSyncEngineStatus();
    refreshDesktopPaths();
    updateSyncKeyWarning();
    startSyncEventPolling();
}

function closeSyncDialog() {
    return Settings.close();
}

function leaveSyncSettings() {
    stopSyncEventPolling();
    closeSyncBindingConfirmation();
}

function startSyncEventPolling() {
    if (AppState.syncEventPolling) return;
    AppState.syncEventPolling = true;
    AppState.syncEventSince = 0;
    AppState.syncEventGeneration += 1;
    pollSyncEvents(AppState.syncEventGeneration);
}

function stopSyncEventPolling() {
    AppState.syncEventPolling = false;
    AppState.syncEventGeneration += 1;
    if (AppState.syncEventTimer) clearTimeout(AppState.syncEventTimer);
    AppState.syncEventTimer = null;
}

function scheduleSyncEventPoll(delay, generation) {
    if (!AppState.syncEventPolling || generation !== AppState.syncEventGeneration) return;
    AppState.syncEventTimer = setTimeout(() => pollSyncEvents(generation), delay);
}

async function pollSyncEvents(generation) {
    if (!AppState.syncEventPolling || generation !== AppState.syncEventGeneration) return;
    const status = AppState.syncDesktopStatus;
    if (!status || status.engineKind !== 'sidecar' || !status.running) {
        scheduleSyncEventPoll(1000, generation);
        return;
    }

    try {
        const events = await syncService.getEvents(AppState.syncEventSince);
        if (!AppState.syncEventPolling || generation !== AppState.syncEventGeneration) return;
        if (Array.isArray(events) && events.length) {
            AppState.syncEventSince = events.reduce((latest, event) => {
                return Number.isSafeInteger(event.id) ? Math.max(latest, event.id) : latest;
            }, AppState.syncEventSince);
            await refreshFromSyncEvents(events);
        }
        scheduleSyncEventPoll(Array.isArray(events) && events.length ? 150 : 500, generation);
    } catch (err) {
        if (!AppState.syncEventPolling || generation !== AppState.syncEventGeneration) return;
        scheduleSyncEventPoll(1500, generation);
    }
}

async function refreshFromSyncEvents(events) {
    const relevant = events.some(event => {
        const folder = event && event.data && event.data.folder;
        return !folder || folder === 's-light-notes';
    });
    if (!relevant) return;
    await refreshSyncEngineStatus();
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
        resultEl.className = AppState.syncDesktopStatus.running
            ? 'sync-test-result success'
            : (AppState.syncDesktopStatus.managed ? 'sync-test-result' : 'sync-test-result error');
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
    renderSyncConnectionMode();
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
    if (AppState.syncDesktopStatus && AppState.syncDesktopStatus.engineKind === 'sidecar') {
        folderSummary.textContent = AppState.sync.folderId
            ? '笔记文件夹：已加入 P2P 同步'
            : '笔记文件夹：正在准备同步';
    }
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
    const sidecarMode = desktopMode && AppState.syncDesktopStatus &&
        AppState.syncDesktopStatus.engineKind === 'sidecar';
    panel.classList.toggle('hidden', !desktopMode || sidecarMode);
    if (!desktopMode || sidecarMode) return;

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
    renderSyncConnectionMode();
    if (AppState.syncDesktopStatus && AppState.syncDesktopStatus.running &&
        AppState.syncDesktopStatus.engineKind === 'sidecar') {
        const connection = await syncService.testConnection({
            apiKey: '',
            rememberKey: false,
            folderId: 's-light-notes',
        });
        applySyncConnectionResult(connection, {
            apiBase: AppState.syncDesktopStatus.apiBase,
            apiKey: '',
            rememberKey: false,
        });
        renderSyncReadOnlyPanel();
        renderSyncCenterCards();
        await refreshPairingInfo();
    }
}

function renderSyncConnectionMode() {
    const advanced = $('#sync-advanced-connection');
    const openWebButton = $('#sync-open-web');
    const bindingPanel = $('#sync-binding-panel');
    const configAssistButton = $('#sync-load-config-assist');
    const configAssistSummary = $('#sync-config-assist-summary');
    const folderField = $('#sync-folder-field');
    const testButton = $('#sync-test-connection');
    if (!advanced || !openWebButton) return;

    const desktopMode = !!(window.desktopService && window.desktopService.isAvailable());
    const sidecarMode = desktopMode && AppState.syncDesktopStatus &&
        AppState.syncDesktopStatus.engineKind === 'sidecar';
    advanced.classList.toggle('hidden', desktopMode && (!AppState.syncDesktopStatus || sidecarMode));
    openWebButton.style.display = sidecarMode ? 'none' : '';
    if (bindingPanel) bindingPanel.classList.toggle('hidden', sidecarMode);
    if (configAssistButton) configAssistButton.style.display = sidecarMode ? 'none' : '';
    if (configAssistSummary) configAssistSummary.style.display = sidecarMode ? 'none' : '';
    if (folderField) folderField.style.display = sidecarMode ? 'none' : '';
    if (testButton) testButton.style.display = sidecarMode ? 'none' : '';
    const startButton = $('#sync-start-engine');
    if (startButton) {
        const healthyOrStarting = AppState.syncDesktopStatus &&
            (AppState.syncDesktopStatus.running || AppState.syncDesktopStatus.managed);
        startButton.style.display = sidecarMode && healthyOrStarting ? 'none' : '';
        startButton.textContent = sidecarMode ? '重试启动同步引擎' : '启动同步引擎';
    }

    if (sidecarMode) {
        $('#sync-api-key').value = '';
        $('#sync-remember-key').checked = false;
        AppState.sync.apiKey = null;
        AppState.sync.rememberKey = false;
        syncPersistSettings({ skipKey: true });
    }
    renderPairingPanel();
}

async function refreshPairingInfo() {
    try {
        AppState.pairingInfo = await syncService.getPairingInfo();
    } catch (err) {
        AppState.pairingInfo = null;
        const result = $('#sync-pairing-result');
        if (result) {
            result.className = 'sync-test-result error';
            result.textContent = err.message || '无法读取设备配对信息。';
        }
    }
    renderPairingPanel();
}

function renderPairingPanel() {
    const panel = $('#sync-pairing-panel');
    const localId = $('#sync-local-device-id');
    const devicesContainer = $('#sync-paired-devices');
    if (!panel || !localId || !devicesContainer) return;

    const status = AppState.syncDesktopStatus;
    const sidecarMode = status && status.engineKind === 'sidecar';
    panel.classList.toggle('hidden', !(sidecarMode && status.running));
    if (!sidecarMode || !status.running) return;

    const info = AppState.pairingInfo;
    localId.textContent = info && info.localDeviceId
        ? info.localDeviceId
        : '正在读取本机设备代码...';
    renderLocalDeviceQr(info && info.localDeviceQrSvg);
    devicesContainer.innerHTML = '';
    if (!info || !Array.isArray(info.devices)) return;

    const connections = info.connections && info.connections.connections
        ? info.connections.connections
        : {};
    const remoteDevices = info.devices.filter(device =>
        device && device.deviceID && device.deviceID !== info.localDeviceId
    );
    if (!remoteDevices.length) {
        const empty = document.createElement('span');
        empty.className = 'sync-device-empty';
        empty.textContent = '尚未添加其他设备';
        devicesContainer.appendChild(empty);
        return;
    }

    remoteDevices.forEach(device => {
        const row = document.createElement('div');
        row.className = 'sync-paired-device';
        const label = document.createElement('span');
        label.textContent = (device.name || '未命名设备') + ' · ' + device.deviceID;
        const state = document.createElement('span');
        state.className = 'sync-paired-device-state';
        state.textContent = connections[device.deviceID] && connections[device.deviceID].connected
            ? '已连接'
            : '等待对方确认';
        row.appendChild(label);
        row.appendChild(state);
        devicesContainer.appendChild(row);
    });
}

function renderLocalDeviceQr(svgText) {
    const image = $('#sync-local-device-qr-image');
    const button = $('#sync-toggle-device-qr');
    if (!image || !button) return;

    if (AppState.pairingQrUrl) {
        URL.revokeObjectURL(AppState.pairingQrUrl);
        AppState.pairingQrUrl = null;
    }
    image.removeAttribute('src');
    button.disabled = !svgText;
    if (!svgText) return;

    AppState.pairingQrUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    image.src = AppState.pairingQrUrl;
}

function onToggleLocalDeviceQr() {
    const container = $('#sync-local-device-qr');
    const button = $('#sync-toggle-device-qr');
    if (!container || !button || button.disabled) return;
    const willShow = container.classList.contains('hidden');
    container.classList.toggle('hidden', !willShow);
    button.setAttribute('aria-expanded', String(willShow));
    button.textContent = willShow ? '收起二维码' : '二维码';
}

async function onCopyLocalDeviceId() {
    const id = AppState.pairingInfo && AppState.pairingInfo.localDeviceId;
    const result = $('#sync-pairing-result');
    if (!id) return;
    try {
        await navigator.clipboard.writeText(id);
        result.className = 'sync-test-result success';
        result.textContent = '本机设备代码已复制。';
    } catch (err) {
        result.className = 'sync-test-result error';
        result.textContent = '复制失败，请手动选中设备代码。';
    }
}

function renderPairingPreview(preview) {
    const container = $('#sync-pairing-preview');
    const confirmButton = $('#sync-confirm-pairing');
    if (!container || !confirmButton) return;
    container.innerHTML = '';
    container.classList.remove('error');
    container.classList.toggle('hidden', !preview);
    confirmButton.classList.toggle('hidden', !(preview && preview.confirmationToken));
    if (!preview) return;

    const title = document.createElement('strong');
    title.textContent = '确认配对信息';
    container.appendChild(title);
    [
        '设备：' + preview.deviceName,
        '设备代码：' + preview.remoteDeviceId,
        '共享内容：默认笔记文件夹',
        preview.message,
    ].forEach(value => {
        const line = document.createElement('span');
        line.textContent = value;
        container.appendChild(line);
    });
}

async function onPreviewDevicePairing() {
    const result = $('#sync-pairing-result');
    result.className = 'sync-test-result';
    result.textContent = '正在检查设备代码...';
    try {
        AppState.pairingPreview = await syncService.previewDevicePairing(
            $('#sync-pair-device-id').value,
            $('#sync-pair-device-name').value
        );
        renderPairingPreview(AppState.pairingPreview);
        result.className = 'sync-test-result success';
        result.textContent = '设备代码有效。请核对摘要后再次确认。';
    } catch (err) {
        AppState.pairingPreview = null;
        renderPairingPreview(null);
        result.className = 'sync-test-result error';
        result.textContent = err.message || '设备代码检查失败。';
    }
}

async function onConfirmDevicePairing() {
    const preview = AppState.pairingPreview;
    const button = $('#sync-confirm-pairing');
    const result = $('#sync-pairing-result');
    if (!preview || !preview.confirmationToken) return;
    button.disabled = true;
    result.className = 'sync-test-result';
    result.textContent = '正在添加设备并共享默认笔记文件夹...';
    try {
        const applied = await syncService.confirmDevicePairing(preview.confirmationToken);
        AppState.pairingPreview = null;
        renderPairingPreview(null);
        $('#sync-pair-device-id').value = '';
        result.className = 'sync-test-result success';
        result.textContent = applied.message;
        await refreshPairingInfo();
        if (AppState.sync.connected) await onSyncRefreshStatus();
    } catch (err) {
        result.className = 'sync-test-result error';
        result.textContent = err.message || '设备配对失败。';
    } finally {
        button.disabled = false;
    }
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
