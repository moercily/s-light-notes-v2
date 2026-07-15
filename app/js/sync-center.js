/* ============================================
   s-light notes v2 — sync center view model
   Keeps P2P sync status separate from local save status.
   ============================================ */

(function () {
    function getRoot() {
        if (typeof window !== 'undefined') return window;
        if (typeof globalThis !== 'undefined') return globalThis;
        return {};
    }

    function createModel(input) {
        const options = input || {};
        const appState = options.appState || {};
        const sync = appState.sync || {};
        const desktopStatus = options.desktopStatus || null;

        return {
            localSave: getLocalSaveCard(appState),
            engine: getEngineCard(desktopStatus),
            p2pSync: getP2pSyncCard(sync),
            folder: getFolderCard(sync),
            devices: getDevicesCard(sync),
        };
    }

    function getLocalSaveCard(appState) {
        if (appState.isDirty) {
            return card('本地保存', '有未保存修改', '当前内容还没有写入本地笔记。');
        }

        if (appState.storageMode === 'desktop') {
            return card('本地保存', '已保存到桌面目录', 'Markdown 文件可以由 Syncthing 直接同步。');
        }

        if (appState.storageMode === 'fsa') {
            return card('本地保存', '已保存到文件夹', '本地保存不代表已经同步到其他设备。');
        }

        if (appState.storageMode === 'idb') {
            return card('本地保存', '已保存到浏览器', '当前浏览器存储不会自动进入 Syncthing 文件夹。');
        }

        return card('本地保存', '等待选择存储', '请选择笔记文件夹或使用浏览器本地存储。');
    }

    function getEngineCard(desktopStatus) {
        if (!desktopStatus) {
            return card('同步引擎', 'Web/PWA 兼容模式', '桌面版会在这里显示 Syncthing 本机引擎状态。');
        }

        if (desktopStatus.running) {
            return card(
                '同步引擎',
                desktopStatus.managed ? '由应用托管' : '已检测到 Syncthing',
                desktopStatus.managed ? '关闭应用时同步也会停止。' : (desktopStatus.message || '')
            );
        }

        if (desktopStatus.managed) {
            return card('同步引擎', '正在启动', desktopStatus.message || 'Syncthing 管理接口尚未就绪。');
        }

        if (desktopStatus.available === false) {
            return card('同步引擎', '桌面同步引擎不可用', desktopStatus.message || '请在桌面版中启动或安装 Syncthing。');
        }

        return card('同步引擎', '未运行', desktopStatus.message || '可以从桌面版启动 Syncthing。');
    }

    function getP2pSyncCard(sync) {
        if (!sync.enabled) return card('P2P 同步', '未配置', '打开同步中心后连接或启动 Syncthing。');
        if (!sync.connected) return card('P2P 同步', getErrorSummary(sync), getErrorDetail(sync));

        const folderStatus = sync.folderStatus;
        if (folderStatus && folderStatus.state) {
            return card('P2P 同步', translateFolderState(folderStatus.state), getFolderNeedDetail(folderStatus));
        }

        return card('P2P 同步', '已连接', '等待 Syncthing 返回当前文件夹状态。');
    }

    function getFolderCard(sync) {
        if (!sync.folderId) return card('同步文件夹', '未绑定', '选择一个 Syncthing folder 作为当前笔记文件夹。');
        return card('同步文件夹', sync.folderId, '当前笔记会通过这个 Syncthing folder 同步。');
    }

    function getDevicesCard(sync) {
        const devices = Array.isArray(sync.devices) ? sync.devices : [];
        const total = devices.length;
        const connections = sync.connections && sync.connections.connections;
        if (!total) return card('远端设备', '暂无设备', 'Syncthing 中还没有可显示的远端设备。');
        if (!connections) return card('远端设备', total + ' 台已配置', '等待连接状态。');

        const connected = Object.values(connections)
            .filter(conn => conn && conn.connected)
            .length;
        return card('远端设备', connected + ' / ' + total + ' 台设备已连接', '离线设备会在重新连接后继续同步。');
    }

    function getErrorSummary(sync) {
        if (!sync.lastError) return '未连接';
        if (sync.lastError.type === 'cors') return '浏览器限制';
        if (sync.lastError.type === 'auth') return '认证失败';
        return '未连接';
    }

    function getErrorDetail(sync) {
        return sync.lastError && sync.lastError.message
            ? sync.lastError.message
            : 'Syncthing 尚未连接，当前只能保证本地保存。';
    }

    function getFolderNeedDetail(folderStatus) {
        const count = getNeedCount(folderStatus);
        if (count > 0) return '仍有 ' + count + ' 项等待同步。';
        return '当前 folder 没有待同步项目。';
    }

    function getNeedCount(folderStatus) {
        if (typeof folderStatus.needTotalItems === 'number') return folderStatus.needTotalItems;
        if (folderStatus.need && typeof folderStatus.need.totalItems === 'number') return folderStatus.need.totalItems;
        return 0;
    }

    function translateFolderState(state) {
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

    function card(label, value, detail) {
        return {
            label: label,
            value: value,
            detail: detail || '',
        };
    }

    function renderCards(container, model) {
        if (!container || !model) return;
        container.innerHTML = '';
        ['localSave', 'engine', 'p2pSync', 'folder', 'devices'].forEach(key => {
            const item = model[key];
            const node = document.createElement('div');
            node.className = 'sync-center-card';
            node.innerHTML =
                '<span class="sync-center-card-label"></span>' +
                '<strong class="sync-center-card-value"></strong>' +
                '<span class="sync-center-card-detail"></span>';
            node.querySelector('.sync-center-card-label').textContent = item.label;
            node.querySelector('.sync-center-card-value').textContent = item.value;
            node.querySelector('.sync-center-card-detail').textContent = item.detail;
            container.appendChild(node);
        });
    }

    getRoot().SyncCenter = {
        createModel: createModel,
        renderCards: renderCards,
    };
})();
