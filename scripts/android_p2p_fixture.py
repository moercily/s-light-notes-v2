"""Real signed Android <-> isolated ARM64 Docker peer; no host product process."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tarfile
import tempfile
import time
from urllib.request import Request, build_opener, ProxyHandler
import uuid

ARCHIVE_SHA256 = '2fcee9688f37df46337b0b78e7d2badc44549481e29eccaa8cdb1e698d79c8c5'
BASE = 'node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914'
FOLDER = 's-light-notes'
PACKAGE = 'com.slightnotes.v2'
PRIVATE = '/data/user/0/' + PACKAGE + '/files'
HTTP = build_opener(ProxyHandler({}))


def run(args, **kwargs):
    result = subprocess.run([str(arg) for arg in args], capture_output=True, text=True, timeout=60, **kwargs)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip())
    return result.stdout.strip()


def until(check, description, seconds=45):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            value = check()
            if value:
                return value
        except Exception as error:
            last = error
        time.sleep(0.3)
    raise RuntimeError(f'{description}: {last or "condition not met"}')


class Api:
    def __init__(self, port, key):
        self.port, self.key = port, key

    def call(self, path, body=None, method=None):
        request = Request(f'http://127.0.0.1:{self.port}/rest/{path}',
            data=None if body is None else json.dumps(body).encode(),
            headers={'X-API-Key': self.key, 'Content-Type': 'application/json'},
            method=method or ('GET' if body is None else 'POST'))
        with HTTP.open(request, timeout=4) as response:
            text = response.read()
            return json.loads(text) if text else None

    def config(self, transform):
        config = self.call('config')
        transform(config)
        self.call('config', config, 'PUT')

    def scan(self):
        self.call('db/scan?folder=' + FOLDER, {})
        until(lambda: self.call('db/status?folder=' + FOLDER)['state'] == 'idle', 'scan indexes offline changes')


BOOTSTRAP = r"""
const fs = require('fs'), cp = require('child_process');
fs.mkdirSync('/data/notes', {recursive:true});
cp.execFileSync('/syncthing', ['generate','--home','/data/config','--no-port-probing']);
let xml = fs.readFileSync('/data/config/config.xml', 'utf8');
for (const field of ['globalAnnounceEnabled','localAnnounceEnabled','relaysEnabled','natEnabled','startBrowser','crashReportingEnabled'])
  xml = xml.replace(new RegExp(`<${field}>.*?</${field}>`, 'g'), `<${field}>false</${field}>`);
