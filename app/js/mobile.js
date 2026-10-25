/* ============================================
   s-light notes — 移动端入口
   独立移动壳，Android 使用原生 Markdown，PWA 回退到 IndexedDB
   ============================================ */

const AppState = {
    currentNoteId: null,
    notes: [],
    storageMode: null,
    folderHandle: null,
    isDirty: false,
    searchQuery: '',
    _showTrash: false,
    _theme: null,
    _lastSavedTime: null,
    _installPrompt: null,
    _view: 'list',
    _pairingPreview: null,
    _syncStatus: null,
    _currentConflict: null,
    _nativeDialogActive: false,
};

async function initMobileApp() {
    initMobileTheme();
    const preferences = document.createElement('section');
    preferences.className = 'mobile-appearance';
    const heading = document.createElement('h2'); heading.textContent = '编辑器';
    preferences.append(heading);
    $('#mobile-settings-note').after(preferences);
    Appearance.mount(preferences);
    bindMobileEvents();
    initMobileViewport();
    initMobileNavigation();

    try {
        if (window.mobileStorageService && window.mobileStorageService.isAvailable()) {
            await window.mobileStorageService.ensure();
            AppState.storageMode = 'android';
            $('#mobile-settings-note').textContent = '笔记保存为本机 Markdown 文件，并由应用安全管理。';
        } else {
            await initIDB();
            AppState.storageMode = 'idb';
        }
        initMobileSyncEntry();
        await refreshMobileNotes();
        setMobileSaveStatus('就绪');
    } catch (err) {
        console.error('移动端初始化失败:', err);
        setMobileSaveStatus('初始化失败');
    }
}

function bindMobileEvents() {
    $('#mobile-new-note').addEventListener('click', onMobileNewNote);
    $('#mobile-back').addEventListener('click', onMobileBackToList);
    $('#mobile-settings').addEventListener('click', () => showMobileView('settings'));
    $('#mobile-settings-back').addEventListener('click', navigateMobileBack);
    $('#mobile-search').addEventListener('input', (e) => {
        AppState.searchQuery = e.target.value;
        renderMobileNotes();
    });
    const editor = $('#mobile-note-editor');
    editor.addEventListener('input', onMobileEditorInput);
    initEditorComposition(editor, onMobileEditorInput);
    editor.addEventListener('paste', event => handleImagePaste(event, editor));
    editor.addEventListener('drop', event => handleImageDrop(event, editor));
    $('#mobile-save-copy').addEventListener('click', async () => {
        try {
            const session = AppState._editSession;
            const content = getMobileEditorContent();
            const result = await saveNote(null, content);
            if (session !== AppState._editSession) return;
            AppState.currentNoteId = result.id; AppState._version = result.version;
            AppState.isDirty = content !== getMobileEditorContent();
            $('#mobile-save-copy').hidden = true;
            setMobileSaveStatus('已保留副本');
            await refreshMobileNotes();
        } catch (error) { setMobileSaveStatus('保留副本失败，内容仍保留'); }
    });
    $('#mobile-delete-note').addEventListener('click', onMobileDeleteCurrent);
    $('#mobile-import').addEventListener('click', onMobileImport);
    $('#mobile-export').addEventListener('click', onMobileExport);
    $('#mobile-trash').addEventListener('click', onMobileToggleTrash);
    $('#mobile-install').addEventListener('click', onMobileInstall);
    $('#mobile-theme-toggle').addEventListener('click', toggleMobileTheme);
    $('#mobile-sync').addEventListener('click', openMobileSyncCenter);
    $('#mobile-sync-back').addEventListener('click', navigateMobileBack);
    $('#mobile-sync-refresh').addEventListener('click', refreshMobileSyncCenter);
    $('#mobile-sync-start').addEventListener('click', onMobileSyncStart);
    $('#mobile-sync-stop').addEventListener('click', onMobileSyncStop);
    $('#mobile-sync-scan-folder').addEventListener('click', onMobileScanFolder);
    $('#mobile-copy-device-code').addEventListener('click', onMobileCopyDeviceCode);
    $('#mobile-scan-device-qr').addEventListener('click', onMobileScanDeviceQr);
    $('#mobile-preview-pairing').addEventListener('click', onMobilePreviewPairing);
    $('#mobile-confirm-pairing').addEventListener('click', onMobileConfirmPairing);
    $('#mobile-opportunistic-sync').addEventListener('change', onMobileBackgroundPolicyChange);
    $('#mobile-unmetered-only').addEventListener('change', onMobileBackgroundPolicyChange);
    $('#mobile-background-session').addEventListener('change', onMobileBackgroundPolicyChange);
    $('#mobile-request-notification').addEventListener('click', onMobileRequestNotificationPermission);
    $('#mobile-open-battery-settings').addEventListener('click', onMobileOpenBatterySettings);
    $('#mobile-conflict-keep').addEventListener('click', onMobileConflictKeep);
    $('#mobile-conflict-copy').addEventListener('click', onMobileConflictCopy);
    $('#mobile-conflict-trash').addEventListener('click', onMobileConflictTrash);
    window.addEventListener('beforeinstallprompt', onMobileBeforeInstallPrompt);
    document.addEventListener('visibilitychange', onMobileVisibilityChange);

    $$('#mobile-format-bar button').forEach(btn => {
        btn.addEventListener('click', () => applyMobileFormat(btn.dataset.format));
    });
}

