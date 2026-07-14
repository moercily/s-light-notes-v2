/* ============================================
   s-light notes — Syncthing 同步状态层
   第一轮只做连接验证，不修改 Syncthing 配置
   ============================================ */

const SyncStatus = {
    DISABLED: 'disabled',
    DISCONNECTED: 'disconnected',
    CONNECTED: 'connected',
    ERROR: 'error',
};

function syncInitState() {
    if (!AppState.sync) {
        AppState.sync = {
            enabled: false,
            apiBase: 'http://127.0.0.1:8384',
            apiKey: null,
            rememberKey: false,
            connected: false,
            folderId: null,
            folderStatus: null,
            devices: [],
            folders: [],
            connections: null,
            completions: [],
            deviceId: null,
            defaultFolderTemplate: null,
            defaultDeviceTemplate: null,
            restartRequired: null,
            folderConfigPreview: null,
            lastScanRequestedAt: null,
            _scanTimer: null,
            status: SyncStatus.DISABLED,
            lastCheckedAt: null,
            lastError: null,
        };
    }

    const savedApiBase = localStorage.getItem('s-light-sync-api-base');
    if (savedApiBase) AppState.sync.apiBase = savedApiBase;

    const rememberKey = localStorage.getItem('s-light-sync-remember-key') === 'true';
    AppState.sync.rememberKey = rememberKey;
    if (rememberKey) {
        AppState.sync.apiKey = localStorage.getItem('s-light-sync-api-key') || null;
    }

    AppState.sync.folderId = localStorage.getItem('s-light-sync-folder-id') || null;
}

function syncNormalizeApiBase(apiBase) {
    const value = (apiBase || '').trim() || 'http://127.0.0.1:8384';
    return value.replace(/\/+$/, '');
}

async function syncFetch(path, options = {}) {
    const apiBase = syncNormalizeApiBase(options.apiBase || AppState.sync.apiBase);
    const headers = new Headers(options.headers || {});
    const apiKey = options.apiKey !== undefined ? options.apiKey : AppState.sync.apiKey;

    if (apiKey) headers.set('X-API-Key', apiKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 5000);

    try {
        const response = await fetch(apiBase + path, {
            method: options.method || 'GET',
            headers: headers,
            signal: controller.signal,
        });

        if (!response.ok) {
            const err = new Error('Syncthing API 响应失败');
            err.status = response.status;
            err.response = response;
            throw err;
        }

        return response;
    } finally {
        clearTimeout(timeout);
    }
}

async function syncPing(apiBase) {
    try {
        const response = await syncFetch('/rest/noauth/health', {
            apiBase: apiBase,
            apiKey: null,
        });
        return response.json();
    } catch (err) {
        const probe = await syncProbeReachability(apiBase);
        if (probe.reachable) {
            const corsErr = new Error('Syncthing REST API blocked by browser CORS policy');
            corsErr.code = 'cors';
            throw corsErr;
        }
        throw err;
    }
}

async function syncGetSystemStatus(apiBase, apiKey) {
    const response = await syncFetch('/rest/system/status', {
        apiBase: apiBase,
        apiKey: apiKey,
    });
    return response.json();
}

async function syncGetFolders(apiBase, apiKey) {
    const response = await syncFetch('/rest/config/folders', {
        apiBase: apiBase,
        apiKey: apiKey,
    });
    return response.json();
}

async function syncGetDevices(apiBase, apiKey) {
    const response = await syncFetch('/rest/config/devices', {
        apiBase: apiBase,
        apiKey: apiKey,
    });
    return response.json();
}

async function syncGetConnections(apiBase, apiKey) {
    const response = await syncFetch('/rest/system/connections', {
        apiBase: apiBase,
        apiKey: apiKey,
    });
    return response.json();
}

async function syncGetFolderStatus(apiBase, apiKey, folderId) {
    if (!folderId) return null;
    const response = await syncFetch('/rest/db/status?folder=' + encodeURIComponent(folderId), {
        apiBase: apiBase,
        apiKey: apiKey,
    });
    return response.json();
}

