"""Two-note signed APK acceptance in an owned, disposable, headless ARM64 AVD."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
SDK = Path(os.environ.get('ANDROID_HOME', Path.home() / 'Library/Android/sdk'))
ADB = SDK / 'platform-tools/adb'
AVDMANAGER = SDK / 'cmdline-tools/latest/bin/avdmanager'
PACKAGE = 'com.slightnotes.v2'


def run(args, timeout=30):
    result = subprocess.run([str(arg) for arg in args], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip())
    return result.stdout


class Device:
    def __init__(self, serial):
        self.serial = serial

    def adb(self, *args):
        return run([ADB, '-s', self.serial, *args])

    def tree(self):
        self.adb('shell', 'rm', '-f', '/sdcard/slight-qa-ui.xml')
        try:
            self.adb('shell', 'uiautomator', 'dump', '/sdcard/slight-qa-ui.xml')
        except RuntimeError as error:
            # Some API 36 dumps exit 1 after successfully writing the fresh tree.
            if 'UI hierchary dumped to: /sdcard/slight-qa-ui.xml' not in str(error):
                raise
        xml = self.adb('exec-out', 'cat', '/sdcard/slight-qa-ui.xml')
        return [node.attrib for node in ET.fromstring(xml).iter('node')]

    def wait(self, predicate, description):
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            nodes = self.tree()
            failure = next((node for node in nodes if '保存失败' in node.get('text', '') or '无法打开笔记存储' in node.get('text', '')), None)
            if failure:
                raise RuntimeError(f"Native storage failed: {failure['text']}")
            result = predicate(nodes)
            if result:
                return result
        raise RuntimeError('UI timed out: ' + description)

    def control(self, key):
        return self.wait(lambda nodes: next((node for node in nodes
            if (node.get('resource-id') == key or node.get('text') == key)
            and node.get('enabled') == 'true'), None), key)

    def note(self, title):
        return self.wait(lambda nodes: next((node for node in nodes
            if node.get('class') == 'android.widget.Button'
            and (node.get('text') == title or node.get('text', '').startswith(title + ' '))), None), title)

    def tap(self, node):
        left, top, right, bottom = map(int, re.findall(r'-?\d+', node['bounds']))
        self.adb('shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2))

    def click(self, key):
        self.tap(self.control(key))

    def text(self, value):
        if not re.fullmatch(r'[A-Za-z0-9 ._-]+', value):
            raise ValueError('This small native input fixture supports ASCII only')
        self.adb('shell', 'input', 'text', value.replace(' ', '%s'))

    def launch(self):
        self.adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
        self.control('mobile-new-note')

    def create(self, title, body):
        self.click('mobile-new-note')
        self.click('mobile-note-editor')
        self.text(title)
        self.adb('shell', 'input', 'keyevent', '66')
        self.text(body)
        self.click('mobile-back')
        self.note(title)

    def reopen(self, title, body):
        self.tap(self.note(title))
        expected = title + '\n' + body
        self.wait(lambda nodes: any(node.get('resource-id') == 'mobile-note-editor'
            and node.get('text') == expected for node in nodes), 'reopened body matches')

    def toggle_trash(self):
        self.click('mobile-settings')
        self.click('mobile-trash')

    def identity(self):
        self.click('mobile-settings')
        self.click('mobile-sync')
        nodes = self.tree()
        start = next((node for node in nodes if node.get('resource-id') == 'mobile-sync-start'), None)
        if start and start.get('enabled') == 'true':
            self.tap(start)
        # This permission is granted only inside this newly created, offline AVD.
        deadline = time.monotonic() + 25
        identity = None
        while time.monotonic() < deadline:
            nodes = self.tree()
            allow = next((node for node in nodes if node.get('resource-id', '').endswith(
                ':id/permission_allow_button')), None)
            if allow:
                self.tap(allow)
                continue
            code = next((node.get('text', '').replace(' ', '').replace('\n', '')
                for node in nodes if node.get('resource-id') == 'mobile-device-code'), '')
            if re.fullmatch(r'[A-Z2-7-]{56,64}', code):
                identity = code
                break
            failure = next((node for node in nodes if node.get('resource-id') == 'mobile-sync-state'
                and node.get('text') in ['启动失败', '需要处理']), None)
            if failure:
                detail = next((node.get('text') for node in nodes
                    if node.get('resource-id') == 'mobile-sync-message'), failure.get('text'))
                raise RuntimeError('Native sync engine did not start: ' + str(detail))
        if identity is None:
            raise RuntimeError('No native Syncthing identity displayed')
        self.click('mobile-sync-stop')
        self.wait(lambda nodes: any(node.get('resource-id') == 'mobile-sync-state'
            and node.get('text') == '已停止' for node in nodes), 'engine stops')
        if 'libsyncthing' in self.adb('shell', 'ps', '-A', '-o', 'NAME'):
            raise RuntimeError('Owned engine process remained after Stop')
        self.click('mobile-sync-back')
        self.click('mobile-settings-back')
        self.control('mobile-new-note')
        return identity


def free_port():
    for port in range(5566, 5600, 2):
        try:
            with socket.socket() as first, socket.socket() as second:
                first.bind(('127.0.0.1', port))
                second.bind(('127.0.0.1', port + 1))
                return port
        except OSError:
            pass
    raise RuntimeError('No free Android emulator port pair')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apk', type=Path, default=ROOT / 'release/android/0.1.0/s-light-notes-0.1.0-arm64-v8a.apk')
    parser.add_argument('--previous-apk', type=Path, help='Optional older signed build to upgrade from')
    parser.add_argument('--identity-only', action='store_true', help='Check offline engine identity across install without creating notes')
    parser.add_argument('--check-identity', action='store_true', help='Also check current-version identity reinstall before the two-note upgrade case')
    args = parser.parse_args()
    apk = args.apk.resolve()
    previous = args.previous_apk.resolve() if args.previous_apk else apk
    for candidate in {apk, previous}:
        if not candidate.is_file():
            raise FileNotFoundError(candidate)
        package = run([SDK / 'cmdline-tools/latest/bin/apkanalyzer', 'manifest', 'application-id', candidate]).strip()
        if package != PACKAGE:
            raise RuntimeError('Expected the s-light notes application ID')

    name = 'slight-headless-qa-' + str(time.time_ns())
    port = free_port()
    device = Device(f'emulator-{port}')
    emulator = None
    created = False
    started = time.monotonic()
    report = {'apkSha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
        'previousApkSha256': hashlib.sha256(previous.read_bytes()).hexdigest(),
        'mode': 'upgrade' if previous != apk else 'same-version-reinstall',
        'notes': 0 if args.identity_only else 2, 'passed': False}
    output = ROOT / 'release/qa'
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / ('android-headless-identity.json' if args.identity_only else 'android-headless.json')
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    try:
        run([AVDMANAGER, 'create', 'avd', '--name', name, '--package',
             'system-images;android-36;google_apis;arm64-v8a', '--device', 'pixel_7'])
        created = True
        with tempfile.TemporaryFile() as log:
            emulator = subprocess.Popen([str(SDK / 'emulator/emulator'), '-avd', name,
                '-port', str(port), '-no-window', '-no-audio', '-no-snapshot', '-no-boot-anim',
                '-cores', '2', '-memory', '1536', '-gpu', 'swiftshader'], stdout=log, stderr=log)
            deadline = time.monotonic() + 100
            while time.monotonic() < deadline:
                if emulator.poll() is not None:
                    raise RuntimeError('Headless emulator exited before boot')
                try:
                    if device.adb('shell', 'getprop', 'sys.boot_completed').strip() == '1':
                        break
                except (RuntimeError, subprocess.TimeoutExpired):
                    pass
                time.sleep(0.25)
            else:
                raise RuntimeError('Android boot timed out')

            device.adb('shell', 'wm', 'size', '480x960')
            device.adb('shell', 'wm', 'density', '240')
            device.adb('shell', 'svc', 'wifi', 'disable')
            device.adb('shell', 'svc', 'data', 'disable')
            for setting in ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']:
                device.adb('shell', 'settings', 'put', 'global', setting, '0')
            device.adb('install', '--no-incremental', str(apk if args.check_identity else previous))
            report['fromVersion'] = run([SDK / 'cmdline-tools/latest/bin/apkanalyzer', 'manifest', 'version-code', previous]).strip()
            device.launch()
            if args.identity_only or args.check_identity:
                # Density is outside the Activity's handled configChanges. Exercise
                # permission launchers after a real Activity recreation, without a window.
                device.adb('shell', 'wm', 'density', '241')
                device.control('mobile-new-note')
                before = device.identity()
                device.adb('shell', 'am', 'force-stop', PACKAGE)
                device.adb('install', '--no-incremental', '-r', str(apk))
                device.launch()
                after = device.identity()
                if before != after:
                    raise RuntimeError('Syncthing device identity changed across signed installation')
                report.update(identityPreserved=True, identityInstallMode='same-version-reinstall',
                    deviceIdSha256=hashlib.sha256(before.encode()).hexdigest(),
                    seconds=round(time.monotonic() - started, 2))
                print('PASS: offline engine starts/stops and preserves device ID across signed installation', flush=True)
                if args.identity_only:
                    report['passed'] = True
                    report_path.write_text(json.dumps(report, indent=2) + '\n')
                    print(json.dumps(report, indent=2), flush=True)
                    return
                # This AVD is owned by this run. Reset this zero-note identity fixture
                # before independently testing the older-version data migration.
                device.adb('uninstall', PACKAGE)
                device.adb('install', '--no-incremental', str(previous))
                device.launch()
            title_a, body_a = 'QA-HEADLESS-A', 'Alpha offline saved content'
            title_b, body_b = 'QA-HEADLESS-B', 'Beta preserved trash content'
            device.create(title_a, body_a)
            device.reopen(title_a, body_a)
            device.click('mobile-back')
            device.create(title_b, body_b)
            device.reopen(title_b, body_b)
            device.click('mobile-delete-note')
            device.click('android:id/button1')
            device.control('mobile-list-view')
            device.toggle_trash()
            device.note(title_b)
            print('PASS: native offline create, save, reopen and trash', flush=True)

            device.adb('shell', 'am', 'force-stop', PACKAGE)
            device.adb('install', '--no-incremental', '-r', str(apk))
            report['toVersion'] = run([SDK / 'cmdline-tools/latest/bin/apkanalyzer', 'manifest', 'version-code', apk]).strip()
            device.launch()
            device.reopen(title_a, body_a)
            device.click('mobile-note-editor')
            device.adb('shell', 'input', 'keyevent', '123')
            device.text(' updated')
            device.click('mobile-back')
            device.reopen(title_a, body_a + ' updated')
            device.click('mobile-back')
            device.toggle_trash()
            device.note(title_b)
            device.click('恢复')
            device.wait(lambda nodes: any(node.get('text') == '回收站为空' for node in nodes), 'trash emptied by restore')
            device.toggle_trash()
            device.reopen(title_b, body_b)
            device.click('mobile-back')
            device.adb('shell', 'am', 'force-stop', PACKAGE)
            device.launch()
            device.reopen(title_a, body_a + ' updated')
            report.update(passed=True, seconds=round(time.monotonic() - started, 2))
            report_path.write_text(json.dumps(report, indent=2) + '\n')
            print('PASS: signed install preserves active/trash notes; edit, restore and cold reopen', flush=True)
            print(json.dumps(report, indent=2), flush=True)
    except Exception as error:
        report.update(error=str(error), seconds=round(time.monotonic() - started, 2))
        report_path.write_text(json.dumps(report, indent=2) + '\n')
        raise
    finally:
        if emulator is not None:
            try:
                device.adb('emu', 'kill')
            except (RuntimeError, subprocess.TimeoutExpired):
                emulator.terminate()
            try:
                emulator.wait(timeout=10)
            except subprocess.TimeoutExpired:
                emulator.kill()
                emulator.wait()
        if created:
            run([AVDMANAGER, 'delete', 'avd', '--name', name])


if __name__ == '__main__':
    main()
