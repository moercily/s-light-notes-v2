/* ============================================
   s-light notes — 存储抽象层
   提供桌面文件、Android 原生文件、FSA 和 IDB 四种模式
   对外接口完全一致，内部自动选择适配器
   ============================================ */

// ========== 初始化 ==========

/**
 * 初始化存储，检测浏览器能力并选择适配器
 * @returns {Promise<string>} 'desktop'、'fsa' 或 'idb'
 */
async function initStorage() {
    if (window.desktopService && window.desktopService.isAvailable()) {
        AppState.desktopPaths = await window.desktopService.ensureNotesFolder();
        AppState.storageMode = 'desktop';
        return 'desktop';
    } else if ('showDirectoryPicker' in window) {
        AppState.storageMode = 'fsa';
        // 检查是否已有保存的目录句柄权限
        // （权限在页面刷新后可能仍有效）
        return 'fsa';
    } else {
        AppState.storageMode = 'idb';
        await initIDB();
        return 'idb';
    }
}

// ====================================================
//  FSA 适配器 — 直接读写本地 .md 文件
// ====================================================

/**
 * 打开文件夹选择器，获取目录句柄
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
async function fsaOpenFolder() {
    try {
        const handle = await window.showDirectoryPicker({
            mode: 'readwrite',
        });
        AppState.folderHandle = handle;
        return handle;
    } catch (err) {
        // 用户取消了选择
        if (err.name === 'AbortError') return null;
        console.error('打开文件夹失败:', err);
        throw err;
    }
}

/**
 * 列出文件夹中所有 .md 文件
 * @returns {Promise<Array<{id: string, title: string, content: string, updatedAt: number}>>}
 */
async function fsaListNotes() {
    const handle = AppState.folderHandle;
    if (!handle) return [];

    const notes = [];
    try {
        for await (const [name, fileHandle] of handle.entries()) {
            if (isSyncthingInternalFile(name)) continue;
            if (!name.endsWith('.md')) continue;

            try {
                const file = await fileHandle.getFile();
                const content = await file.text();
                const isConflict = isSyncthingConflictFile(name);
                notes.push({
                    id: name.replace(/\.md$/, ''),
                    title: extractTitle(content),
                    content: content,
                    updatedAt: file.lastModified,
                    isConflict: isConflict,
                    conflictSourceId: isConflict ? getConflictSourceId(name) : null,
                });
            } catch (err) {
                console.warn('读取文件失败: ' + name, err);
            }
        }
    } catch (err) {
        console.error('遍历文件夹失败:', err);
        throw err;
    }

    // 按修改时间倒序排列
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    return notes;
}

/**
 * 读取单条笔记（完整内容）
 * @param {string} id
 * @returns {Promise<{id: string, title: string, content: string, updatedAt: number}|null>}
 */
async function fsaReadNote(id) {
    const handle = AppState.folderHandle;
    if (!handle) return null;

    try {
        const fileName = id + '.md';
        const fileHandle = await handle.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        const content = await file.text();
        const isConflict = isSyncthingConflictFile(fileName);
        return {
            id: id,
            title: extractTitle(content),
            content: content,
            updatedAt: file.lastModified,
            isConflict: isConflict,
            conflictSourceId: isConflict ? getConflictSourceId(fileName) : null,
        };
    } catch (err) {
        if (err.name === 'NotFoundError') return null;
        console.error('读取笔记失败:', err);
        return null;
    }
}

/**
 * 保存笔记（创建或更新）
 * @param {string} id - 笔记 ID，空字符串表示新建
 * @param {string} content - 完整内容
 * @returns {Promise<{id: string, title: string, updatedAt: number}>}
 */
async function fsaSaveNote(id, content) {
    const handle = AppState.folderHandle;
    if (!handle) throw new Error('未选择笔记文件夹');

    // 新建笔记时生成 ID
    if (!id) {
        const baseId = generateNoteId(extractTitle(content));
        id = await fsaFindUniqueId(baseId);
    }

    const fileName = id + '.md';
    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    const file = await fileHandle.getFile();
    return {
        id: id,
        title: extractTitle(content),
        updatedAt: file.lastModified,
    };
}