function initMobileSyncEntry() {
    const available = AppState.storageMode === 'android' &&
        window.androidSync && window.androidSync.isAvailable();
    $('#mobile-sync').hidden = !available;
}

async function openMobileSyncCenter() {
    showMobileView('sync');
    await Promise.all([refreshMobileSyncCenter(), refreshMobileBackgroundPolicy()]);
}

async function refreshMobileSyncCenter() {
    if (!window.androidSync || !window.androidSync.isAvailable()) return;
    setMobileSyncMessage('正在检查', '正在读取本机同步引擎状态。');
    try {
        const [status, conflicts] = await Promise.all([
            window.androidSync.getStatus(),
            window.androidSync.getConflicts(),
        ]);
        renderMobileConflicts(conflicts);
        AppState._syncStatus = status;
        if (status.localNetworkPermissionRequired && !status.localNetworkPermissionGranted) {
            setMobileSyncMessage(
                '需要局域网权限',
                '允许附近设备后，才能发现并连接你的其他设备。笔记编辑不受影响。',
            );
            $('#mobile-sync-start').disabled = false;
            $('#mobile-sync-stop').disabled = true;
            $('#mobile-sync-scan-folder').disabled = true;
            clearMobilePairingInfo();
            return;
        }
        const stateLabels = {
            stopped: '已停止',
            starting: '正在启动',
            running: '同步中',
            stopping: '正在停止',
            error: '需要处理',
        };
        setMobileSyncMessage(stateLabels[status.engineState] || '未知状态', status.message || '');
        $('#mobile-sync-start').disabled = status.running || status.engineState === 'starting';
        $('#mobile-sync-stop').disabled = status.engineState === 'stopped';
        $('#mobile-sync-scan-folder').disabled = !status.running;
        if (!status.running) {
            clearMobilePairingInfo();
            if (status.engineState === 'starting' || status.engineState === 'stopping') {
                setTimeout(refreshMobileSyncCenter, 800);
            }
            return;
        }
        const info = await window.androidSync.getPairingInfo();
        renderMobilePairingInfo(info);
    } catch (err) {
        setMobileSyncMessage('无法连接', err.message || String(err));
    }
}

function setMobileSyncMessage(state, message) {
    $('#mobile-sync-state').textContent = state;
    $('#mobile-sync-message').textContent = message;
}

function clearMobilePairingInfo() {
    $('#mobile-device-code').textContent = '同步引擎就绪后显示';
    $('#mobile-copy-device-code').disabled = true;
    $('#mobile-sync-devices').innerHTML = '<li>同步引擎尚未就绪</li>';
    $('#mobile-folder-state').textContent = '笔记文件夹：等待状态';
}

