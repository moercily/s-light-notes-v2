import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const tick = () => new Promise(resolve => setImmediate(resolve));
function mobileFixture() {
    const dom = new JSDOM(readFileSync('app/mobile.html', 'utf8'), { url: 'https://notes.test', runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(readFileSync('app/js/utils.js', 'utf8'));
    w.eval(readFileSync('app/js/editor.js', 'utf8'));
    w.eval(readFileSync('app/js/mobile.js', 'utf8').replace(/document.addEventListener\('DOMContentLoaded',[\s\S]*$/, '') + '\nwindow.state = AppState;');
    w.state.storageMode = 'android'; w.state._storageReady = true; w.state._editSession = 1; w.state.isDirty = true;
    w.setEditorMarkdown(w.document.querySelector('#mobile-note-editor'), 'first');
    w.refreshMobileNotes = async () => {};
    return { dom, w, editor: w.document.querySelector('#mobile-note-editor') };
}
{
    const { dom, w, editor } = mobileFixture();
    let release; const calls = [];
    w.saveNote = async (id, content) => {
        calls.push({ id, content });
        if (calls.length === 1) await new Promise(resolve => { release = resolve; });
        return { id: 'note', version: 'v' + calls.length, updatedAt: 1 };
    };
    const first = w.saveMobileCurrentNote(); await tick();
    editor.firstChild.textContent = 'second'; w.state.isDirty = true;
    const second = w.saveMobileCurrentNote(); release(); await first; await second;
    assert.deepEqual(calls, [{ id: null, content: 'first' }, { id: 'note', content: 'second' }]);
    assert.equal(w.state.isDirty, false); assert.equal(w.state._version, 'v2');
    dom.window.close();
}
{
    const { dom, w } = mobileFixture();
    w.saveNote = async () => { throw new Error('NOTE_CONFLICT: updated'); };
    w.console.error = () => {};
    await w.onMobileNewNote();
    assert.equal(w.state.isDirty, true);
    assert.equal(w.getMobileEditorContent(), 'first');
    assert.equal(w.document.querySelector('#mobile-save-copy').hidden, false);
    dom.window.close();
}
{
    const { dom, w } = mobileFixture();
    let saves = 0; w.saveNote = async () => { saves++; return { id: 'note', updatedAt: 1 }; };
    w.state._composing = true;
    await w.saveMobileCurrentNote(); assert.equal(saves, 0); assert.equal(w.state.isDirty, true);
    w.state._composing = false; w.state.currentNoteId = 'note';
    w.setEditorMarkdown(w.document.querySelector('#mobile-note-editor'), '');
    await w.saveMobileCurrentNote(); assert.equal(saves, 1); // Empty existing notes must save.
    dom.window.close();
}
{
    const { dom, w, editor } = mobileFixture();
    let writes = 0; w.saveNote = async () => { writes++; };
    w.setEditorMarkdown(editor, '');
    await w.saveMobileCurrentNote();
    assert.equal(writes, 0); assert.equal(w.state.isDirty, false);
    await w.onMobileNewNote(); assert.equal(w.state.currentNoteId, null);
    dom.window.close();
}
{
    const dom = new JSDOM('<div id="prefs"></div>', { url: 'https://notes.test', runScripts: 'outside-only' });
    const w = dom.window;
    w.localStorage.setItem('s-light-editor-appearance', '{bad json');
    w.eval(readFileSync('app/js/appearance.js', 'utf8'));
    assert.equal(w.Appearance.read().size, '16');
    w.Appearance.mount(w.document.querySelector('#prefs'));
    const select = w.document.querySelector('select[aria-label="正文字号"]');
    select.value = '20'; select.dispatchEvent(new w.Event('change'));
    assert.equal(w.document.documentElement.style.getPropertyValue('--editor-size'), '20px');
    assert.equal(w.Appearance.read().size, '20');
    w.localStorage.setItem('s-light-editor-appearance', JSON.stringify({ font: 'bad', size: '9999' }));
    w.Appearance.apply(); assert.equal(w.Appearance.read().size, '16');
    dom.window.close();
}
console.log('mobile save serialization, failed navigation, IME and appearance tests passed');

for (const fails of [true, false]) {
    const { dom, w } = mobileFixture();
    w.state.isDirty = false;
    w.Appearance = { mount() {} };
    for (const name of ['initMobileTheme', 'bindMobileEvents', 'initMobileViewport', 'initMobileNavigation', 'initMobileSyncEntry']) w[name] = () => {};
    w.console.error = () => {};
    let release;
    w.mobileStorageService = { isAvailable: () => true, ensure: async () => {
        if (fails) throw new Error('Command mobile_storage_ensure not allowed by ACL');
    } };
    w.initIDB = () => assert.fail('native initialization must not fall back to browser storage');
    w.refreshMobileNotes = () => new Promise(resolve => { release = resolve; });
    const opening = w.initMobileApp();
    await tick();
    assert.equal(w.document.querySelector('#mobile-new-note').disabled, true);
    assert.equal(w.state._storageReady, false);
    if (!fails) release();
    await opening;
    assert.equal(w.state._storageReady, !fails);
    assert.equal(w.document.querySelector('#mobile-new-note').disabled, fails);
    if (fails) {
        assert.equal(w.state.storageMode, null);
        assert.match(w.document.querySelector('#mobile-note-list [role="alert"]').textContent, /无法打开笔记存储/);
        await w.onMobileNewNote();
        assert.equal(w.state._view, 'list');
        assert.equal(w.getMobileEditorContent(), 'first');
    }
    dom.window.close();
}
console.log('mobile storage initialization gate tests passed');
