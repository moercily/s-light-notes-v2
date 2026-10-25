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
