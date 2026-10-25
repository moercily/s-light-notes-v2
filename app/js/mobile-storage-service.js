/* ============================================
   s-light notes v2 - Android native storage bridge
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

    async function invokeAndroid(command, payload) {
        const invoke = getInvoke();
        if (!invoke) {
            throw new Error('Android 原生存储在当前浏览器环境中不可用。');
        }
        return invoke(command, payload || {});
    }

    const mobileStorageService = {
        isAvailable() {
            return !!getInvoke();
        },

        ensure() {
            return invokeAndroid('mobile_storage_ensure');
        },

        list(inTrash) {
            return invokeAndroid('mobile_storage_list', {
                request: { inTrash: !!inTrash },
            });
        },

        read(id, inTrash) {
            return invokeAndroid('mobile_storage_read', {
                request: { id: id, inTrash: !!inTrash },
            });
        },

        save(id, suggestedId, content, expectedVersion) {
            return invokeAndroid('mobile_storage_save', {
                request: {
                    id: id || null,
                    suggestedId: suggestedId,
                    content: content,
                    ...(expectedVersion === undefined ? {} : { expectedVersion }),
                },
            });
        },

        trash(id) {
            return invokeAndroid('mobile_storage_trash', {
                request: { id: id },
            });
        },

        restore(id) {
            return invokeAndroid('mobile_storage_restore', {
                request: { id: id },
            });
        },

        delete(id) {
            return invokeAndroid('mobile_storage_delete', {
                request: { id: id },
            });
        },
    };

    root.mobileStorageService = mobileStorageService;
    if (root.globalThis && root.globalThis !== root) {
        root.globalThis.mobileStorageService = mobileStorageService;
    }
})();