async function syncScanFolder(apiBase, apiKey, folderId) {
    const id = folderId || (AppState.sync && AppState.sync.folderId);
    if (!id) {
        const err = new Error('未绑定 Syncthing 文件夹，无法扫描。');
        err.code = 'missingFolder';
        throw err;
    }

    const response = await syncFetch('/rest/db/scan?folder=' + encodeURIComponent(id), {
        apiBase: apiBase,
        apiKey: apiKey,
        method: 'POST',
        timeout: 10000,
    });
    return response.json().catch(() => ({}));
}

async function syncGetDeviceCompletion(apiBase, apiKey, folderId, deviceId) {
    const response = await syncFetch('/rest/db/completion?folder=' +
        encodeURIComponent(folderId) + '&device=' + encodeURIComponent(deviceId), {
        apiBase: apiBase,
        apiKey: apiKey,
    });
    return response.json();
}

async function syncGetDefaultFolderTemplate(apiBase, apiKey) {
    const response = await syncFetch('/rest/config/defaults/folder', {
        apiBase: apiBase,
        apiKey: apiKey,
    });
    return response.json();
}

async function syncGetDefaultDeviceTemplate(apiBase, apiKey) {
    const response = await syncFetch('/rest/config/defaults/device', {
        apiBase: apiBase,
        apiKey: apiKey,
    });
    return response.json();
}

async function syncGetRestartRequired(apiBase, apiKey) {
    const response = await syncFetch('/rest/config/restart-required', {
        apiBase: apiBase,
        apiKey: apiKey,
    });
    return response.json();
}

async function syncLoadConfigAssistState(apiBase, apiKey) {
    const normalizedBase = syncNormalizeApiBase(apiBase || AppState.sync.apiBase);
    const key = apiKey !== undefined ? apiKey : AppState.sync.apiKey;
    const [folderTemplate, deviceTemplate, restartRequired] = await Promise.all([
        syncGetDefaultFolderTemplate(normalizedBase, key),
        syncGetDefaultDeviceTemplate(normalizedBase, key),
        syncGetRestartRequired(normalizedBase, key),
    ]);

    AppState.sync.defaultFolderTemplate = folderTemplate || null;
    AppState.sync.defaultDeviceTemplate = deviceTemplate || null;
    AppState.sync.restartRequired = restartRequired;

    return {
        folderTemplate: AppState.sync.defaultFolderTemplate,
        deviceTemplate: AppState.sync.defaultDeviceTemplate,
        restartRequired: AppState.sync.restartRequired,
    };
}

async function syncLoadReadOnlyState(apiBase, apiKey) {
    const normalizedBase = syncNormalizeApiBase(apiBase);
    const key = (apiKey || '').trim();
    const [status, folders, devices, connections] = await Promise.all([
        syncGetSystemStatus(normalizedBase, key),
        syncGetFolders(normalizedBase, key),
        syncGetDevices(normalizedBase, key),
        syncGetConnections(normalizedBase, key),
    ]);

    AppState.sync.folders = Array.isArray(folders) ? folders : [];
    AppState.sync.devices = Array.isArray(devices) ? devices : [];
    AppState.sync.connections = connections || null;
    AppState.sync.deviceId = status.myID || status.myId || '';
    AppState.sync.folderStatus = await syncLoadSelectedFolderStatus(normalizedBase, key);
    AppState.sync.completions = await syncLoadDeviceCompletions(normalizedBase, key);

    return {
        status: status,
        folders: AppState.sync.folders,
        devices: AppState.sync.devices,
        connections: AppState.sync.connections,
        folderStatus: AppState.sync.folderStatus,
        completions: AppState.sync.completions,
        deviceId: AppState.sync.deviceId,
    };
}

