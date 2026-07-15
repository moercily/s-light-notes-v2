/* ============================================
   s-light notes v2 — unified sync service
   Desktop builds prefer Tauri commands; Web/PWA falls back to v1 sync helpers.
   ============================================ */

(function () {
    function getRoot() {
        if (typeof window !== 'undefined') return window;
        if (typeof globalThis !== 'undefined') return globalThis;
        return {};
    }

    const root = getRoot();

    function getInvoke() {
        return root.__TAURI__ &&
            root.__TAURI__.core &&
            typeof root.__TAURI__.core.invoke === 'function'
            ? root.__TAURI__.core.invoke
            : null;
    }

    function getWebFunction(name) {
        return typeof root[name] === 'function' ? root[name] : null;
    }

    function backendUnavailable() {
        return new Error('s-light notes v2 desktop backend is unavailable in this Web/PWA context.');
    }

    function encodeFolder(folderId) {
        return encodeURIComponent(folderId || '');
    }

    async function invokeDesktop(command, payload) {
        const invoke = getInvoke();
        if (!invoke) throw backendUnavailable();
        return invoke(command, payload || {});
    }

    function getAppSync() {
        return root.AppState && root.AppState.sync ? root.AppState.sync : {};
    }

    function currentApiKey(options) {
        const config = options || {};
        const value = config.apiKey !== undefined ? config.apiKey : getAppSync().apiKey;
        return (value || '').trim();
    }

    async function proxyRequest(method, path, body, apiKey) {
        return invokeDesktop('syncthing_proxy_request', {
            request: {
                method: method,
                path: path,
                body: body === undefined ? null : body,
                apiKey: (apiKey || '').trim() || null,
            },
        });
    }

    async function proxyJson(method, path, apiKey, body) {
        const response = await proxyRequest(method, path, body, apiKey);
        if (!response || response.status < 200 || response.status >= 300) {
            const error = new Error('Syncthing API 返回错误');
            error.status = response && response.status ? response.status : 0;
            throw error;
        }
        if (!response.body) return {};
        try {
            return JSON.parse(response.body);
        } catch (err) {
            const error = new Error('Syncthing 返回了无法解析的数据');
            error.code = 'invalidResponse';
            throw error;
        }
    }

    function normalizeDesktopError(err) {
        if (err && (err.status === 401 || err.status === 403)) {
            return { type: 'auth', message: '认证失败，请检查 API Key。' };
        }
        if (err && err.status) {
            return { type: 'http', message: 'Syncthing API 返回错误：HTTP ' + err.status };
        }
        if (err && err.code === 'invalidResponse') {
            return { type: 'response', message: err.message };
        }
        return {
            type: 'desktopEngine',
            message: err && err.message ? err.message : String(err || 'Syncthing 桌面同步引擎不可用。'),
        };
    }

    async function loadDesktopReadOnlyState(options) {
        const config = options || {};
        const apiKey = currentApiKey(config);
        const [status, folders, devices, connections] = await Promise.all([
            proxyJson('GET', '/rest/system/status', apiKey),
            proxyJson('GET', '/rest/config/folders', apiKey),
            proxyJson('GET', '/rest/config/devices', apiKey),
            proxyJson('GET', '/rest/system/connections', apiKey),
        ]);
        const folderList = Array.isArray(folders) ? folders : [];
        const deviceList = Array.isArray(devices) ? devices : [];
        const requestedFolderId = config.folderId || getAppSync().folderId || '';
        const folderId = folderList.some(folder => folder.id === requestedFolderId)
            ? requestedFolderId
            : '';
        const folderStatus = folderId
            ? await proxyJson('GET', '/rest/db/status?folder=' + encodeFolder(folderId), apiKey)
            : null;
        const connectionMap = connections && connections.connections ? connections.connections : {};
        const deviceId = status.myID || status.myId || '';
        const connectedDeviceIds = Object.entries(connectionMap)
            .filter(([, connection]) => connection && connection.connected)
            .map(([id]) => id)
            .filter(id => id && id !== deviceId);
        const completionResults = folderId
            ? await Promise.all(connectedDeviceIds.map(async id => {
                try {
                    const completion = await proxyJson(
                        'GET',
                        '/rest/db/completion?folder=' + encodeFolder(folderId) + '&device=' + encodeFolder(id),
                        apiKey
                    );
                    return {
                        deviceId: id,
                        completion: completion.completion,
                        needItems: completion.needItems,
                    };
                } catch (err) {
                    return null;
                }
            }))
            : [];

        return {
            status: status,
            folders: folderList,
            devices: deviceList,
            connections: connections || null,
            folderId: folderId,
            folderStatus: folderStatus,
            completions: completionResults.filter(Boolean),
            deviceId: deviceId,
        };
    }

    const syncService = {
        async getStatus() {
            const invoke = getInvoke();
            if (invoke) return invoke('syncthing_status');

            const getSummary = getWebFunction('syncGetSummaryText');
            return {
                mode: 'web',
                available: false,
                summary: getSummary ? getSummary() : '同步：桌面后端不可用',
            };
        },

        async startEngine() {
            return invokeDesktop('syncthing_start');
        },

        async stopEngine() {
            return invokeDesktop('syncthing_stop');
        },

        async testConnection(options) {
            const invoke = getInvoke();
            if (invoke) {
                let desktopStatus;
                try {
                    desktopStatus = await invoke('syncthing_status');
                } catch (err) {
                    return {
                        ok: false,
                        desktopStatus: null,
                        folders: [],
                        devices: [],
                        deviceId: '',
                        error: normalizeDesktopError(err),
                    };
                }
                if (!desktopStatus || !desktopStatus.running) {
                    return {
                        ok: false,
                        desktopStatus: desktopStatus,
                        folders: [],
                        devices: [],
                        deviceId: '',
                        error: {
                            type: 'desktopEngine',
                            message: desktopStatus && desktopStatus.message
                                ? desktopStatus.message
                                : 'Syncthing 桌面同步引擎未运行。',
                        },
                    };
                }
                try {
                    const state = await loadDesktopReadOnlyState(options);
                    return { ok: true, desktopStatus: desktopStatus, ...state };
                } catch (err) {
                    return {
                        ok: false,
                        desktopStatus: desktopStatus,
                        folders: [],
                        devices: [],
                        deviceId: '',
                        error: normalizeDesktopError(err),
                    };
                }
            }

            const testConnection = getWebFunction('syncTestConnection');
            if (!testConnection) throw backendUnavailable();
            const config = options || {};
            return testConnection(config.apiBase, config.apiKey, config.rememberKey);
        },

        async getReadOnlyState(options) {
            const invoke = getInvoke();
            if (invoke) return loadDesktopReadOnlyState(options);

            const loadState = getWebFunction('syncLoadReadOnlyState');
            if (!loadState) throw backendUnavailable();
            const config = options || {};
            return loadState(config.apiBase, config.apiKey);
        },

        async scanFolder(folderId, options) {
            const invoke = getInvoke();
            if (invoke) {
                return proxyJson(
                    'POST',
                    '/rest/db/scan?folder=' + encodeFolder(folderId),
                    currentApiKey(options),
                    null
                );
            }

            const scan = getWebFunction('syncTriggerFolderScan');
            if (!scan) throw backendUnavailable();
            return scan(undefined, undefined, folderId);
        },

        async bindNotesFolder(path, folderId, details) {
            const options = details || {};
            return invokeDesktop('syncthing_apply_folder_config', {
                request: {
                    path: path,
                    folderId: folderId,
                    selectedFolderId: options.selectedFolderId || null,
                    selectedFolderPath: options.selectedFolderPath || null,
                    deviceIds: Array.isArray(options.deviceIds) ? options.deviceIds : [],
                    selectedFolderDeviceIds: Array.isArray(options.selectedFolderDeviceIds)
                        ? options.selectedFolderDeviceIds
                        : [],
                    existingFolderIds: Array.isArray(options.existingFolderIds)
                        ? options.existingFolderIds
                        : [],
                    restartRequired: typeof options.restartRequired === 'boolean'
                        ? options.restartRequired
                        : null,
                },
            });
        },

        async confirmNotesFolder(confirmationToken, apiKey) {
            return invokeDesktop('syncthing_confirm_folder_config', {
                request: {
                    confirmationToken: confirmationToken,
                    apiKey: (apiKey || '').trim(),
                },
            });
        },

        async getPairingInfo() {
            return invokeDesktop('syncthing_pairing_info');
        },

        async previewDevicePairing(deviceId, deviceName) {
            return invokeDesktop('syncthing_preview_device_pairing', {
                request: {
                    deviceId: (deviceId || '').trim(),
                    deviceName: (deviceName || '').trim(),
                },
            });
        },

        async confirmDevicePairing(confirmationToken) {
            return invokeDesktop('syncthing_confirm_device_pairing', {
                request: {
                    confirmationToken: confirmationToken,
                },
            });
        },

        async getDevices(options) {
            const invoke = getInvoke();
            if (invoke) return proxyJson('GET', '/rest/config/devices', currentApiKey(options));

            const loadState = getWebFunction('syncLoadReadOnlyState');
            if (!loadState) throw backendUnavailable();
            const config = options || {};
            const state = await loadState(config.apiBase, config.apiKey);
            return state.devices || [];
        },

        async getConfigAssist(options) {
            const invoke = getInvoke();
            if (invoke) {
                const apiKey = currentApiKey(options);
                const [folderTemplate, deviceTemplate, restartRequired] = await Promise.all([
                    proxyJson('GET', '/rest/config/defaults/folder', apiKey),
                    proxyJson('GET', '/rest/config/defaults/device', apiKey),
                    proxyJson('GET', '/rest/config/restart-required', apiKey),
                ]);
                return { folderTemplate, deviceTemplate, restartRequired };
            }

            const loadAssist = getWebFunction('syncLoadConfigAssistState');
            if (!loadAssist) throw backendUnavailable();
            const config = options || {};
            return loadAssist(config.apiBase, config.apiKey);
        },

        async openWeb() {
            return invokeDesktop('open_syncthing_web');
        },

        async getConflicts() {
            const getConflicts = getWebFunction('getConflictNotes');
            if (getConflicts) return getConflicts();
            return [];
        },
    };

    root.syncService = syncService;
    if (root.globalThis && root.globalThis !== root) {
        root.globalThis.syncService = syncService;
    }
})();
