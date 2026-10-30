// Historical pre-fix reproducer: use the reviewed pre-fix sources. Current regression coverage is tests/review-regressions.test.mjs.
// Run inside the isolated frontend container; assertions describe observed bugs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = name => readFileSync('app/js/' + name + '.js', 'utf8');
function fixture(mobile = false) {
    const dom = new JSDOM(readFileSync(mobile ? 'app/mobile.html' : 'app/index.html', 'utf8'), { url: 'https://notes.test', runScripts: 'outside-only' });
    const w = dom.window;
    w.setInterval = () => 0;
    const names = mobile ? ['utils', 'editor', 'mobile'] : ['utils', 'editor', 'sidebar', 'app', 'desktop-editing', 'storage'];
    w.eval(names.map(name => source(name).replace(/document.addEventListener\('DOMContentLoaded',[\s\S]*$/, '')).join('\n') + '\nwindow.state = AppState; window.reviewSetDB = value => { _idb = value; };');
    const editor = w.document.querySelector(mobile ? '#mobile-note-editor' : '#note-editor');
    Object.assign(w.state, { storageMode: mobile ? 'android' : 'idb', _storageReady: true, _editSession: 1, currentNoteId: 'a', isDirty: true });
    w.setEditorMarkdown(editor, 'first');
    w.refreshNoteList = w.refreshMobileNotes = async () => {};
    return { dom, w, editor };
}
// F1: an older Web save clears dirty for text typed during its write.
{
    const { dom, w, editor } = fixture();
    let release, disk;
    w.saveNote = async (id, content) => { await new Promise(r => { release = r; }); disk = content; return { id, updatedAt: 1 }; };
    const saving = w.saveCurrentNote(); await tick();
    editor.firstChild.textContent = 'second'; w.state.isDirty = true;
    release(); await saving;
    assert.equal(disk, 'first'); assert.equal(w.getEditorContent(), 'second'); assert.equal(w.state.isDirty, false);
    await w.onNewNote(); assert.equal(w.getEditorContent(), '');
    console.log('F1 reproduced: second text discarded by New after old save marked it clean'); dom.window.close();
}
// F2: FSA uses the same destination filename for trash and restore.
{
    const { dom, w } = fixture();
    function directory(initial) {
        const files = new Map(Object.entries(initial));
        return { files, async getFileHandle(name, options = {}) {
            if (!files.has(name) && !options.create) throw Object.assign(new Error(), { name: 'NotFoundError' });
            if (!files.has(name)) files.set(name, '');
            return { async getFile() { return { text: async () => files.get(name) }; }, async createWritable() {
                return { async write(value) { files.set(name, value); }, async close() {} };
            } };
        }, async removeEntry(name) { files.delete(name); } };
    }
    const active = directory({ 'a.md': 'old' }), trash = directory({});
    active.getDirectoryHandle = async () => trash;
    w.state.folderHandle = active;
    await w.fsaMoveToTrash('a'); active.files.set('a.md', 'new');
    await w.fsaRestoreFromTrash('a');
    assert.equal(active.files.get('a.md'), 'old'); assert.equal(trash.files.size, 0);
    console.log('F2 reproduced: restoring old a.md overwrites new a.md and removes trash copy'); dom.window.close();
}
// F3: switching from a conflict to New never restores editable state.
{
    const { dom, w, editor } = fixture();
    Object.assign(w.state, { storageMode: 'desktop', isDirty: false, _currentNoteReadOnly: true });
    editor.contentEditable = 'false';
    await w.onNewNote();
    assert.equal(w.state._currentNoteReadOnly, false); assert.equal(editor.contentEditable, 'false');
    console.log('F3 reproduced: new desktop draft remains contentEditable=false'); dom.window.close();
}
// F4: foregrounding Android while on the list opens the previous editor.
{
    const { dom, w } = fixture(true);
    Object.assign(w.state, { isDirty: false, _view: 'list' });
    Object.defineProperty(w.document, 'visibilityState', { value: 'visible' });
    w.readNote = async id => ({ id, content: 'saved', title: 'A', version: 'v1' });
    await w.onMobileVisibilityChange();
    assert.equal(w.state._view, 'editor');
    console.log('F4 reproduced: Android list resumes into previous editor'); dom.window.close();
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
    assert.equal(w.state._view, 'editor'); assert.equal(w.state.currentNoteId, 'b');
    console.log('F5 reproduced: delayed read reverses system Back to list'); dom.window.close();
}
// F6: Web import routes an explicit filename to the normal update operation.
{
    const { dom, w } = fixture();
    const records = new Map([['a', { id: 'a', content: 'original', createdAt: 1 }]]);
    w.fakeDB = { transaction() { return { objectStore() { return {
        get(id) { const request = {}; queueMicrotask(() => { request.result = records.get(id); request.onsuccess(); }); return request; },
        put(record) { const request = {}; queueMicrotask(() => { records.set(record.id, record); request.onsuccess(); }); return request; },
    }; } }; } };
    w.reviewSetDB(w.fakeDB);
    w.HTMLInputElement.prototype.click = function () {
        Object.defineProperty(this, 'files', { value: [{ name: 'a.md', text: async () => 'imported' }] });
        this.onchange();
    };
    assert.equal(await w.importNotes(), 1);
    assert.equal(records.size, 1); assert.equal(records.get('a').content, 'imported');
    console.log('F6 reproduced: importing a.md silently replaces existing IndexedDB note a'); dom.window.close();
}