async function syncLoadSelectedFolderStatus(apiBase, apiKey) {
    if (!AppState.sync.folderId) return null;
    const exists = AppState.sync.folders.some(folder => folder.id === AppState.sync.folderId);
    if (!exists) {
        AppState.sync.folderId = null;
        syncPersistSettings();
        return null;
    }

    try {
        return await syncGetFolderStatus(apiBase, apiKey, AppState.sync.folderId);
    } catch (err) {
        return null;
    }
}

async function syncLoadDeviceCompletions(apiBase, apiKey) {
    if (!AppState.sync.folderId || !AppState.sync.connections || !AppState.sync.connections.connections) {
        return [];
    }

    const connectedDeviceIds = Object.entries(AppState.sync.connections.connections)
        .filter(([, conn]) => conn && conn.connected)
        .map(([deviceId]) => deviceId)
        .filter(deviceId => deviceId && deviceId !== AppState.sync.deviceId);

    const completionResults = await Promise.all(connectedDeviceIds.map(async (deviceId) => {
        try {
            const completion = await syncGetDeviceCompletion(apiBase, apiKey, AppState.sync.folderId, deviceId);
            return {
                deviceId: deviceId,
                completion: completion.completion,
                needItems: completion.needItems,
            };
        } catch (err) {
            return null;
        }
    }));

    return completionResults.filter(Boolean);
}

async function syncTestConnection(apiBase, apiKey, rememberKey) {
    const normalizedBase = syncNormalizeApiBase(apiBase);
    const key = (apiKey || '').trim();

    AppState.sync.apiBase = normalizedBase;
    AppState.sync.apiKey = key || null;
    AppState.sync.rememberKey = !!rememberKey;
    AppState.sync.enabled = true;
    AppState.sync.lastError = null;

    try {
        await syncPing(normalizedBase);
        const readOnlyState = await syncLoadReadOnlyState(normalizedBase, key);

        AppState.sync.connected = true;
        AppState.sync.status = SyncStatus.CONNECTED;
        AppState.sync.lastCheckedAt = Date.now();
        AppState.sync.lastError = null;
        syncPersistSettings();

        return {
            ok: true,
            ...readOnlyState,
        };
    } catch (err) {
        const normalized = syncNormalizeError(err);
        AppState.sync.connected = false;
        AppState.sync.status = SyncStatus.ERROR;
        AppState.sync.lastCheckedAt = Date.now();
        AppState.sync.lastError = normalized;
        syncPersistSettings({ skipKey: !rememberKey });

        return {
            ok: false,
            error: normalized,
        };
    }
}

function syncPersistSettings(options = {}) {
    localStorage.setItem('s-light-sync-api-base', AppState.sync.apiBase);
    localStorage.setItem('s-light-sync-remember-key', AppState.sync.rememberKey ? 'true' : 'false');

    if (AppState.sync.rememberKey && !options.skipKey) {
        localStorage.setItem('s-light-sync-api-key', AppState.sync.apiKey || '');
    } else {
        localStorage.removeItem('s-light-sync-api-key');
    }

    if (AppState.sync.folderId) {
        localStorage.setItem('s-light-sync-folder-id', AppState.sync.folderId);
    } else {
        localStorage.removeItem('s-light-sync-folder-id');
    }
}

function syncSetFolderId(folderId) {
    AppState.sync.folderId = folderId || null;
    AppState.sync.folderStatus = null;
    AppState.sync.completions = [];
    syncPersistSettings();
}

function syncCanScan(folderId) {
    return !!(AppState.sync &&
        AppState.sync.enabled &&
        AppState.sync.connected &&
        (folderId || AppState.sync.folderId));
}

function syncGetScanDisabledReason() {
    if (!AppState.sync || !AppState.sync.enabled) return '请先测试连接';
    if (!AppState.sync.connected) return '请先连接 Syncthing';
    if (!AppState.sync.folderId) return '请先绑定 Syncthing 文件夹';
    return '';
}

