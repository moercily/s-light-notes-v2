// Real, isolated engines on loopback. This does not replace two-machine packaged UI acceptance.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const targets = { 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'linux-x64': 'x86_64-unknown-linux-gnu', 'win32-x64': 'x86_64-pc-windows-msvc.exe' };
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error('No supported native sidecar for this host.');
const binary = resolve(`src-tauri/binaries/syncthing-sidecar-${target}`);
const root = await mkdtemp(join(tmpdir(), 'slight-p2p-'));
const peers = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
    const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
async function until(check, message, timeout = 45000) {
    const start = Date.now();
    while (Date.now() - start < timeout) { try { if (await check()) return; } catch {} await sleep(250); }
    throw new Error(message);
}
async function api(peer, path, body) {
    const response = await fetch(`http://127.0.0.1:${peer.gui}/rest/${path}`, {
        method: body === undefined ? 'GET' : path === 'config' ? 'PUT' : 'POST', headers: { 'X-API-Key': peer.key, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Engine API ${path}: ${response.status}`);
    const text = await response.text(); return text ? JSON.parse(text) : null;
}
async function start(peer) {
    peer.child = spawn(binary, ['serve', '--home', peer.home, '--gui-address', `http://127.0.0.1:${peer.gui}`, '--no-browser', '--no-restart', '--no-upgrade'], {
        env: { ...process.env, STGUIAPIKEY: peer.key }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    peer.errors = ''; peer.child.stderr.on('data', data => { peer.errors = (peer.errors + data).slice(-4000); });
    await until(async () => (await api(peer, 'system/ping')).ping === 'pong', 'Engine did not start: ' + peer.name);
    peer.id = (await api(peer, 'system/status')).myID;
}
async function stop(peer) {
    if (!peer.child || (peer.child.exitCode !== null || peer.child.signalCode !== null)) return;
    const child = peer.child;
    try { await api(peer, 'system/shutdown', {}); } catch {}
    try { await until(() => (child.exitCode !== null || child.signalCode !== null), 'Engine shutdown timeout', 8000); }
    finally { if ((child.exitCode === null && child.signalCode === null)) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } }
}
async function configure(peer, other) {
    const config = await api(peer, 'config');
    config.devices = [...config.devices.filter(device => device.deviceID === peer.id), { deviceID: other.id, name: other.name, addresses: [`tcp://127.0.0.1:${other.listen}`], compression: 'metadata', autoAcceptFolders: false }];
    config.folders = [{ id: 's-light-notes', label: 'Isolated acceptance', path: peer.notes, type: 'sendreceive', devices: [{ deviceID: peer.id }, { deviceID: other.id }], rescanIntervalS: 1, fsWatcherEnabled: false }];
    config.options.listenAddresses = [`tcp://127.0.0.1:${peer.listen}`];
    config.options.globalAnnounceEnabled = false; config.options.localAnnounceEnabled = false;
    config.options.relaysEnabled = false; config.options.natEnabled = false; config.options.urAccepted = -1;
    await api(peer, 'config', config);
}
const scan = peer => api(peer, 'db/scan?folder=s-light-notes', {});
const content = (peer, name) => readFile(join(peer.notes, name), 'utf8');
try {
    for (const name of ['a', 'b']) {
        const peer = { name, home: join(root, name), notes: join(root, name, 'notes'), gui: await port(), listen: await port(), key: randomBytes(32).toString('hex') };
        await mkdir(peer.notes, { recursive: true }); peers.push(peer);
        const result = spawnSync(binary, ['generate', '--home', peer.home, '--no-port-probing'], { stdio: 'pipe' });
        if (result.status !== 0) throw new Error('Cannot generate isolated identity');
        const path = join(peer.home, 'config.xml');
        let xml = await readFile(path, 'utf8');
        for (const field of ['globalAnnounceEnabled', 'localAnnounceEnabled', 'relaysEnabled', 'natEnabled', 'startBrowser']) xml = xml.replace(new RegExp(`<${field}>.*?</${field}>`, 'g'), `<${field}>false</${field}>`);
        xml = xml.replace(/<listenAddress>.*?<\/listenAddress>/g, `<listenAddress>tcp://127.0.0.1:${peer.listen}</listenAddress>`);
        await writeFile(path, xml); await start(peer);
    }
    const [a, b] = peers;
    assert.notEqual(a.id, b.id);
    await configure(a, b); await configure(b, a);
    await until(async () => (await api(a, 'system/connections')).connections[b.id]?.connected, 'Peers did not connect');
    await writeFile(join(a.notes, 'note.md'), '# A 创建\n\n原始内容'); await scan(a);
    await until(async () => await content(b, 'note.md') === '# A 创建\n\n原始内容', 'A to B transfer failed');
    await writeFile(join(b.notes, 'note.md'), '# B 修改\n\n双向更新'); await scan(b);
    await until(async () => await content(a, 'note.md') === '# B 修改\n\n双向更新', 'B to A transfer failed');
    const ids = peers.map(peer => peer.id);
    const hashes = await Promise.all(peers.map(async peer => createHash('sha256').update(await readFile(join(peer.home, 'cert.pem'))).digest('hex')));
    async function pause(peer, paused) {
        const config = await api(peer, 'config');
        config.devices.forEach(device => { if (device.deviceID !== peer.id) device.paused = paused; });
        await api(peer, 'config', config);
    }
    await pause(a, true); await pause(b, true);
    await stop(a); assert.equal((await api(b, 'system/ping')).ping, 'pong'); await stop(b);
    await writeFile(join(a.notes, 'offline-a.md'), 'A 离线新增');
    await writeFile(join(b.notes, 'offline-b.md'), 'B 离线新增');
    await writeFile(join(a.notes, 'note.md'), 'A 离线修改，保留这个版本');
    await writeFile(join(b.notes, 'note.md'), 'B 离线修改，也必须保留另一个版本');
    // Both remote devices remain paused until local offline edits are indexed.
    await start(a); await start(b);
    await scan(a); await scan(b);
    await pause(a, false); await pause(b, false);
    await until(async () => await content(a, 'offline-b.md') === 'B 离线新增' && await content(b, 'offline-a.md') === 'A 离线新增', 'Offline recovery failed');
    await until(async () => (await readdir(a.notes)).some(name => name.includes('.sync-conflict-')) && (await readdir(b.notes)).some(name => name.includes('.sync-conflict-')), 'Conflict copies not retained');
    for (let i = 0; i < peers.length; i++) {
        assert.equal(peers[i].id, ids[i]);
        assert.equal(createHash('sha256').update(await readFile(join(peers[i].home, 'cert.pem'))).digest('hex'), hashes[i]);
        const versions = await Promise.all((await readdir(peers[i].notes)).filter(name => name === 'note.md' || name.includes('.sync-conflict-')).map(name => content(peers[i], name)));
        assert.ok(versions.includes('A 离线修改，保留这个版本'));
        assert.ok(versions.includes('B 离线修改，也必须保留另一个版本'));
    }
    console.log('PASS: two isolated engines; bidirectional transfer, offline recovery, conflicts, stable identity, independent shutdown');
} finally {
    for (const peer of peers) await stop(peer);
    await rm(root, { recursive: true, force: true });
}