function renderMobilePairingInfo(info) {
    $('#mobile-device-code').textContent = info.localDeviceId || '设备码不可用';
    $('#mobile-copy-device-code').disabled = !info.localDeviceId;
    const list = $('#mobile-sync-devices');
    list.innerHTML = '';
    const devices = Array.isArray(info.devices) ? info.devices : [];
    if (devices.length === 0) {
        list.innerHTML = '<li>暂无设备</li>';
    } else {
        devices.forEach(device => {
            const item = document.createElement('li');
            const name = document.createElement('strong');
            const state = document.createElement('span');
            name.textContent = device.name || '另一台设备';
            state.textContent = device.connected ? '已连接' : '等待连接';
            item.append(name, state);
            list.appendChild(item);
        });
    }
    const folder = info.folderStatus || {};
    const state = folder.state === 'idle' ? '已同步' : (folder.state || '等待状态');
    $('#mobile-folder-state').textContent = '笔记文件夹：' + state +
        (Number.isFinite(folder.needFiles) && folder.needFiles > 0 ? '，待接收 ' + folder.needFiles + ' 个文件' : '');
}

function renderMobileConflicts(conflicts) {
    const list = $('#mobile-sync-conflicts');
    list.innerHTML = '';
    if (!Array.isArray(conflicts) || conflicts.length === 0) {
        list.innerHTML = '<li>当前没有冲突副本</li>';
        return;
    }
    conflicts.forEach(conflict => {
        const item = document.createElement('li');
        const name = document.createElement('strong');
        const time = document.createElement('span');
        name.textContent = conflict.sourceId || conflict.id;
        time.textContent = formatDate(conflict.updatedAt);
        item.append(name, time);
        list.appendChild(item);
    });
}

async function onMobileSyncStart() {
    setMobileSyncMessage('正在启动', '正在启动本机 P2P 同步引擎。');
    try {
        const status = AppState._syncStatus || await window.androidSync.getStatus();
        if (status.localNetworkPermissionRequired && !status.localNetworkPermissionGranted) {
            const granted = await window.androidSync.requestLocalNetworkPermission();
            if (!granted) {
                setMobileSyncMessage(
                    '未允许局域网同步',
                    '你仍可正常编辑笔记，稍后可再次点击“启动同步”授权。',
                );
                return;
            }
        }
        await window.androidSync.startEngine();
        setTimeout(refreshMobileSyncCenter, 800);
    } catch (err) {
        setMobileSyncMessage('启动失败', err.message || String(err));
    }
}

async function onMobileSyncStop() {
    try {
        await window.androidSync.stopEngine();
        setTimeout(refreshMobileSyncCenter, 500);
    } catch (err) {
        setMobileSyncMessage('停止失败', err.message || String(err));
    }
}

async function onMobileScanFolder() {
    try {
        await window.androidSync.scanFolder();
        setMobileSyncMessage('已请求扫描', '正在检查本机笔记文件变化。');
        setTimeout(refreshMobileSyncCenter, 600);
    } catch (err) {
        setMobileSyncMessage('扫描失败', err.message || String(err));
    }
}

async function onMobileCopyDeviceCode() {
    const code = $('#mobile-device-code').textContent.trim();
    if (!code || code === '设备码不可用') return;
    try {
        await navigator.clipboard.writeText(code);
        setMobileSyncMessage('已复制', '本机设备码已复制。');
    } catch (err) {
        setMobileSyncMessage('复制失败', '请长按设备码进行复制。');
    }
}

async function onMobileScanDeviceQr() {
    const pairingMessage = $('#mobile-pairing-message');
    pairingMessage.hidden = true;
    pairingMessage.textContent = '';
    AppState._nativeDialogActive = true;
    try {
        const result = await window.androidSync.scanDeviceQr();
        if (!result || result.cancelled) {
            if (result?.reason === 'cameraPermission') {
                pairingMessage.textContent = '未获得相机权限，你仍可手动输入另一台设备的设备码。';
                pairingMessage.hidden = false;
            }
            return;
        }
        $('#mobile-remote-device-id').value = result.deviceId || '';
        await onMobilePreviewPairing();
    } catch (err) {
        pairingMessage.textContent = '扫码失败：' + (err.message || String(err));
        pairingMessage.hidden = false;
    } finally {
        AppState._nativeDialogActive = false;
    }
}