async function syncTriggerFolderScan(apiBase, apiKey, folderId) {
    if (!syncCanScan(folderId)) {
        const err = new Error(syncGetScanDisabledReason() || '当前无法扫描。');
        err.code = 'scanUnavailable';
        throw err;
    }

    const base = syncNormalizeApiBase(apiBase || AppState.sync.apiBase);
    const key = apiKey !== undefined ? apiKey : AppState.sync.apiKey;
    const result = await syncScanFolder(base, key, folderId || AppState.sync.folderId);
    AppState.sync.lastScanRequestedAt = Date.now();
    return result;
}

function syncScheduleScanAfterSave() {
    if (!syncCanScan()) return;
    if (AppState.storageMode !== 'fsa') return;

    const now = Date.now();
    const interval = 30000;
    const last = AppState.sync.lastScanRequestedAt || 0;
    const wait = Math.max(0, interval - (now - last));

    if (AppState.sync._scanTimer) return;
    AppState.sync._scanTimer = setTimeout(async () => {
        AppState.sync._scanTimer = null;
        try {
            await syncTriggerFolderScan();
            await syncLoadReadOnlyState(AppState.sync.apiBase, AppState.sync.apiKey);
        } catch (err) {
            AppState.sync.lastError = syncNormalizeError(err);
        }
        if (typeof updateSyncStatusUI === 'function') updateSyncStatusUI();
    }, wait);
}

async function syncProbeReachability(apiBase) {
    const normalizedBase = syncNormalizeApiBase(apiBase);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
        const response = await fetch(normalizedBase + '/rest/noauth/health', {
            mode: 'no-cors',
            signal: controller.signal,
        });
        return {
            reachable: response.type === 'opaque' || response.ok,
            type: response.type,
        };
    } catch (err) {
        return {
            reachable: false,
            error: err,
        };
    } finally {
        clearTimeout(timeout);
    }
}

function syncNormalizeError(err) {
    if (err && err.type && err.message) {
        return {
            type: err.type,
            message: err.message,
        };
    }

    if (err.code === 'missingFolder' || err.code === 'scanUnavailable') {
        return {
            type: 'syncSetup',
            message: err.message,
        };
    }

    if (err.code === 'cors') {
        return {
            type: 'cors',
            message: 'Syncthing 已运行，但浏览器阻止读取 REST API（CORS/跨源限制）。纯 Web 版无法直接连接，需要本地助手/代理或 Syncthing 允许跨源访问。',
        };
    }

    if (err.name === 'AbortError') {
        return {
            type: 'timeout',
            message: '连接超时，请确认 Syncthing 正在运行。',
        };
    }

    if (err.status === 401 || err.status === 403) {
        return {
            type: 'auth',
            message: '认证失败，请检查 API Key。',
        };
    }

    if (err.status) {
        return {
            type: 'http',
            message: 'Syncthing API 返回错误：HTTP ' + err.status,
        };
    }

    return {
        type: 'network',
        message: '无法连接 Syncthing。可能是未运行、地址错误，或浏览器安全策略阻止了请求。',
    };
}

function syncGetSummaryText() {
    if (!AppState.sync || !AppState.sync.enabled) return '同步：未配置';
    if (AppState.sync.connected) return syncGetConnectedSummary();
    if (AppState.sync.lastError) {
        if (AppState.sync.lastError.type === 'cors') return '同步：浏览器限制';
        return '同步：' + AppState.sync.lastError.message;
    }
    return '同步：未连接';
}

function syncGetConnectedSummary() {
    const folderStatus = AppState.sync.folderStatus;
    if (folderStatus && folderStatus.state) {
        return '同步：' + syncTranslateFolderState(folderStatus.state);
    }

    const connections = AppState.sync.connections;
    if (connections && connections.connections) {
        const connectedCount = Object.values(connections.connections)
            .filter(conn => conn && conn.connected)
            .length;
        return '同步：' + connectedCount + ' 台设备已连接';
    }

    return '同步：已连接';
}

