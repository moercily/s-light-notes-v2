import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(readFileSync('app/js/settings/shortcut-recorder.js', 'utf8'), context);
const { combination, create } = context.window.ShortcutRecorder;
const key = (code, extra = {}) => ({ code, key: code.replace(/^Key/, ''), preventDefault() {}, stopImmediatePropagation() {}, ...extra });
assert.equal(combination(key('KeyN', { ctrlKey: true, altKey: true })), 'Control+Alt+KeyN');
assert.equal(combination(key('KeyQ', { metaKey: true, shiftKey: true })), 'Super+Shift+KeyQ');
assert.equal(combination(key('KeyN', { ctrlKey: true, repeat: true })), null);
assert.throws(() => combination(key('KeyN')), /Ctrl/);

function fixture() {
    const calls = []; let value = 'Control+Alt+KeyN', failure = false;
    const recorder = create({ service: {
        beginRecording: async () => { calls.push('suspend'); return 42; },
        endRecording: async token => calls.push(['resume', token]),
        setShortcut: async (shortcut, token) => {
            calls.push(['save', shortcut, token]);
            if (failure) throw new Error('already occupied');
            value = shortcut; return { shortcut };
        },
    } });
    recorder.load(value);
    return { recorder, calls, value: () => value, fail: () => { failure = true; } };
}
// Esc finalizes captured input; Esc by itself persists an empty binding.
{
    const f = fixture(); await f.recorder.begin();
    await f.recorder.key(key('KeyN', { ctrlKey: true, altKey: true }));
    await f.recorder.key(key('Escape'));
    assert.equal(f.value(), 'Control+Alt+KeyN');
    await f.recorder.begin(); await f.recorder.key(key('Escape'));
    assert.equal(f.value(), ''); assert.equal(f.recorder.recording(), false);
}
// Registration failures resume the prior binding; leaving without Esc does not save.
{
    const f = fixture(); f.fail(); await f.recorder.begin();
    await f.recorder.key(key('KeyM', { ctrlKey: true })); await f.recorder.key(key('Escape'));
    assert.equal(f.value(), 'Control+Alt+KeyN');
    assert.deepEqual(f.calls.at(-1), ['resume', 42]);
    await f.recorder.begin(); await f.recorder.cancel();
    assert.equal(f.recorder.recording(), false);
}
// Navigating away during the asynchronous suspension must still restore it.
{
    let resolve; const calls = [];
    const recorder = create({ service: {
        beginRecording: () => new Promise(done => { resolve = done; }),
        endRecording: async token => calls.push(token),
    } });
    const begin = recorder.begin(), cancel = recorder.cancel(); resolve(19);
    await begin; await cancel; assert.deepEqual(calls, [19]); assert.equal(recorder.recording(), false);
}

// A category and an item can be registered after initialization without modifying core.
{
    const nodes = new Map(); let document;
    const element = () => ({ children: [], dataset: {}, classList: { add() {}, remove() {}, contains: () => true },
        append(...items) { this.children.push(...items); }, setAttribute() {}, addEventListener() {},
        focus() { document.activeElement = this; }, querySelectorAll: () => [], getClientRects: () => [1] });
    document = { activeElement: element(), createElement: element, addEventListener() {} };
    const state = { window: {}, console, document, $: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); } };
    vm.createContext(state); vm.runInContext(readFileSync('app/js/settings/core.js', 'utf8'), state);
    const settings = state.window.Settings, calls = [];
    settings.register({ id: 'general', title: 'General', enter: () => calls.push('general-enter'), leave: () => calls.push('general-leave') });
    settings.init(); await settings.open();
    settings.register({ id: 'future', title: 'Future', enter: () => calls.push('future-enter') });
    settings.addItem('future', { id: 'feature', mount: () => ({ enter: () => calls.push('item-enter'), leave: () => calls.push('item-leave') }) });
    await settings.select('future'); await settings.close(); await settings.open('general');
    assert.deepEqual(calls, ['general-enter', 'general-leave', 'future-enter', 'item-enter', 'item-leave', 'general-enter']);
    assert.equal(nodes.get('#settings-content').children.filter(panel => !panel.hidden).length, 1);
}

const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
assert.equal(tauri.version, '../package.json');
assert.equal(readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)[1], metadata.version);
const info = { window: {} }; vm.runInNewContext(readFileSync('app/js/app-info.js', 'utf8'), info);
assert.equal(info.window.AppInfo.version, metadata.version);
assert.ok(JSON.parse(readFileSync('src-tauri/tauri.android.conf.json', 'utf8')).bundle.android.versionCode > 2000000);
console.log('settings lifecycle, shortcut recording and version tests passed');