async function onMobilePreviewPairing() {
    const deviceId = $('#mobile-remote-device-id').value.trim();
    const deviceName = $('#mobile-remote-device-name').value.trim();
    AppState._pairingPreview = null;
    $('#mobile-pairing-preview').hidden = true;
    try {
        const preview = await window.androidSync.previewDevicePairing(deviceId, deviceName);
        AppState._pairingPreview = preview;
        $('#mobile-pairing-device').textContent = preview.deviceName + ' · ' + preview.remoteDeviceId;
        $('#mobile-pairing-summary').textContent = preview.message;
        $('#mobile-pairing-preview').hidden = false;
    } catch (err) {
        setMobileSyncMessage('设备码无效', err.message || String(err));
    }
}

async function onMobileConfirmPairing() {
    const preview = AppState._pairingPreview;
    if (!preview || !preview.confirmationToken) return;
    $('#mobile-confirm-pairing').disabled = true;
    try {
        const result = await window.androidSync.confirmDevicePairing(preview.confirmationToken);
        AppState._pairingPreview = null;
        $('#mobile-pairing-preview').hidden = true;
        $('#mobile-remote-device-id').value = '';
        setMobileSyncMessage('本机已确认', result.message || '设备已添加。');
        await refreshMobileSyncCenter();
    } catch (err) {
        setMobileSyncMessage('配对失败', err.message || String(err));
    } finally {
        $('#mobile-confirm-pairing').disabled = false;
    }
}

async function refreshMobileBackgroundPolicy() {
    try {
        const policy = await window.androidSync.getBackgroundPolicy();
        renderMobileBackgroundPolicy(policy);
    } catch (err) {
        $('#mobile-background-message').textContent = err.message || String(err);
    }
}

function renderMobileBackgroundPolicy(policy) {
    $('#mobile-opportunistic-sync').checked = Boolean(policy.opportunisticSync);
    $('#mobile-unmetered-only').checked = Boolean(policy.unmeteredOnly);
    $('#mobile-background-session').checked = Boolean(policy.backgroundSessionEnabled);
    $('#mobile-request-notification').hidden = Boolean(policy.notificationPermissionGranted);
    const stopReasons = {
        appBackground: '当前设置会在离开应用后停止持续同步。',
        backgroundPolicy: '持续后台同步已关闭。',
        notification: '已从系统通知停止同步。',
        systemTimeout: 'Android 已结束本次后台同步，请打开应用后继续。',
        localNetworkPermission: '需要允许附近设备后才能进行 P2P 同步。',
        opportunisticComplete: '最近一次短时机会同步已完成。',
        opportunisticFailed: '最近一次短时机会同步未完成，将由系统稍后重试。',
        user: '同步已由你手动停止。',
    };
    $('#mobile-background-message').textContent =
        stopReasons[policy.lastStopReason] ||
        (policy.backgroundSessionEnabled
            ? '离开应用后将继续同步，并显示系统通知。'
            : '应用打开时持续同步，离开后由系统安排短时机会同步。');
}

async function onMobileBackgroundPolicyChange(event) {
    const backgroundToggle = $('#mobile-background-session');
    if (event.target === backgroundToggle && backgroundToggle.checked) {
        const granted = await window.androidSync.requestNotificationPermission();
        if (!granted) {
            backgroundToggle.checked = false;
            $('#mobile-background-message').textContent =
                '未获得通知权限，应用打开时仍可正常同步。';
        }
    }
    try {
        const policy = await window.androidSync.setBackgroundPolicy({
            opportunisticSync: $('#mobile-opportunistic-sync').checked,
            unmeteredOnly: $('#mobile-unmetered-only').checked,
            backgroundSessionEnabled: backgroundToggle.checked,
        });
        renderMobileBackgroundPolicy(policy);
    } catch (err) {
        $('#mobile-background-message').textContent = err.message || String(err);
        await refreshMobileBackgroundPolicy();
    }
}

