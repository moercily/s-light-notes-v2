// Test-only CDP connection inside the disposable Windows VM. Never enable this in product configuration.
import assert from 'node:assert/strict';

if (process.env.CI !== 'true' || process.platform !== 'win32') throw new Error('Requires disposable Windows CI VM');
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback debugging port');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 30000) {
    const deadline = Date.now() + timeout;
    let error;
    while (Date.now() < deadline) {
        try { const value = await check(); if (value) return value; } catch (caught) { error = caught; }
        await delay(200);
    }
    throw new Error(`${label}: ${error?.message || 'condition not met'}`);
}
const target = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    return (await response.json()).find(page => page.type === 'page' && page.url.startsWith('http://tauri.localhost/'));
}, 'find installed WebView2 target');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = event => {
    const data = JSON.parse(event.data);
    const request = pending.get(data.id);
    if (!request) return;
    clearTimeout(request.timeout); pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error.message)); else request.resolve(data.result);
};
function call(method, params = {}) {
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 16000);
        pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
    });
}
async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 14000 });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
    return result.result.value;
}
try {
    await until(() => evaluate('typeof AppState !== "undefined" && AppState.storageMode === "desktop"'), 'native storage before cache fixture');
    await evaluate(`(async () => {
        if (!navigator.serviceWorker || !window.caches) throw Error('No real worker/cache APIs');
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        await new Promise((resolve, reject) => {
            if (navigator.serviceWorker.controller) return resolve();
            const timer = setTimeout(() => reject(Error('Worker did not control page')), 5000);
            navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, {once:true});
        });
        await (await caches.open('s-light-notes-v2-qa-legacy')).put('/qa-legacy', new Response('obsolete'));
        await (await caches.open('qa-unrelated-cache')).put('/qa-preserve', new Response('preserve'));
        localStorage.setItem('qa-native-preserve', 'preserve');
        await new Promise((resolve, reject) => {
            const open = indexedDB.open('qa-native-preserve', 1);
            open.onupgradeneeded = () => open.result.createObjectStore('notes');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => { const db = open.result; const tx = db.transaction('notes', 'readwrite');
                tx.objectStore('notes').put('preserve', 'fixture'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
        });
        return true;
    })()`);
    await call('Page.reload');
    const recovered = await until(() => evaluate(`(async () => {
        if (typeof AppState === 'undefined' || AppState.storageMode !== 'desktop') return false;
        const registrations = await navigator.serviceWorker.getRegistrations();
        const names = await caches.keys();
        if (registrations.length || navigator.serviceWorker.controller || names.some(name => name.startsWith('s-light-notes-v2-'))) return false;
        const saved = await new Promise((resolve, reject) => { const open = indexedDB.open('qa-native-preserve', 1);
            open.onerror = () => reject(open.error); open.onsuccess = () => { const db = open.result;
                const get = db.transaction('notes').objectStore('notes').get('fixture');
                get.onsuccess = () => { db.close(); resolve(get.result); }; get.onerror = () => reject(get.error); }; });
        return {localStorage: localStorage.getItem('qa-native-preserve'), indexedDB: saved,
            unrelatedCache: names.includes('qa-unrelated-cache'), nativeStorage: AppState.storageMode};
    })()`), 'legacy worker/cache recovery preserves data');
    assert.deepEqual(recovered, { localStorage: 'preserve', indexedDB: 'preserve', unrelatedCache: true, nativeStorage: 'desktop' });
    await evaluate(`(async () => { localStorage.removeItem('qa-native-preserve'); await caches.delete('qa-unrelated-cache'); indexedDB.deleteDatabase('qa-native-preserve'); return true; })()`);
    console.log('PASS: installed WebView2 removes its real legacy worker/cache, preserving localStorage, IndexedDB, unrelated cache and native initialization');
} finally {
    socket.close();
    for (const request of pending.values()) clearTimeout(request.timeout);
}
