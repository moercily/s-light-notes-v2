import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync('app/js/desktop-editing.js', 'utf8');
function fixture(saveImpl) {
    let content = 'first';
    const editor = { contentEditable: 'true' };
    const calls = [];
    const listeners = {};
    const state = { currentNoteId: null, isDirty: true, _editSession: 1, _version: null };
    const context = {
        AppState: state,
        document: { hidden: false },
        window: {
            addEventListener() {},
            __TAURI__: {
                core: { invoke: async (name, args) => calls.push({ name, ...args }) },
                event: { listen: async (name, cb) => { listeners[name] = cb; } },
                webviewWindow: { getCurrentWebviewWindow: () => ({ label: 'sticky-1', listen: async (name, cb) => { listeners[name] = cb; } }) },
            },
        },
        desktopService: { saveNote: saveImpl },
        getEditorContent: () => content,
        generateNoteId: () => 'note', extractTitle: value => value, formatDate: () => 'now',
        updateStatusBarText() {}, updateEditorToolbar() {}, refreshNoteList: async () => {},
        readNote: async () => null, loadNoteToEditor() {}, setInterval() {},
        $: id => id === '#note-editor' ? editor : { classList: { add() {}, remove() {} } },
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return { api: context.window.DesktopEditing, state, editor, calls, listeners, setContent: value => { content = value; state.isDirty = true; } };
}

// Fast typing during a pending first write must keep the new input dirty and reuse the new ID.
{
    let release;
    const writes = [];
    const f = fixture(async (...args) => {
        writes.push(args);
        if (writes.length === 1) await new Promise(resolve => { release = resolve; });
        return { id: 'note', version: 'v' + writes.length, updatedAt: 1 };
    });
    const first = f.api.save();
    await new Promise(resolve => setImmediate(resolve));
    f.setContent('second');
    const second = f.api.save();
    release();
    await first;
    await second;
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], ['note', 'note', 'second', 'v1']);
    assert.equal(f.state.isDirty, false);
}

// Saving a blank existing note must write empty content, while an untouched empty draft creates nothing.
{
    const writes = [];
    const f = fixture(async (...args) => { writes.push(args); return { id: 'note', version: 'empty', updatedAt: 1 }; });
    f.setContent('');
    await f.api.save();
    assert.equal(writes.length, 0);
    f.state.currentNoteId = 'note'; f.state._version = 'old'; f.state.isDirty = true;
    await f.api.save();
    assert.equal(writes[0][2], '');
}

// Failed writes must veto close and restore editing, retaining the content and dirty state.
{
    const f = fixture(async () => { throw new Error('disk full'); });
    await f.api.init(); f.api.ready();
    await f.api.flush();
    assert.equal(f.state.isDirty, true);
    assert.equal(f.editor.contentEditable, 'true');
    assert.equal(f.calls.at(-1).success, false);
}