async function onMobileRequestNotificationPermission() {
    try {
        const granted = await window.androidSync.requestNotificationPermission();
        $('#mobile-background-message').textContent = granted
            ? '通知权限已允许，可选择离开应用后继续同步。'
            : '未获得通知权限，应用打开时仍可正常同步。';
        await refreshMobileBackgroundPolicy();
    } catch (err) {
        $('#mobile-background-message').textContent = err.message || String(err);
    }
}

async function onMobileOpenBatterySettings() {
    try {
        await window.androidSync.openBatterySettings();
    } catch (err) {
        $('#mobile-background-message').textContent = err.message || String(err);
    }
}

async function onMobileVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    if (AppState._nativeDialogActive) return;
    if (AppState._view === 'sync') {
        await Promise.all([refreshMobileSyncCenter(), refreshMobileBackgroundPolicy()]);
        return;
    }
    if (AppState.storageMode !== 'android') return;

    try {
        if (AppState.currentNoteId && !AppState.isDirty) {
            await openMobileNote(AppState.currentNoteId);
        } else if (!AppState.isDirty) {
            await refreshMobileNotes();
        }
    } catch (err) {
        console.warn('重新读取 Android 笔记失败:', err);
    }
}

function initMobileNavigation() {
    history.replaceState({ mobileView: 'list' }, '', location.href);
    window.addEventListener('popstate', async (event) => {
        const name = event.state && event.state.mobileView ? event.state.mobileView : 'list';
        if (AppState._view === 'editor' && AppState.isDirty) {
            await saveMobileCurrentNote();
            if (AppState.isDirty) {
                history.pushState({ mobileView: 'editor' }, '', location.href);
                return;
            }
        }
        activateMobileView(name);
        if (name === 'list') await refreshMobileNotes();
    });
}

function activateMobileView(name) {
    $$('.mobile-view').forEach(view => view.classList.remove('active'));
    $('#mobile-' + name + '-view').classList.add('active');
    AppState._view = name;
}

function showMobileView(name) {
    if (AppState._view === name) return;
    activateMobileView(name);
    history.pushState({ mobileView: name }, '', location.href);
}

function navigateMobileBack() {
    if (AppState._view === 'list') return;
    history.back();
}

async function refreshMobileNotes() {
    AppState.notes = await listNotes();
    renderMobileNotes();
}

function renderMobileNotes() {
    const list = $('#mobile-note-list');
    const query = AppState.searchQuery.trim().toLowerCase();
    const notes = query
        ? AppState.notes.filter(note =>
            note.title.toLowerCase().includes(query) ||
            note.content.toLowerCase().includes(query))
        : AppState.notes;

    list.innerHTML = '';
    $('#mobile-list-title').textContent = AppState._showTrash ? '回收站' : 's-light notes';
    $('#mobile-new-note').hidden = AppState._showTrash;
    $('#mobile-trash').textContent = AppState._showTrash ? '返回笔记列表' : '回收站';

    if (notes.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'mobile-empty';
        empty.textContent = query ? '没有匹配的笔记' : (AppState._showTrash ? '回收站为空' : '暂无笔记');
        list.appendChild(empty);
        return;
    }

    notes.forEach(note => {
        const item = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'mobile-note-item';
        btn.innerHTML = '<strong></strong><span></span>';
        btn.querySelector('strong').textContent = note.title || '未命名';
        if (note.isConflict) {
            const badge = document.createElement('small');
            badge.className = 'mobile-conflict-badge';
            badge.textContent = '冲突';
            btn.querySelector('strong').appendChild(badge);
        }
        btn.querySelector('span').textContent = formatDate(note.updatedAt);
        btn.addEventListener('click', () => openMobileNote(note.id));
        item.appendChild(btn);

        if (AppState._showTrash) {
            btn.disabled = true;
            const actions = document.createElement('div');
            actions.className = 'mobile-trash-actions';

            const restoreBtn = document.createElement('button');
            restoreBtn.type = 'button';
            restoreBtn.textContent = '恢复';
            restoreBtn.addEventListener('click', () => onMobileRestoreNote(note.id));

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'danger';
            deleteBtn.textContent = '永久删除';
            deleteBtn.addEventListener('click', () => onMobilePermanentlyDelete(note.id));

            actions.appendChild(restoreBtn);
            actions.appendChild(deleteBtn);
            item.appendChild(actions);
        }

        list.appendChild(item);
    });
}

