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
    w.state.storageMode = 'android'; w.state._editSession = 1; w.state.isDirty = true;
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
