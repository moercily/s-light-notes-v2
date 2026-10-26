/* Runs from native page-load hooks, including when an old worker serves HTML. */
(async function () {
    if (window.__slightShellRecovery) return;
    window.__slightShellRecovery = true;
    const workers = navigator.serviceWorker;
    if (!workers) return;
    const ownsWorker = worker => {
        if (!worker) return false;
        try {
            const url = new URL(worker.scriptURL);
            return url.origin === location.origin && url.pathname === '/sw.js';
        } catch (_) { return false; }
    };
    const registrations = (await workers.getRegistrations()).filter(registration =>
        [registration.active, registration.waiting, registration.installing].some(ownsWorker));
    const controlled = ownsWorker(workers.controller);
    await Promise.all(registrations.map(registration => registration.unregister()));
    if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith('s-light-notes-v2-'))
            .map(name => caches.delete(name)));
    }
    if (controlled || registrations.length) {
        const marker = 's-light-native-shell-recovered';
        if (sessionStorage.getItem(marker)) {
            console.error('Native shell cache recovery did not finish after reloading.');
            return;
        }
        sessionStorage.setItem(marker, '1');
        location.reload();
    } else {
        sessionStorage.removeItem('s-light-native-shell-recovered');
    }
})().catch(error => console.error('Native shell cache recovery failed:', error));