let mobileNavigation = 0;
let mobileSaveQueue = Promise.resolve();
async function openMobileNote(id) {
    const navigation = ++mobileNavigation;
    if (AppState.isDirty) await saveMobileCurrentNote();
    if (AppState.isDirty) return;

    if (AppState.isDirty) return;
    const note = await readNote(id);
    if (navigation !== mobileNavigation || AppState.isDirty) return;
    if (!note) {
        await refreshMobileNotes();
        return;
    }

    AppState._editSession = (AppState._editSession || 0) + 1;
    AppState._version = note.version;
    AppState._currentNoteReadOnly = !!note.isConflict;
    AppState.currentNoteId = note.id;
    AppState._currentConflict = note.isConflict ? note : null;
    AppState.isDirty = false;
    setEditorMarkdown($('#mobile-note-editor'), note.content || '');
    $('#mobile-note-editor').contentEditable = note.isConflict ? 'false' : 'true';
    $('#mobile-conflict-actions').hidden = !note.isConflict;
    $('#mobile-format-bar').hidden = note.isConflict;
    $('#mobile-delete-note').hidden = note.isConflict;
    $('#mobile-note-title').textContent = (note.title || '未命名') + (note.isConflict ? ' · 冲突副本' : '');
    setMobileSaveStatus('已加载');
    $('#mobile-save-copy').hidden = true;
    showMobileView('editor');
}

async function onMobileNewNote() {
    const navigation = ++mobileNavigation;
    if (AppState.isDirty) await saveMobileCurrentNote();
    if (AppState.isDirty) return;

    if (navigation !== mobileNavigation || AppState.isDirty) return;
    AppState._editSession = (AppState._editSession || 0) + 1;
    AppState._version = null;
    AppState._currentNoteReadOnly = false;
    AppState._showTrash = false;
    AppState.currentNoteId = null;
    AppState._currentConflict = null;
    AppState.isDirty = false;
    setEditorMarkdown($('#mobile-note-editor'), '');
    $('#mobile-note-editor').contentEditable = 'true';
    $('#mobile-conflict-actions').hidden = true;
    $('#mobile-format-bar').hidden = false;
    $('#mobile-delete-note').hidden = false;
    $('#mobile-note-title').textContent = '新建笔记';
    setMobileSaveStatus('编辑中');
    showMobileView('editor');
    $('#mobile-note-editor').focus();
}

async function onMobileBackToList() {
    ++mobileNavigation;
    if (AppState.isDirty) await saveMobileCurrentNote();
    if (AppState.isDirty) return;
    await refreshMobileNotes();
    navigateMobileBack();
}

function onMobileEditorInput() {
    if (AppState._currentConflict || AppState._showTrash) return;
    AppState.isDirty = true;
    setMobileSaveStatus('未保存...');
    if (!AppState._composing) autoSaveMobileNote();
}

const autoSaveMobileNote = debounce(async () => {
    if (!AppState.isDirty || AppState._composing) return;
    const content = getMobileEditorContent();
    if (!content.trim() && !AppState.currentNoteId) return;
    await saveMobileCurrentNote();
}, 600);

function saveMobileCurrentNote() {
    const task = mobileSaveQueue.catch(() => {}).then(saveMobileSnapshot);
    mobileSaveQueue = task;
    return task;
}

