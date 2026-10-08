/* ============================================
   s-light notes v2 — desktop backend bridge
   Wraps Tauri-only app path and notes folder commands.
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

    function backendUnavailable() {
        return new Error('s-light notes v2 desktop backend is unavailable in this Web/PWA context.');
    }

    async function invokeDesktop(command, payload) {
        const invoke = getInvoke();
        if (!invoke) throw backendUnavailable();
        return invoke(command, payload || {});
    }

    const desktopService = {
        isAvailable() {
            return !!getInvoke();
        },

        async getAppPaths() {
            return invokeDesktop('get_app_paths');
        },

        async ensureNotesFolder() {
            return invokeDesktop('ensure_notes_folder');
        },

        async openNotesFolder() {
            return invokeDesktop('open_notes_folder');
        },

        async listNotes(inTrash) {
            return invokeDesktop('desktop_list_notes', {
                request: { inTrash: !!inTrash },
            });
        },

        async readNote(id, inTrash) {
            return invokeDesktop('desktop_read_note', {
                request: { id: id, inTrash: !!inTrash },
            });
        },

        async saveNote(id, suggestedId, content, expectedVersion) {
            return invokeDesktop('desktop_save_note', {
                request: {
                    id: id || null,
                    suggestedId: suggestedId,
                    content: content,
                    ...(expectedVersion === undefined ? {} : { expectedVersion }),
                },
            });
        },

        async moveToTrash(id) {
            return invokeDesktop('desktop_move_to_trash', {
                request: { id: id },
            });
        },

        async restoreNote(id) {
            return invokeDesktop('desktop_restore_note', {
                request: { id: id },
            });
        },

        async permanentlyDelete(id) {
            return invokeDesktop('desktop_delete_note', {
                request: { id: id },
            });
        },
    };

    root.desktopService = desktopService;
    if (root.globalThis && root.globalThis !== root) {
        root.globalThis.desktopService = desktopService;
    }
})();