/**
 * 删除笔记
 * @param {string} id
 * @returns {Promise<void>}
 */
async function fsaDeleteNote(id) {
    const handle = AppState.folderHandle;
    if (!handle) throw new Error('未选择笔记文件夹');

    try {
        await handle.removeEntry(id + '.md');
    } catch (err) {
        if (err.name === 'NotFoundError') return;
        throw err;
    }
}

/**
 * 查找不重复的文件名
 * @param {string} baseId
 * @returns {Promise<string>}
 */
async function fsaFindUniqueId(baseId) {
    const handle = AppState.folderHandle;
    if (!handle) return baseId;

    let id = baseId;
    let counter = 2;

    while (true) {
        try {
            await handle.getFileHandle(id + '.md');
            // 文件已存在，加数字后缀重试
            id = baseId + '-' + counter;
            counter++;
        } catch (err) {
            if (err.name === 'NotFoundError') break;
            throw err;
        }
    }

    return id;
}

// ====================================================
//  IndexedDB 适配器 — 浏览器本地存储
// ====================================================

let _idb = null; // 数据库连接缓存

/**
 * 初始化 IndexedDB 数据库
 * @returns {Promise<IDBDatabase>}
 */
function initIDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('s-light-notes', 1);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('notes')) {
                const store = db.createObjectStore('notes', { keyPath: 'id' });
                store.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            _idb = event.target.result;
            resolve(_idb);
        };

        request.onerror = (event) => {
            console.error('IndexedDB 初始化失败:', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * 获取数据库连接
 */
function getIDB() {
    if (!_idb) throw new Error('IndexedDB 未初始化');
    return _idb;
}

/**
 * IDB: 列出所有笔记
 */
async function idbListNotes() {
    const db = getIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readonly');
        const store = tx.objectStore('notes');
        const index = store.index('updatedAt');
        const request = index.getAll();

        request.onsuccess = () => {
            // 过滤掉已归档的笔记，按时间倒序
            const notes = request.result
                .filter(n => !n.archived)
                .reverse();
            resolve(notes);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * IDB: 读取单条笔记
 */
async function idbReadNote(id) {
    const db = getIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readonly');
        const store = tx.objectStore('notes');
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * IDB: 保存笔记
 */
async function idbSaveNote(id, content) {
    const db = getIDB();

    if (!id) {
        id = generateNoteId(extractTitle(content));
        // 检查是否已存在同名 ID
        let exists = true;
        let baseId = id;
        let counter = 2;
        while (exists) {
            const existing = await idbReadNote(id);
            if (!existing) { exists = false; break; }
            id = baseId + '-' + counter;
            counter++;
        }
    }

    const record = {
        id: id,
        title: extractTitle(content),
        content: content,
        updatedAt: Date.now(),
        createdAt: Date.now(), // IDB 中保留创建时间
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readwrite');
        const store = tx.objectStore('notes');

        // 如果记录已存在，保留 createdAt
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
            if (getRequest.result && getRequest.result.createdAt) {
                record.createdAt = getRequest.result.createdAt;
            }
            const putRequest = store.put(record);
            putRequest.onsuccess = () => resolve({
                id: record.id,
                title: record.title,
                updatedAt: record.updatedAt,
            });
            putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

/**
 * IDB: 删除笔记
 */
async function idbDeleteNote(id) {
    const db = getIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readwrite');
        const store = tx.objectStore('notes');
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ====================================================
//  Desktop 适配器 — Tauri 默认笔记目录
// ====================================================

function normalizeDesktopNote(note) {
    if (!note) return null;
    const fileName = note.id + '.md';
    const isConflict = !note.inTrash && isSyncthingConflictFile(fileName);
    return {
        id: note.id,
        title: extractTitle(note.content),
        content: note.content,
        updatedAt: note.updatedAt,
        inTrash: !!note.inTrash,
        isConflict: isConflict,
        conflictSourceId: isConflict ? getConflictSourceId(fileName) : null,
    };
}

async function desktopListNotes() {
    const notes = await window.desktopService.listNotes(AppState._showTrash);
    return notes.map(normalizeDesktopNote);
}

async function desktopReadNote(id) {
    const note = await window.desktopService.readNote(id, AppState._showTrash);
    return normalizeDesktopNote(note);
}

async function desktopSaveNote(id, content) {
    const suggestedId = generateNoteId(extractTitle(content));
    const result = await window.desktopService.saveNote(id, suggestedId, content);
    return {
        id: result.id,
        title: extractTitle(content),
        updatedAt: result.updatedAt,
    };
}

async function desktopMoveToTrash(id) {
    return window.desktopService.moveToTrash(id);
}

async function desktopRestoreFromTrash(id) {
    return window.desktopService.restoreNote(id);
}

async function desktopPermanentlyDelete(id) {
    return window.desktopService.permanentlyDelete(id);
}

// ====================================================
//  Android 适配器 - 应用私有 Markdown 文件
// ====================================================

function normalizeMobileNote(note) {
    return normalizeDesktopNote(note);
}

async function mobileListNotes() {
    const notes = await window.mobileStorageService.list(AppState._showTrash);
    return notes.map(normalizeMobileNote);
}

async function mobileReadNote(id) {
    const note = await window.mobileStorageService.read(id, AppState._showTrash);
    return normalizeMobileNote(note);
}

async function mobileSaveNote(id, content) {
    const suggestedId = generateNoteId(extractTitle(content));
    const result = await window.mobileStorageService.save(id, suggestedId, content);
    return {
        id: result.id,
        title: extractTitle(content),
        updatedAt: result.updatedAt,
    };
}

// ====================================================
//  统一接口 — 根据 AppState.storageMode 路由
// ====================================================

async function listNotes() {
    let notes = [];
    if (AppState.storageMode === 'desktop') {
        notes = await desktopListNotes();
    } else if (AppState.storageMode === 'android') {
        notes = await mobileListNotes();
    } else if (AppState.storageMode === 'fsa') {
        if (AppState._showTrash) {
            notes = await fsaListTrashNotes();
        } else {
            notes = await fsaListNotes();
        }
    } else if (AppState.storageMode === 'idb') {
        if (AppState._showTrash) {
            notes = await idbListTrashNotes();
        } else {
            notes = await idbListNotes();
        }
    }
    return notes;
}

async function readNote(id) {
    if (AppState.storageMode === 'desktop') {
        return desktopReadNote(id);
    } else if (AppState.storageMode === 'android') {
        return mobileReadNote(id);
    } else if (AppState.storageMode === 'fsa') {
        if (AppState._showTrash) {
            return fsaReadTrashNote(id);
        }
        return fsaReadNote(id);
    } else if (AppState.storageMode === 'idb') {
        return idbReadNote(id);
    }
    return null;
}

async function saveNote(id, content) {
    if (AppState.storageMode === 'desktop') {
        return desktopSaveNote(id, content);
    } else if (AppState.storageMode === 'android') {
        return mobileSaveNote(id, content);
    } else if (AppState.storageMode === 'fsa') {
        return fsaSaveNote(id, content);
    } else if (AppState.storageMode === 'idb') {
        return idbSaveNote(id, content);
    }
    throw new Error('未选择存储模式');
}

/** 删除笔记（移入回收站） */
async function deleteNote(id) {
    if (AppState.storageMode === 'desktop') {
        return desktopMoveToTrash(id);
    } else if (AppState.storageMode === 'android') {
        return window.mobileStorageService.trash(id);
    } else if (AppState.storageMode === 'fsa') {
        return fsaMoveToTrash(id);
    } else if (AppState.storageMode === 'idb') {
        return idbMoveToTrash(id);
    }
    throw new Error('未选择存储模式');
}

/** 恢复笔记（从回收站还原） */
async function restoreNote(id) {
    if (AppState.storageMode === 'desktop') {
        return desktopRestoreFromTrash(id);
    } else if (AppState.storageMode === 'android') {
        return window.mobileStorageService.restore(id);
    } else if (AppState.storageMode === 'fsa') {
        return fsaRestoreFromTrash(id);
    } else if (AppState.storageMode === 'idb') {
        return idbRestoreFromTrash(id);
    }
    throw new Error('未选择存储模式');
}

/** 永久删除笔记 */
async function permanentlyDelete(id) {
    if (AppState.storageMode === 'desktop') {
        return desktopPermanentlyDelete(id);
    } else if (AppState.storageMode === 'android') {
        return window.mobileStorageService.delete(id);
    } else if (AppState.storageMode === 'fsa') {
        return fsaPermanentlyDelete(id);
    } else if (AppState.storageMode === 'idb') {
        return idbDeleteNote(id);
    }
    throw new Error('未选择存储模式');
}

/**
 * 搜索笔记（按标题和内容匹配）
 * @param {string} query
 * @returns {Promise<Array>}
 */
async function searchNotes(query) {
    if (!query || !query.trim()) {
        return listNotes();
    }
    const all = await listNotes();
    const q = query.toLowerCase().trim();
    return all.filter(note => {
        return note.title.toLowerCase().includes(q) ||
               note.content.toLowerCase().includes(q);
    });
}

/**
 * IDB 模式：导出所有笔记为 .md 文件下载
 */
async function exportAllNotes() {
    const notes = await listNotes();
    for (const note of notes) {
        const blob = new Blob([note.content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = note.id + '.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        // 小延迟避免浏览器拦截多个下载
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return notes.length;
}

/**
 * IDB 模式：从 .md 文件导入笔记
 * @returns {Promise<number>} 导入的笔记数量
 */
function importNotes() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.md,.txt,.markdown';

        input.onchange = async () => {
            const files = input.files;
            let count = 0;
            for (const file of files) {
                try {
                    const content = await file.text();
                    const id = file.name.replace(/\.(md|txt|markdown)$/i, '');
                    if (AppState.storageMode === 'android') {
                        await window.mobileStorageService.save(null, generateNoteId(id), content);
                    } else {
                        await idbSaveNote(id, content);
                    }
                    count++;
                } catch (err) {
                    console.warn('导入文件失败: ' + file.name, err);
                }
            }
            resolve(count);
        };

        input.oncancel = () => resolve(0);
        input.click();
    });
}

// ====================================================
//  FSA 回收站 — 使用 .trash 子文件夹
// ====================================================

/**
 * FSA: 将笔记移入回收站（.trash 子文件夹）
 */
async function fsaMoveToTrash(id) {
    const handle = AppState.folderHandle;
    if (!handle) throw new Error('未选择笔记文件夹');

    const fileName = id + '.md';
    try {
        const fileHandle = await handle.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        const content = await file.text();

        // 确保 .trash 文件夹存在
        let trashHandle;
        try {
            trashHandle = await handle.getDirectoryHandle('.trash');
        } catch (err) {
            if (err.name === 'NotFoundError') {
                trashHandle = await handle.getDirectoryHandle('.trash', { create: true });
            } else {
                throw err;
            }
        }

        // 写入回收站
        const trashFileHandle = await trashHandle.getFileHandle(fileName, { create: true });
        const writable = await trashFileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        // 删除原文件
        await handle.removeEntry(fileName);
    } catch (err) {
        if (err.name === 'NotFoundError') return;
        throw err;
    }
}

/**
 * FSA: 从回收站恢复笔记
 */
async function fsaRestoreFromTrash(id) {
    const handle = AppState.folderHandle;
    if (!handle) throw new Error('未选择笔记文件夹');

    try {
        const trashHandle = await handle.getDirectoryHandle('.trash');
        const fileName = id + '.md';
        const fileHandle = await trashHandle.getFileHandle(fileName);
        const file = await fileHandle.getFile();
        const content = await file.text();

        // 写回主文件夹
        const mainFileHandle = await handle.getFileHandle(fileName, { create: true });
        const writable = await mainFileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        // 从回收站删除
        await trashHandle.removeEntry(fileName);
    } catch (err) {
        if (err.name === 'NotFoundError') return;
        throw err;
    }
}

/**
 * FSA: 从回收站读取笔记
 */
async function fsaReadTrashNote(id) {
    const handle = AppState.folderHandle;
    if (!handle) return null;

    try {
        const trashHandle = await handle.getDirectoryHandle('.trash');
        const fileHandle = await trashHandle.getFileHandle(id + '.md');
        const file = await fileHandle.getFile();
        const content = await file.text();
        return {
            id: id,
            title: extractTitle(content),
            content: content,
            updatedAt: file.lastModified,
            inTrash: true,
        };
    } catch (err) {
        if (err.name === 'NotFoundError') return null;
        console.error('读取回收站笔记失败:', err);
        return null;
    }
}

/**
 * FSA: 永久删除回收站中的笔记
 */
async function fsaPermanentlyDelete(id) {
    const handle = AppState.folderHandle;
    if (!handle) throw new Error('未选择笔记文件夹');

    try {
        const trashHandle = await handle.getDirectoryHandle('.trash');
        await trashHandle.removeEntry(id + '.md');
    } catch (err) {
        if (err.name === 'NotFoundError') return;
        throw err;
    }
}

/**
 * FSA: 列出回收站中的笔记
 */
async function fsaListTrashNotes() {
    const handle = AppState.folderHandle;
    if (!handle) return [];

    let trashHandle;
    try {
        trashHandle = await handle.getDirectoryHandle('.trash');
    } catch (err) {
        if (err.name === 'NotFoundError') return [];
        throw err;
    }

    const notes = [];
    for await (const [name, fileHandle] of trashHandle.entries()) {
        if (!name.endsWith('.md')) continue;
        try {
            const file = await fileHandle.getFile();
            const content = await file.text();
            notes.push({
                id: name.replace(/\.md$/, ''),
                title: extractTitle(content),
                content: content,
                updatedAt: file.lastModified,
                inTrash: true,
            });
        } catch (err) {
            console.warn('读取回收站文件失败: ' + name, err);
        }
    }

    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    return notes;
}

// ====================================================
//  IDB 回收站 — 使用 archived 标记
// ====================================================

/**
 * IDB: 将笔记标记为已归档（移入回收站）
 */
async function idbMoveToTrash(id) {
    const note = await idbReadNote(id);
    if (!note) return;
    note.archived = true;
    note.updatedAt = Date.now();

    return new Promise((resolve, reject) => {
        const db = getIDB();
        const tx = db.transaction('notes', 'readwrite');
        const store = tx.objectStore('notes');
        const request = store.put(note);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * IDB: 恢复笔记（取消归档）
 */
async function idbRestoreFromTrash(id) {
    const note = await idbReadNote(id);
    if (!note) return;
    note.archived = false;
    note.updatedAt = Date.now();

    return new Promise((resolve, reject) => {
        const db = getIDB();
        const tx = db.transaction('notes', 'readwrite');
        const store = tx.objectStore('notes');
        const request = store.put(note);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * IDB: 列出回收站中的笔记
 */
async function idbListTrashNotes() {
    const db = getIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readonly');
        const store = tx.objectStore('notes');
        const request = store.getAll();

        request.onsuccess = () => {
            const notes = request.result
                .filter(n => n.archived)
                .map(n => ({ ...n, inTrash: true }))
                .sort((a, b) => b.updatedAt - a.updatedAt);
            resolve(notes);
        };
        request.onerror = () => reject(request.error);
    });
}