function syncGetDeviceSummary() {
    const connections = AppState.sync && AppState.sync.connections;
    const devices = AppState.sync && AppState.sync.devices ? AppState.sync.devices : [];

    if (!connections || !connections.connections) {
        return devices.length ? '设备：' + devices.length + ' 台已配置' : '设备：暂无信息';
    }

    const connectedCount = Object.values(connections.connections)
        .filter(conn => conn && conn.connected)
        .length;
    return '设备：' + connectedCount + ' 台已连接 / ' + devices.length + ' 台已配置';
}

function syncGetFolderLabel(folder) {
    if (!folder) return '';
    const label = folder.label || folder.id || '未命名文件夹';
    return folder.path ? label + ' — ' + folder.path : label;
}

function syncGetFolderSummary() {
    if (!AppState.sync || !AppState.sync.folderId) return '文件夹：未绑定';
    const folderStatus = AppState.sync.folderStatus;
    if (!folderStatus) return '文件夹：已绑定，等待刷新状态';

    const state = syncTranslateFolderState(folderStatus.state);
    const needCount = getSyncthingNeedCount(folderStatus);
    if (needCount > 0) return '文件夹：' + state + '，待同步 ' + needCount + ' 项';
    return '文件夹：' + state;
}

function syncGetCompletionSummary() {
    const completions = AppState.sync && AppState.sync.completions ? AppState.sync.completions : [];
    if (!AppState.sync || !AppState.sync.folderId) return '完成度：未绑定文件夹';
    if (!completions.length) return '完成度：暂无远端设备信息';

    const completeCount = completions.filter(item => item.completion >= 100).length;
    const syncing = completions.filter(item => item.completion < 100);
    if (!syncing.length) return '完成度：' + completeCount + ' 台远端设备已完成';

    const lowest = syncing.reduce((min, item) => {
        return item.completion < min.completion ? item : min;
    }, syncing[0]);
    return '完成度：' + completeCount + ' 台已完成，最低 ' + Math.round(lowest.completion) + '%';
}

function syncGetConfigAssistSummary() {
    if (!AppState.sync || !AppState.sync.connected) return '配置辅助：请先连接 Syncthing';

    const hasFolder = !!AppState.sync.defaultFolderTemplate;
    const hasDevice = !!AppState.sync.defaultDeviceTemplate;
    const restart = AppState.sync.restartRequired;
    const parts = [];
    parts.push(hasFolder ? 'folder 模板已读取' : 'folder 模板未读取');
    parts.push(hasDevice ? 'device 模板已读取' : 'device 模板未读取');

    if (syncIsRestartRequired(restart) === true) {
        parts.push('需要重启');
    } else if (syncIsRestartRequired(restart) === false) {
        parts.push('无需重启');
    } else {
        parts.push('重启状态未知');
    }

    return '配置辅助：' + parts.join('，');
}

function syncIsRestartRequired(value) {
    if (typeof value === 'boolean') return value;
    if (!value || typeof value !== 'object') return null;
    if (typeof value.restartRequired === 'boolean') return value.restartRequired;
    if (typeof value.requiresRestart === 'boolean') return value.requiresRestart;
    return null;
}

function syncTranslateFolderState(state) {
    const labels = {
        idle: '已同步',
        scanning: '扫描中',
        scanWaiting: '等待扫描',
        syncPreparing: '准备同步',
        syncing: '同步中',
        syncWaiting: '等待同步',
        error: '有错误',
    };
    return labels[state] || (state || '状态未知');
}

function getSyncthingNeedCount(folderStatus) {
    if (!folderStatus) return 0;
    if (typeof folderStatus.needTotalItems === 'number') return folderStatus.needTotalItems;
    if (folderStatus.need && typeof folderStatus.need.totalItems === 'number') return folderStatus.need.totalItems;
    return 0;
}