async function saveMobileSnapshot() {
    if (AppState._composing || AppState._currentConflict || AppState._showTrash || !AppState.isDirty) return null;
    const session = AppState._editSession;
    const content = getMobileEditorContent();
    if (!content.trim() && !AppState.currentNoteId) return null;

    setMobileSaveStatus('保存中...');
    try {
        const result = await saveNote(AppState.currentNoteId, content);
        if (session !== AppState._editSession) return result;
        AppState.currentNoteId = result.id;
        AppState._version = result.version;
        AppState.isDirty = getMobileEditorContent() !== content;
        $('#mobile-note-title').textContent = result.title || '未命名';
        setMobileSaveStatus(AppState.isDirty ? '未保存...' : '已保存 ' + formatDate(result.updatedAt));
        await refreshMobileNotes();
        return result;
    } catch (err) {
        console.error('移动端保存失败:', err);
        setMobileSaveStatus(String(err).includes('NOTE_CONFLICT:') ? '原笔记已更新，请保留副本后重新打开。' : '保存失败，内容仍保留');
        $('#mobile-save-copy').hidden = false;
        return null;
    }
}

function getMobileEditorContent() {
    return htmlToMarkdown($('#mobile-note-editor'));
}

async function onMobileDeleteCurrent() {
    if (!AppState.currentNoteId) {
        $('#mobile-note-editor').innerHTML = '';
        navigateMobileBack();
        return;
    }

    if (!confirm('确定要删除这条笔记吗？笔记将移入回收站。')) return;
    await deleteNote(AppState.currentNoteId);
    AppState.currentNoteId = null;
    AppState.isDirty = false;
    $('#mobile-note-editor').innerHTML = '';
    await refreshMobileNotes();
    navigateMobileBack();
}

async function onMobileConflictKeep() {
    const conflict = AppState._currentConflict;
    if (!conflict) return;
    try {
        const result = await saveNote(null, conflict.content);
        AppState._currentConflict = null;
        await refreshMobileNotes();
        await openMobileNote(result.id);
        setMobileSaveStatus('已保留为新笔记');
    } catch (err) {
        setMobileSaveStatus('保留失败');
    }
}

async function onMobileConflictCopy() {
    const conflict = AppState._currentConflict;
    if (!conflict) return;
    try {
        await navigator.clipboard.writeText(conflict.content);
        setMobileSaveStatus('冲突内容已复制');
    } catch (err) {
        setMobileSaveStatus('复制失败');
    }
}

async function onMobileConflictTrash() {
    const conflict = AppState._currentConflict;
    if (!conflict) return;
    if (!confirm('确定把这个冲突副本移入回收站吗？')) return;
    await deleteNote(conflict.id);
    AppState._currentConflict = null;
    AppState.currentNoteId = null;
    $('#mobile-note-editor').innerHTML = '';
    $('#mobile-note-editor').contentEditable = 'true';
    $('#mobile-conflict-actions').hidden = true;
    $('#mobile-format-bar').hidden = false;
    $('#mobile-delete-note').hidden = false;
    await refreshMobileNotes();
    navigateMobileBack();
}

async function onMobileToggleTrash() {
    ++mobileNavigation;
    if (AppState.isDirty) await saveMobileCurrentNote();
    if (AppState.isDirty) return;
    AppState._showTrash = !AppState._showTrash;
    AppState.currentNoteId = null;
    await refreshMobileNotes();
    showMobileView('list');
}

async function onMobileRestoreNote(id) {
    try {
        await restoreNote(id);
        await refreshMobileNotes();
        setMobileSaveStatus('已恢复');
    } catch (err) {
        console.error('移动端恢复失败:', err);
        setMobileSaveStatus('恢复失败');
    }
}

async function onMobilePermanentlyDelete(id) {
    if (!confirm('确定要永久删除这条笔记吗？')) return;

    try {
        await permanentlyDelete(id);
        await refreshMobileNotes();
        setMobileSaveStatus('已永久删除');
    } catch (err) {
        console.error('移动端永久删除失败:', err);
        setMobileSaveStatus('删除失败');
    }
}