xml = xml.replace(/<listenAddress>.*?<\/listenAddress>/g, '<listenAddress>tcp://0.0.0.0:22000</listenAddress>');
fs.writeFileSync('/data/config/config.xml', xml);
const child = cp.spawn('/syncthing', ['serve','--home','/data/config','--gui-address','http://0.0.0.0:8384','--no-browser','--no-restart','--no-upgrade'], {stdio:'inherit'});
process.on('SIGTERM', () => child.kill());
child.on('exit', code => process.exit(code || 0));
"""


class Peer:
    def __init__(self, archive):
        if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
            raise RuntimeError('Peer archive does not match pinned official v2.1.2 ARM64 hash')
        self.name = 'slight-android-peer-' + uuid.uuid4().hex
        self.context = os.environ.get('SLIGHT_DOCKER_CONTEXT', 'colima-slight-qa')
        self.key = secrets.token_hex(32)
        self.api = None
        self.archive = archive

    def docker(self, *args):
        return run(['docker', '--context', self.context, *args])

    def start(self):
        # The build context contains exactly three fixture files, never the repository or keys.
        with tempfile.TemporaryDirectory(prefix='slight-peer-build-') as root:
            path = Path(root)
            with tarfile.open(self.archive) as archive:
                member = next(member for member in archive.getmembers()
                    if member.name.count('/') == 1 and member.name.endswith('/syncthing') and member.isfile())
                (path / 'syncthing').write_bytes(archive.extractfile(member).read())
            (path / 'syncthing').chmod(0o755)
            (path / 'bootstrap.cjs').write_text(BOOTSTRAP)
            (path / 'Dockerfile').write_text(f'FROM {BASE}\nCOPY syncthing /syncthing\nCOPY bootstrap.cjs /bootstrap.cjs\nUSER node\nENTRYPOINT ["node","/bootstrap.cjs"]\n')
            self.docker('build', '-q', '-t', 'slight-android-peer:v2.1.2-arm64', root)
        # The control API and transport are published only on host loopback.
        env = {**os.environ, 'STGUIAPIKEY': self.key, 'STNODEFAULTFOLDER': 'true'}
        run(['docker', '--context', self.context, 'run', '-d', '--name', self.name,
            '--init', '--read-only', '--cpus=1', '--memory=256m', '--pids-limit=64',
            '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--tmpfs=/data:rw,nosuid,uid=1000,gid=1000,size=64m',
            '--tmpfs=/tmp:rw,nosuid,size=8m', '-e', 'STGUIAPIKEY', '-e', 'STNODEFAULTFOLDER',
            '-p', '127.0.0.1::8384', '-p', '127.0.0.1::22000', 'slight-android-peer:v2.1.2-arm64'], env=env)
        gui = int(self.docker('port', self.name, '8384/tcp').rsplit(':', 1)[1])
        self.listen = int(self.docker('port', self.name, '22000/tcp').rsplit(':', 1)[1])
        self.api = Api(gui, self.key)
        try:
            until(lambda: self.api.call('system/ping')['ping'] == 'pong', 'Docker peer ready')
        except Exception as error:
            # These logs belong only to the disposable fixture, never the user's runtime.
            raise RuntimeError(str(error) + '\n' + self.docker('logs', self.name)[-3000:]) from error
        self.id = self.api.call('system/status')['myID']

    def files(self):
        return json.loads(self.docker('exec', self.name, 'node', '-e',
            "const fs=require('fs'); console.log(JSON.stringify(Object.fromEntries(fs.readdirSync('/data/notes').filter(x=>x.endsWith('.md')).map(x=>[x,fs.readFileSync('/data/notes/'+x,'utf8')]))))"))

    def write(self, name, content):
        self.docker('exec', self.name, 'node', '-e',
            "require('fs').writeFileSync('/data/notes/'+process.argv[1],process.argv[2])", name, content)

    def close(self):
        subprocess.run(['docker', '--context', self.context, 'rm', '-f', self.name],
            capture_output=True, timeout=15)


def start_sync(device):
    device.click('mobile-settings')
    device.click('mobile-sync')
    start = next((node for node in device.tree() if node.get('resource-id') == 'mobile-sync-start'), None)
    if start and start.get('enabled') == 'true':
        device.tap(start)
    node = device.wait(lambda nodes: next((node for node in nodes
        if node.get('resource-id') == 'mobile-device-code'
        and re.fullmatch(r'[A-Z2-7-]{56,64}', node.get('text', '').replace('\n', '').replace(' ', ''))), None), 'native device ID')
    identity = node['text'].replace('\n', '').replace(' ', '')
    key = device.adb('exec-out', 'cat', PRIVATE + '/syncthing/runtime/api-key').strip()
    port = int(device.adb('forward', 'tcp:0', 'tcp:8386').strip())
    return identity, Api(port, key)


def leave_sync(device):
    device.click('mobile-sync-back')
    device.click('mobile-settings-back')


def scroll_click(device, key):
    for _ in range(8):
        nodes = device.tree()
        failure = next((node for node in nodes if node.get('resource-id') == 'mobile-sync-state'
            and node.get('text') in ['设备码无效', '配对失败']), None)
        if failure:
            raise RuntimeError('Pairing UI: ' + str([node.get('text') for node in nodes
                if node.get('resource-id') in ['mobile-sync-state', 'mobile-sync-message']]))
        node = next((node for node in nodes if node.get('resource-id') == key
            and node.get('enabled') == 'true' and node.get('bounds') != '[0,0][0,0]'), None)
        if node:
            device.tap(node)
            return
        device.adb('shell', 'input', 'swipe', '240', '800', '240', '400', '200')
    raise RuntimeError('Cannot reach scrolled native UI control: ' + key)


def scroll_top(device):
    for _ in range(3):
        device.adb('shell', 'input', 'swipe', '240', '300', '240', '850', '200')


def conflict_visible(device, source):
    for _ in range(6):
        if any(source in node.get('text', '') and node.get('bounds') != '[0,0][0,0]' for node in device.tree()):
            return
        device.adb('shell', 'input', 'swipe', '240', '800', '240', '450', '200')
    raise RuntimeError('Conflict source not visible in the native sync center')


def isolated_options(config):
    config['options'].update(globalAnnounceEnabled=False, localAnnounceEnabled=False,
        relaysEnabled=False, natEnabled=False, urAccepted=-1, crashReportingEnabled=False,
        reconnectionIntervalS=1,
        listenAddresses=['tcp://0.0.0.0:22000'])


def binding(api, peer_id):
    config = api.call('config')
    folder = next(folder for folder in config['folders'] if folder['id'] == FOLDER)
    devices = sorted(device['deviceID'] for device in folder['devices'])
    if peer_id not in devices or not any(device['deviceID'] == peer_id for device in config['devices']):
        raise RuntimeError('Paired device missing from config or folder sharing')
    return {'id': folder['id'], 'path': folder['path'], 'devices': devices}


def p2p_upgrade(device, peer_archive, previous, apk, report):
    if previous == apk:
        raise RuntimeError('P2P migration requires a distinct older signed APK')
    peer = Peer(peer_archive)
    android = None
    try:
        peer.start()
        device.adb('root')
        device.adb('wait-for-device')
        if device.adb('shell', 'id', '-u').strip() != '0':
            raise RuntimeError('Disposable Google APIs AVD must support adb root (not a physical device)')
        device.adb('shell', 'pm', 'grant', PACKAGE, 'android.permission.NEARBY_WIFI_DEVICES')
        device.adb('shell', 'wm', 'density', '160')
        device.control('mobile-new-note')
        title, body = 'QA-ANDROID-P2P', 'Initial Android content'
        device.create(title, body)
        device.reopen(title, body)
        device.click('mobile-back')
        initial = device.adb('exec-out', 'cat', PRIVATE + '/notes/' + title + '.md')
        identity, android = start_sync(device)
        android.config(isolated_options)
        device.click('mobile-remote-device-id')
        device.text(peer.id)
        device.adb('shell', 'input', 'keyevent', '4')
        device.click('mobile-remote-device-name')
        device.text('QA-Docker')
        device.adb('shell', 'input', 'keyevent', '4')
        device.click('mobile-preview-pairing')
        scroll_click(device, 'mobile-confirm-pairing')
        until(lambda: any(item['deviceID'] == peer.id for item in android.call('config/devices')), 'native UI pairing persists')
        scroll_top(device)

        def address(config):
            next(item for item in config['devices'] if item['deviceID'] == peer.id)['addresses'] = [f'tcp://10.0.2.2:{peer.listen}']
        android.config(address)

        def configure_peer(config):
            isolated_options(config)
            config['devices'] = [item for item in config['devices'] if item['deviceID'] == peer.id] + [
                {'deviceID': identity, 'name': 'QA-Android', 'addresses': ['dynamic'], 'compression': 'metadata'}]
            config['folders'] = [{'id': FOLDER, 'path': '/data/notes', 'type': 'sendreceive',
                'devices': [{'deviceID': identity}, {'deviceID': peer.id}], 'rescanIntervalS': 1, 'fsWatcherEnabled': False}]
        peer.api.config(configure_peer)
        # Use the guest's existing virtual Ethernet. Enabling Wi-Fi here changes
        # 10.0.2.15 to 10.0.2.16 mid-transfer and incurs the engine's pull backoff.
        until(lambda: android.call('system/connections')['connections'].get(peer.id, {}).get('connected'), 'Android connects to isolated Docker peer', 60)
        android.scan()
        first = until(lambda: next((name for name, content in peer.files().items() if content == initial), None), 'Android UI Markdown transfers byte-for-byte to peer')
        second = 'qa-docker.md'
        peer.write(second, 'QA-DOCKER-P2P\n\nInitial Docker content')
        peer.api.scan()
        until(lambda: device.adb('exec-out', 'cat', PRIVATE + '/notes/' + second) == 'QA-DOCKER-P2P\n\nInitial Docker content', 'peer file transfers to Android')
        leave_sync(device)
        device.reopen('QA-DOCKER-P2P', 'Initial Docker content')
        device.click('mobile-back')
        device.reopen(title, body)
        device.click('mobile-note-editor')
        device.adb('shell', 'input', 'keyevent', '123')
        device.text(' bidirectional')
        device.click('mobile-back')
        until(lambda: peer.files().get(first) == initial + ' bidirectional', 'native edit synchronizes')
        report['signedP2P'] = {'pairedThroughNativeUI': True, 'bidirectional': True, 'notes': 2}
        print('PASS: signed Android native pairing, two real files, bidirectional editing', flush=True)

        original_binding = binding(android, peer.id)
        certificate = hashlib.sha256(device.adb('exec-out', 'cat', PRIVATE + '/syncthing/config/cert.pem').encode()).hexdigest()
        device.click('mobile-settings')
        device.click('mobile-sync')
        scroll_top(device)
        device.click('mobile-sync-stop')
        device.wait(lambda nodes: any(node.get('resource-id') == 'mobile-sync-state' and node.get('text') == '已停止' for node in nodes), 'engine stops before upgrade')
        until(lambda: 'libsyncthing' not in device.adb('shell', 'ps', '-A', '-o', 'NAME'), 'no orphan before upgrade')
        device.adb('shell', 'am', 'force-stop', PACKAGE)
        device.adb('install', '--no-incremental', '-r', str(apk))
        device.launch()
        after, android = start_sync(device)
        if identity != after or binding(android, peer.id) != original_binding:
            raise RuntimeError('Cross-version identity or folder binding changed')
        after_certificate = hashlib.sha256(device.adb('exec-out', 'cat', PRIVATE + '/syncthing/config/cert.pem').encode()).hexdigest()
        if certificate != after_certificate:
            raise RuntimeError('Cross-version certificate changed')
        until(lambda: android.call('system/connections')['connections'].get(peer.id, {}).get('connected'), 'paired peer reconnects after upgrade', 60)
        peer.write(second, 'QA-DOCKER-P2P\n\nAfter signed upgrade')
        peer.api.scan()
        until(lambda: device.adb('exec-out', 'cat', PRIVATE + '/notes/' + second) == 'QA-DOCKER-P2P\n\nAfter signed upgrade', 'post-upgrade transfer')
        report['crossVersionIdentity'] = {'deviceIdPreserved': True, 'certificatePreserved': True,
            'folderBindingPreserved': True, 'pairingPreserved': True, 'transferAfterUpgrade': True}
        print('PASS: signed upgrade preserves device ID, certificate, folder binding and pairing; transfer resumes', flush=True)

        # Pause both sides before indexing competing edits so both versions are causally independent.
        def pause(api, remote, value):
            def mutate(config):
                next(item for item in config['devices'] if item['deviceID'] == remote)['paused'] = value
            api.config(mutate)
        pause(android, peer.id, True)
        pause(peer.api, identity, True)
        leave_sync(device)
        device.reopen(title, body + ' bidirectional')
        device.click('mobile-note-editor')
        device.adb('shell', 'input', 'keyevent', '123')
        device.text(' android-offline')
        device.click('mobile-back')
        peer.write(first, title + '\n\nDocker offline competing edit')
        peer.write(second, 'QA-DOCKER-P2P\n\nOffline second note')
        android.scan()
        peer.api.scan()
        pause(android, peer.id, False)
        pause(peer.api, identity, False)
        expected = {initial + ' bidirectional android-offline', title + '\n\nDocker offline competing edit'}
        until(lambda: expected.issubset(set(peer.files().values())) and any('.sync-conflict-' in name for name in peer.files()), 'offline conflict retains both versions', 60)
        until(lambda: device.adb('exec-out', 'cat', PRIVATE + '/notes/' + second) == 'QA-DOCKER-P2P\n\nOffline second note', 'offline independent edit reconnects')
        device.click('mobile-settings')
        device.click('mobile-sync')
        scroll_top(device)
        device.click('mobile-sync-refresh')
        conflict_visible(device, first.removesuffix('.md'))
        scroll_top(device)
        device.click('mobile-sync-stop')
        device.wait(lambda nodes: any(node.get('resource-id') == 'mobile-sync-state' and node.get('text') == '已停止' for node in nodes), 'final native stop')
        until(lambda: 'libsyncthing' not in device.adb('shell', 'ps', '-A', '-o', 'NAME'), 'owned Android child exits')
        if peer.api.call('system/ping')['ping'] != 'pong':
            raise RuntimeError('Stopping Android affected independent Docker peer')
        report['signedP2P'].update(offlineRecovery=True, conflictsRetainBothVersions=True,
            conflictVisibleInNativeUI=True, independentShutdown=True)
        print('PASS: offline recovery, competing edits retain both versions, native conflict UI and independent shutdown', flush=True)
    except Exception:
        try:
            report['failureDiagnostics'] = {'peerFiles': peer.files(),
                'peerFolder': peer.api.call('db/status?folder=' + FOLDER),
                'peerErrors': peer.api.call('folder/errors?folder=' + FOLDER),
                'androidFolder': android.call('db/status?folder=' + FOLDER) if android else None,
                'androidErrors': android.call('folder/errors?folder=' + FOLDER) if android else None,
                'peerLog': peer.docker('logs', '--tail', '40', peer.name),
                'androidLog': device.adb('exec-out', 'tail', '-n', '40', PRIVATE + '/syncthing/logs/process.log'),
                'androidFiles': device.adb('shell', 'ls', '-la', PRIVATE + '/notes')}
        except Exception:
            pass
        raise
    finally:
        if android is not None:
            try:
                android.call('system/shutdown', {})
            except Exception:
                pass
        peer.close()
