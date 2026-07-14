/* ============================================
   s-light notes — 移动端入口
   独立移动壳，默认使用 IndexedDB，不影响桌面端 app.js
   ============================================ */

const AppState = {
    currentNoteId: null,
    notes: [],
    storageMode: 'idb',
    folderHandle: null,
    isDirty: false,
    searchQuery: '',
    _showTrash: false,
    _theme: null,
    _lastSavedTime: null,
    _installPrompt: null,
};

async function initMobileApp() {
    initMobileTheme();
    bindMobileEvents();
    initMobileViewport();

    try {
        await initIDB();
        AppState.storageMode = 'idb';
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
    $('#mobile-settings-back').addEventListener('click', () => showMobileView('list'));
    $('#mobile-search').addEventListener('input', (e) => {
        AppState.searchQuery = e.target.value;
        renderMobileNotes();
    });
    $('#mobile-note-editor').addEventListener('input', onMobileEditorInput);
    $('#mobile-delete-note').addEventListener('click', onMobileDeleteCurrent);
    $('#mobile-import').addEventListener('click', onMobileImport);
    $('#mobile-export').addEventListener('click', onMobileExport);
    $('#mobile-trash').addEventListener('click', onMobileToggleTrash);
    $('#mobile-install').addEventListener('click', onMobileInstall);
    $('#mobile-theme-toggle').addEventListener('click', toggleMobileTheme);
    window.addEventListener('beforeinstallprompt', onMobileBeforeInstallPrompt);

    $$('#mobile-format-bar button').forEach(btn => {
        btn.addEventListener('click', () => applyMobileFormat(btn.dataset.format));
    });
}

function showMobileView(name) {
    $$('.mobile-view').forEach(view => view.classList.remove('active'));
    $('#mobile-' + name + '-view').classList.add('active');
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

async function openMobileNote(id) {
    if (AppState.isDirty) await saveMobileCurrentNote();

    const note = await readNote(id);
    if (!note) {
        await refreshMobileNotes();
        return;
    }

    AppState.currentNoteId = note.id;
    AppState.isDirty = false;
    $('#mobile-note-editor').innerHTML = renderMarkdown(note.content || '');
    $('#mobile-note-title').textContent = note.title || '未命名';
    setMobileSaveStatus('已加载');
    showMobileView('editor');
}

async function onMobileNewNote() {
    if (AppState.isDirty) await saveMobileCurrentNote();

    AppState._showTrash = false;
    AppState.currentNoteId = null;
    AppState.isDirty = false;
    $('#mobile-note-editor').innerHTML = '';
    $('#mobile-note-title').textContent = '新建笔记';
    setMobileSaveStatus('编辑中');
    showMobileView('editor');
    $('#mobile-note-editor').focus();
}

async function onMobileBackToList() {
    if (AppState.isDirty) await saveMobileCurrentNote();
    await refreshMobileNotes();
    showMobileView('list');
}

function onMobileEditorInput() {
    AppState.isDirty = true;
    setMobileSaveStatus('未保存...');
    autoSaveMobileNote();
}

const autoSaveMobileNote = debounce(async () => {
    if (!AppState.isDirty) return;
    const content = getMobileEditorContent();
    if (!content.trim()) return;
    await saveMobileCurrentNote();
}, 600);

async function saveMobileCurrentNote() {
    const content = getMobileEditorContent();
    if (!content.trim() && !AppState.currentNoteId) return null;

    setMobileSaveStatus('保存中...');
    try {
        const result = await saveNote(AppState.currentNoteId, content);
        AppState.currentNoteId = result.id;
        AppState.isDirty = false;
        $('#mobile-note-title').textContent = result.title || '未命名';
        setMobileSaveStatus('已保存 ' + formatDate(result.updatedAt));
        await refreshMobileNotes();
        return result;
    } catch (err) {
        console.error('移动端保存失败:', err);
        setMobileSaveStatus('保存失败');
        return null;
    }
}

function getMobileEditorContent() {
    return htmlToMarkdown($('#mobile-note-editor'));
}

async function onMobileDeleteCurrent() {
    if (!AppState.currentNoteId) {
        $('#mobile-note-editor').innerHTML = '';
        showMobileView('list');
        return;
    }

    if (!confirm('确定要删除这条笔记吗？笔记将移入回收站。')) return;
    await deleteNote(AppState.currentNoteId);
    AppState.currentNoteId = null;
    AppState.isDirty = false;
    $('#mobile-note-editor').innerHTML = '';
    await refreshMobileNotes();
    showMobileView('list');
}

async function onMobileToggleTrash() {
    if (AppState.isDirty) await saveMobileCurrentNote();
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