async function onMobileImport() {
    try {
        AppState._showTrash = false;
        const count = await importNotes();
        await refreshMobileNotes();
        setMobileSaveStatus(count > 0 ? '已导入 ' + count + ' 条笔记' : '未导入');
        showMobileView('list');
    } catch (err) {
        console.error('移动端导入失败:', err);
        setMobileSaveStatus('导入失败');
    }
}

async function onMobileExport() {
    try {
        const count = await exportAllNotes();
        setMobileSaveStatus('已导出 ' + count + ' 条笔记');
    } catch (err) {
        console.error('移动端导出失败:', err);
        setMobileSaveStatus('导出失败');
    }
}

function applyMobileFormat(format) {
    const editor = $('#mobile-note-editor');
    editor.focus();
    const sel = window.getSelection();

    if (format === 'bold') {
        document.execCommand('bold', false, null);
    } else if (format === 'italic') {
        document.execCommand('italic', false, null);
    } else if (format === 'list') {
        document.execCommand('insertUnorderedList', false, null);
    } else if (format === 'heading') {
        if (sel && sel.rangeCount && typeof toggleHeading === 'function') {
            toggleHeading(editor, sel);
        }
    } else if (format === 'link') {
        if (sel && sel.rangeCount && !sel.isCollapsed && typeof toggleLink === 'function') {
            toggleLink(editor, sel);
        }
    }

    editor.dispatchEvent(new Event('input', { bubbles: true }));
    scrollMobileSelectionIntoView();
}

function initMobileTheme() {
    const saved = localStorage.getItem('s-light-theme');
    if (saved === 'light' || saved === 'dark') {
        AppState._theme = saved;
        document.documentElement.setAttribute('data-theme', saved);
    }
}

function toggleMobileTheme() {
    if (AppState._theme === 'dark') {
        AppState._theme = 'light';
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('s-light-theme', 'light');
    } else {
        AppState._theme = 'dark';
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('s-light-theme', 'dark');
    }
}

function setMobileSaveStatus(text) {
    $('#mobile-save-status').textContent = text;
}

function initMobileViewport() {
    const updateViewport = () => {
        const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.documentElement.style.setProperty('--mobile-viewport-height', height + 'px');
    };

    updateViewport();
    window.addEventListener('resize', updateViewport);

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateViewport);
        window.visualViewport.addEventListener('scroll', updateViewport);
    }

    const editor = $('#mobile-note-editor');
    editor.addEventListener('focus', () => {
        setTimeout(scrollMobileSelectionIntoView, 120);
    });
    editor.addEventListener('keyup', scrollMobileSelectionIntoView);
}

function scrollMobileSelectionIntoView() {
    const scrollEl = $('#mobile-editor-scroll');
    const sel = window.getSelection();
    if (!scrollEl || !sel || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.top === 0 && rect.bottom === 0)) return;

    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const toolbar = $('#mobile-format-bar');
    const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 64;
    const bottomLimit = viewportHeight - toolbarHeight - 20;

    if (rect.bottom > bottomLimit) {
        scrollEl.scrollBy({ top: rect.bottom - bottomLimit + 16, behavior: 'smooth' });
    } else if (rect.top < 72) {
        scrollEl.scrollBy({ top: rect.top - 88, behavior: 'smooth' });
    }
}

function onMobileBeforeInstallPrompt(event) {
    event.preventDefault();
    AppState._installPrompt = event;
    $('#mobile-install').hidden = false;
}

async function onMobileInstall() {
    const note = $('#mobile-settings-note');

    if (!AppState._installPrompt) {
        note.textContent = 'iOS 可通过分享菜单添加到主屏幕。Android 请确认当前页面由 HTTPS 或 localhost 打开。';
        return;
    }

    AppState._installPrompt.prompt();
    const choice = await AppState._installPrompt.userChoice;
    AppState._installPrompt = null;
    $('#mobile-install').hidden = true;
    note.textContent = choice.outcome === 'accepted' ? '已开始安装。' : '已取消安装。';
}

document.addEventListener('DOMContentLoaded', () => {
    initMobileApp();
});