// Close waits for queued writes. During app quit the editor stays frozen until all windows agree.
{
    let release;
    const f = fixture(async () => {
        await new Promise(resolve => { release = resolve; });
        return { id: 'note', version: 'v1', updatedAt: 1 };
    });
    await f.api.init(); f.api.ready();
    const close = f.api.flush({ payload: { token: 42 } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 0);
    assert.equal(f.editor.contentEditable, 'false');
    release(); await close;
    assert.equal(f.calls.at(-1).success, true);
    assert.equal(f.calls.at(-1).token, 42);
    assert.equal(f.editor.contentEditable, 'false');
    f.listeners['desktop-close-cancelled']();
    assert.equal(f.editor.contentEditable, 'true');
}

// Stale versions never turn into a forced write and do not clear dirty edits.
{
    const f = fixture(async () => { throw 'NOTE_CONFLICT: updated elsewhere'; });
    f.state.currentNoteId = 'note'; f.state._version = 'stale';
    await assert.rejects(f.api.save(), error => String(error).includes('NOTE_CONFLICT'));
    assert.equal(f.state.isDirty, true);
    assert.equal(f.state._version, 'stale');
}

// Changing notes during a write must not apply the old save result to the new editor.
{
    let release;
    const f = fixture(async () => {
        await new Promise(resolve => { release = resolve; });
        return { id: 'old', version: 'v1', updatedAt: 1 };
    });
    const save = f.api.save();
    await new Promise(resolve => setImmediate(resolve));
    f.state._editSession = 2; f.state.currentNoteId = 'new';
    release(); await save;
    assert.equal(f.state.currentNoteId, 'new');
    assert.equal(f.state.isDirty, true);
}
console.log('desktop multi-window editing tests passed');

// Closing during IME composition must veto close and preserve the pending candidate.
{
    const f = fixture(async () => { throw new Error('must not write'); });
    await f.api.init(); f.api.ready(); f.state._composing = true;
    await f.api.flush();
    assert.equal(f.state.isDirty, true); assert.equal(f.editor.contentEditable, 'true');
    assert.equal(f.calls.at(-1).success, false);
}

// Exercise the real main-window refresh path rather than a no-op list stub.
{
    const { JSDOM } = await import('jsdom');
    const tick = () => new Promise(resolve => setImmediate(resolve));
    function mainFixture() {
        const dom = new JSDOM(readFileSync('app/index.html', 'utf8'), { url: 'https://notes.test', runScripts: 'outside-only' });
        const w = dom.window;
        w.setInterval = () => 0;
        const scripts = ['utils', 'editor', 'sidebar', 'app', 'desktop-editing'].map(name => {
            const source = readFileSync('app/js/' + name + '.js', 'utf8');
            return name === 'app' ? source.replace(/document.addEventListener\('DOMContentLoaded',[\s\S]*$/, '') : source;
        });
        w.eval(scripts.join('\n') + '\nwindow.AppState = AppState;');
        const acks = [], listeners = {};
        w.__TAURI__ = {
            core: { invoke: async (name, args) => acks.push({ name, ...args }) },
            event: { listen: async (name, cb) => { listeners[name] = cb; } },
            webviewWindow: { getCurrentWebviewWindow: () => ({ label: 'main', listen: async () => {} }) },
        };
        w.listNotes = async () => [];
        Object.assign(w.AppState, { storageMode: 'desktop', currentNoteId: 'a', isDirty: true, _editSession: 1, _version: 'v1' });
        const editor = w.document.querySelector('#note-editor');
        w.setEditorMarkdown(editor, 'unsaved');
        return { dom, w, editor, acks, listeners };
    }
    for (const outcome of ['success', 'failure', 'dirty']) {
        const { dom, w } = mainFixture();
        let release;
        w.desktopService = { saveNote: async () => {
            await new Promise(resolve => { release = resolve; });
            if (outcome === 'failure') throw new Error('disk full');
            return { id: 'a', version: 'v2', updatedAt: 1 };
        } };
        const toggle = w.toggleTrash();
        await tick();
        assert.equal(w.AppState._showTrash, false);
        assert.equal(w.getEditorContent(), 'unsaved');
        // A repeated click while saving must not undo the eventual switch.
        await w.toggleTrash();
        if (outcome === 'dirty') w.setEditorMarkdown(w.document.querySelector('#note-editor'), 'new typing');
        release(); await toggle;
        assert.equal(w.AppState._showTrash, outcome === 'success');
        assert.equal(w.getEditorContent(), outcome === 'success' ? '' : outcome === 'dirty' ? 'new typing' : 'unsaved');
        assert.equal(w.AppState.isDirty, outcome !== 'success');
        dom.window.close();
    }
    {
        const { dom, w } = mainFixture();
        let release;
        w.readNote = () => new Promise(resolve => { release = resolve; });
        w.AppState.isDirty = false;
        const selection = w.onNoteSelected('b');
        await tick();
        await w.toggleTrash();
        release({ id: 'b', content: 'stale read', version: 'b1' });
        await selection;
        assert.equal(w.AppState.currentNoteId, null);
        assert.equal(w.getEditorContent(), '');
        dom.window.close();
    }
    {
        const { dom, w, editor, acks, listeners } = mainFixture();
        w.desktopService = { saveNote: async () => ({ id: 'a', version: 'v2', updatedAt: 1 }) };
        await w.DesktopEditing.init(); w.DesktopEditing.ready();
        await w.DesktopEditing.flush({ payload: { token: 42 } });
        assert.equal(acks.at(-1).success, true);
        assert.equal(editor.contentEditable, 'false');
        await w.refreshNoteList();
        assert.equal(editor.contentEditable, 'false');
        let actions = 0;
        const button = w.document.querySelector('#btn-new-note');
        button.addEventListener('click', () => actions++);
        button.click();
        const key = new w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
        editor.dispatchEvent(key);
        assert.equal(actions, 0);
        assert.equal(key.defaultPrevented, true);
        listeners['desktop-close-cancelled']();
        assert.equal(editor.contentEditable, 'true');
        button.click();
        assert.equal(actions, 1);
        // Cancellation must still respect conflict/trash read-only state.
        w.AppState._showTrash = true;
        listeners['desktop-close-cancelled']();
        assert.equal(editor.contentEditable, 'false');
        dom.window.close();
    }
    console.log('main trash save barrier and quit freeze integration tests passed');
}
