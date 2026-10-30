// Regression coverage for the six frontend findings from the 2026-10-30 review.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = name => readFileSync('app/js/' + name + '.js', 'utf8');
function fixture(mobile = false) {
    const dom = new JSDOM(readFileSync(mobile ? 'app/mobile.html' : 'app/index.html', 'utf8'), { url: 'https://notes.test', runScripts: 'outside-only' });
    const w = dom.window;
    w.setInterval = () => 0;
    const names = mobile ? ['utils', 'editor', 'mobile'] : ['utils', 'editor', 'sidebar', 'app', 'desktop-editing', 'storage'];
    w.eval(names.map(name => source(name).replace(/document.addEventListener\('DOMContentLoaded',[\s\S]*$/, '')).join('\n') + '\nwindow.state = AppState;');
    const editor = w.document.querySelector(mobile ? '#mobile-note-editor' : '#note-editor');
    Object.assign(w.state, { storageMode: mobile ? 'android' : 'idb', _storageReady: true, _editSession: 1, currentNoteId: 'a', isDirty: true });
    w.setEditorMarkdown(editor, 'first');
    w.refreshNoteList = w.refreshMobileNotes = async () => {};
    return { dom, w, editor };
}
function fsaDirectory(initial = {}) {
    const files = new Map(Object.entries(initial));
    return { files, async getFileHandle(name, options = {}) {
        if (!files.has(name) && !options.create) throw Object.assign(new Error(), { name: 'NotFoundError' });
        if (!files.has(name)) files.set(name, '');
        return { async getFile() {
            const content = files.get(name);
            return { text: async () => content, lastModified: 1 };
        }, async createWritable() {
            let content;
            return { async write(value) { content = value; }, async close() { files.set(name, content); }, async abort() {} };
        } };
    }, async removeEntry(name) { files.delete(name); } };
}
function fsaLocks() {
    const queues = new Map();
    return { request(name, operation) {
        const task = (queues.get(name) || Promise.resolve()).catch(() => {}).then(operation);
        queues.set(name, task);
        return task;
    } };
}
function pauseNextFsaCreate(directory) {
    let entered, release, paused = false;
    const ready = new Promise(resolve => { entered = resolve; });
    const resume = new Promise(resolve => { release = resolve; });
    const open = directory.getFileHandle.bind(directory);
    directory.getFileHandle = async (name, options = {}) => {
        if (options.create && !paused) {
            paused = true;
            entered();
            await resume;
        }
        return open(name, options);
    };
    return { ready, release };
}
// F1: an older Web save clears dirty for text typed during its write.
{
    const { dom, w, editor } = fixture();
    let release, disk;
    let writes = 0;
    w.saveNote = async (id, content) => { if (++writes === 1) await new Promise(r => { release = r; }); disk = content; return { id, updatedAt: 1 }; };
    const saving = w.saveCurrentNote(); await tick();
    editor.firstChild.textContent = 'second'; w.state.isDirty = true;
    release(); await saving;
    assert.equal(disk, 'first'); assert.equal(w.getEditorContent(), 'second'); assert.equal(w.state.isDirty, true);
    await w.onNewNote(); assert.equal(w.getEditorContent(), ''); assert.equal(disk, 'second');
    console.log('Web navigation saves input typed during the previous write'); dom.window.close();
}
// F2: FSA uses the same destination filename for trash and restore.
{
    const { dom, w } = fixture();
    const active = fsaDirectory({ 'a.md': 'old' }), trash = fsaDirectory();
    active.getDirectoryHandle = async () => trash;
    w.state.folderHandle = active;
    await w.fsaMoveToTrash('a'); active.files.set('a.md', 'new');
    await w.fsaRestoreFromTrash('a');
    assert.equal(active.files.get('a.md'), 'new'); assert.equal(active.files.get('a-2.md'), 'old'); assert.equal(trash.files.size, 0);
    await w.fsaMoveToTrash('a'); active.files.set('a.md', 'latest'); await w.fsaMoveToTrash('a');
    assert.equal(trash.files.get('a.md'), 'new'); assert.equal(trash.files.get('a-2.md'), 'latest');
    active.files.set('failure.md', 'keep source');
    const open = trash.getFileHandle;
    trash.getFileHandle = async (name, options) => {
        const file = await open.call(trash, name, options);
        if (options?.create) file.createWritable = async () => ({ write: async () => { throw new Error('disk full'); }, abort: async () => {} });
        return file;
    };
    await assert.rejects(w.fsaMoveToTrash('failure'), /disk full/);
    assert.equal(active.files.get('failure.md'), 'keep source');
    console.log('FSA collisions preserve all copies and write failures preserve the source'); dom.window.close();
}
// F2 follow-up: a second tab must not claim a name between a move's check and create.
// Without Web Locks, the same protection still applies within one window.
for (const crossTab of [true, false]) {
    for (const [firstKind, secondKind] of [['restore', 'save'], ['save', 'restore'], ['save', 'save']]) {
        const firstTab = fixture(), secondTab = crossTab ? fixture() : firstTab;
        const active = fsaDirectory(), trash = fsaDirectory({ 'a.md': 'old' });
        active.getDirectoryHandle = async () => trash;
        const locks = crossTab ? fsaLocks() : undefined;
        for (const { w } of new Set([firstTab, secondTab])) {
            Object.assign(w.state, { storageMode: 'fsa', folderHandle: active });
            Object.defineProperty(w.navigator, 'locks', { value: locks });
        }
        const gate = pauseNextFsaCreate(active);
        const run = (tab, kind, content) => kind === 'save' ? tab.w.saveNote(null, content) : tab.w.restoreNote('a');
        try {
            const first = run(firstTab, firstKind, '# a\nfirst');
            await gate.ready;
            const second = run(secondTab, secondKind, '# a\nsecond');
            await tick();
            gate.release();
            const results = await Promise.all([first, second]);
            const expected = [firstKind === 'restore' ? 'old' : '# a\nfirst', secondKind === 'restore' ? 'old' : '# a\nsecond'];
            assert.deepEqual([...active.files], [['a.md', expected[0]], ['a-2.md', expected[1]]]);
            for (const [index, kind] of [firstKind, secondKind].entries()) {
                if (kind === 'save') assert.equal(results[index].id, index ? 'a-2' : 'a');
            }
            assert.equal(trash.files.size, firstKind === 'save' && secondKind === 'save' ? 1 : 0);
        } finally {
            gate.release();
            firstTab.dom.window.close();
            if (crossTab) secondTab.dom.window.close();
        }
    }
}
console.log('FSA restore/create and concurrent creates preserve both versions across tabs and within one window');
// A queued save keeps its selected directory, even if the user switches folders while waiting.
{
    const { dom, w } = fixture();
    const selected = fsaDirectory(), other = fsaDirectory();
    Object.assign(w.state, { storageMode: 'fsa', folderHandle: selected });
    const gate = pauseNextFsaCreate(selected);
    try {
        const first = w.saveNote(null, '# a\nfirst');
        await gate.ready;
        const second = w.saveNote(null, '# a\nsecond');
        w.state.folderHandle = other;
        gate.release();
        await Promise.all([first, second]);
        assert.deepEqual([...selected.files], [['a.md', '# a\nfirst'], ['a-2.md', '# a\nsecond']]);
        assert.equal(other.files.size, 0);
    } finally {
        gate.release();
        dom.window.close();
    }
}
// Trash waits for a pending update to commit; a failed write releases the lock for the next operation.
for (const fails of [false, true]) {
    const firstTab = fixture(), secondTab = fixture();
    const active = fsaDirectory({ 'a.md': 'original' }), trash = fsaDirectory();
    active.getDirectoryHandle = async () => trash;
    const locks = fsaLocks();
    for (const { w } of [firstTab, secondTab]) {
        Object.assign(w.state, { storageMode: 'fsa', folderHandle: active });
        Object.defineProperty(w.navigator, 'locks', { value: locks });
    }
    let aborted = false;
    if (fails) {
        const open = active.getFileHandle.bind(active);
        active.getFileHandle = async (name, options) => {
            const handle = await open(name, options);
            handle.createWritable = async () => ({
                write: async () => { throw new Error('disk full'); },
                abort: async () => { aborted = true; },
            });
            return handle;
        };
    }
    const gate = pauseNextFsaCreate(active);
    try {
        const saving = firstTab.w.saveNote('a', 'updated');
        const outcome = fails ? assert.rejects(saving, /disk full/) : saving;
        await gate.ready;
        const deleting = secondTab.w.deleteNote('a');
        await tick();
        gate.release();
        await Promise.all([outcome, deleting]);
        assert.equal(active.files.size, 0);
        assert.equal(trash.files.get('a.md'), fails ? 'original' : 'updated');
        assert.equal(aborted, fails);
    } finally {
        gate.release();
        firstTab.dom.window.close();
        secondTab.dom.window.close();
    }
}
console.log('FSA queued writes retain their directory and trash preserves the committed content after success or failure');
// F3: switching from a conflict to New never restores editable state.
{
    const { dom, w, editor } = fixture();
    Object.assign(w.state, { storageMode: 'desktop', isDirty: false, _currentNoteReadOnly: true });
    editor.contentEditable = 'false';
    await w.onNewNote();
    assert.equal(w.state._currentNoteReadOnly, false); assert.equal(editor.contentEditable, 'true');
    console.log('New draft immediately restores editor permissions'); dom.window.close();
}
// F4: foregrounding Android while on the list opens the previous editor.
{
    const { dom, w } = fixture(true);
    Object.assign(w.state, { isDirty: false, _view: 'list' });
    Object.defineProperty(w.document, 'visibilityState', { value: 'visible' });
    w.readNote = async id => ({ id, content: 'saved', title: 'A', version: 'v1' });
    await w.onMobileVisibilityChange();
    assert.equal(w.state._view, 'list');
    w.state._view = 'settings'; await w.onMobileVisibilityChange(); assert.equal(w.state._view, 'settings');
    console.log('Android foreground refresh preserves the list and settings page'); dom.window.close();
}
// F5: Android system Back does not invalidate a pending note read.
{
    const { dom, w } = fixture(true);
    Object.assign(w.state, { isDirty: false, _view: 'editor' });
    w.initMobileNavigation();
    let release; w.readNote = () => new Promise(r => { release = r; });
    const reading = w.openMobileNote('b'); await tick();
    w.dispatchEvent(new w.PopStateEvent('popstate', { state: { mobileView: 'list' } })); await tick();
    assert.equal(w.state._view, 'list');
    release({ id: 'b', content: 'B', title: 'B', version: 'v1' }); await reading;
    assert.equal(w.state._view, 'list'); assert.equal(w.state.currentNoteId, 'a');
    console.log('System Back invalidates a delayed mobile note read'); dom.window.close();
}
// Use an IndexedDB implementation with real transaction completion/abort semantics.
{
    const { dom, w } = fixture();
    w.indexedDB = new IDBFactory();
    await w.initIDB();
    await w.idbSaveNote('a', 'original');
    const db = w.getIDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readwrite');
        tx.objectStore('notes').put({ id: 'a-2', content: 'archived', archived: true });
        tx.oncomplete = resolve; tx.onabort = reject;
    });
    w.HTMLInputElement.prototype.click = function () {
        Object.defineProperty(this, 'files', { value: [{ name: 'a.md', text: async () => 'imported' }] });
        this.onchange();
    };
    assert.equal(await w.importNotes(), 1);
    assert.equal((await w.idbReadNote('a')).content, 'original');
    assert.equal((await w.idbReadNote('a-2')).archived, true);
    assert.equal((await w.idbReadNote('a-3')).content, 'imported');
    const copies = await Promise.all([w.idbSaveNote(null, 'copy one', 'a'), w.idbSaveNote(null, 'copy two', 'a')]);
    assert.equal(new Set(copies.map(note => note.id)).size, 2);
    for (const note of copies) assert.equal((await w.idbReadNote(note.id)).id, note.id);
    // A successful write request is not a committed transaction.
    const transaction = db.transaction.bind(db);
    db.transaction = (...args) => {
        const tx = transaction(...args);
        const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = name => {
            const store = objectStore(name), add = store.add.bind(store);
            store.add = value => { const request = add(value); request.addEventListener('success', () => tx.abort()); return request; };
            return store;
        };
        return tx;
    };
    await assert.rejects(w.idbSaveNote(null, 'aborted', 'abort-test'));
    db.transaction = transaction;
    assert.equal(await w.idbReadNote('abort-test'), null);
    db.close();
    console.log('IndexedDB import/concurrent creates preserve originals and aborted writes reject'); dom.window.close();
}
// Queued Web draft saves reuse the assigned ID; failures retain the content.
{
    const { dom, w, editor } = fixture();
    w.state.currentNoteId = null;
    const calls = []; let release;
    w.saveNote = async (id, content) => {
        calls.push({ id, content });
        if (calls.length === 1) await new Promise(r => { release = r; });
        return { id: 'created', updatedAt: 1 };
    };
    const first = w.saveCurrentNote(); await tick();
    editor.firstChild.textContent = 'next'; w.state.isDirty = true;
    const second = w.saveCurrentNote(); release(); await first; await second;
    assert.deepEqual(calls, [{ id: null, content: 'first' }, { id: 'created', content: 'next' }]);
    w.state.isDirty = true; w.console.error = () => {};
    w.saveNote = async () => { throw new Error('disk full'); };
    await assert.rejects(w.onNewNote(), /disk full/);
    assert.equal(w.getEditorContent(), 'next'); assert.equal(w.state.isDirty, true);
    dom.window.close();
}
// A save completion cannot bind an old note to another editor session.
{
    const { dom, w } = fixture(); let release;
    w.saveNote = () => new Promise(r => { release = r; });
    const saving = w.saveCurrentNote(); await tick();
    w.state._editSession++; w.state.currentNoteId = 'other';
    release({ id: 'a', updatedAt: 1 }); await saving;
    assert.equal(w.state.currentNoteId, 'other'); assert.equal(w.state.isDirty, true);
    dom.window.close();
}
console.log('Review regression tests passed');
