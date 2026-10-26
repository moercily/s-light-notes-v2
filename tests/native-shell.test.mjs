import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync('src-tauri/src/desktop/native-shell-recovery.js', 'utf8');
function fixture({ registrations = [], controller = null, names = [], session = new Map() } = {}) {
    const calls = [];
    const context = {
        window: {}, URL,
        navigator: { serviceWorker: { controller, getRegistrations: async () => registrations } },
        location: { origin: 'http://tauri.localhost', reload: () => calls.push('reload') },
        caches: { keys: async () => names, delete: async name => { calls.push('delete:' + name); return true; } },
        sessionStorage: { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
        console: { error: (...args) => calls.push('error:' + args[0]) },
    };
    return { context, calls, run: () => vm.runInNewContext(source, context) };
}

const worker = { scriptURL: 'http://tauri.localhost/sw.js' };
{
    const session = new Map();
    const f = fixture({ controller: worker, session, names: ['s-light-notes-v2-0.0.1', 'other-cache'] });
    f.context.navigator.serviceWorker.getRegistrations = async () => [{
        active: worker, unregister: async () => { f.calls.push('unregister'); return true; },
    }, {
        active: { scriptURL: 'http://tauri.localhost/unrelated.js' },
        unregister: () => assert.fail('unrelated worker must be retained'),
    }];
    // Native recovery must not access note storage or appearance preferences.
    Object.defineProperty(f.context, 'localStorage', { get: () => assert.fail('preferences must be retained') });
    Object.defineProperty(f.context, 'indexedDB', { get: () => assert.fail('note databases must be retained') });
    await f.run();
    assert.deepEqual(f.calls, ['unregister', 'delete:s-light-notes-v2-0.0.1', 'reload']);
    await f.run();
    assert.equal(f.calls.filter(call => call === 'reload').length, 1);
    const nextPage = fixture({ session });
    await nextPage.run();
    assert.deepEqual(nextPage.calls, []);
    assert.equal(session.size, 0);
}
{
    const f = fixture({ names: ['s-light-notes-v2-old', 'other-cache'] });
    await f.run();
    assert.deepEqual(f.calls, ['delete:s-light-notes-v2-old']);
}
{
    const f = fixture({ registrations: [{ active: worker, unregister: async () => { throw Error('denied'); } }], names: ['s-light-notes-v2-old'] });
    await f.run();
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0], /^error:/);
}
{
    const f = fixture();
    delete f.context.navigator.serviceWorker;
    await f.run();
    assert.deepEqual(f.calls, []);
}
const app = readFileSync('app/js/app.js', 'utf8');
const registerSW = app.slice(app.indexOf('function registerSW()'), app.indexOf('// ========== 回收站'));
for (const native of [{ __TAURI_INTERNALS__: {} }, { __TAURI__: {} }, {}]) {
    const registrations = [];
    vm.runInNewContext(registerSW + '\nregisterSW();', {
        window: native,
        navigator: { serviceWorker: { register: url => { registrations.push(url); return Promise.resolve({ scope: '/' }); } } },
        console: { log() {}, warn() {} },
    });
    assert.deepEqual(registrations, Object.keys(native).length ? [] : ['./sw.js']);
}
console.log('Native shell recovery tests passed.');
