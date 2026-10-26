"""Installed Linux UI acceptance inside a disposable CI VM and Xvfb only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

import pyatspi


def until(check, description, seconds=35):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            value = check()
            if value:
                return value
        except (RuntimeError, LookupError):
            pass
        time.sleep(0.2)
    raise RuntimeError('Timed out: ' + description)


def walk(node, depth=0):
    if depth > 35:
        return
    yield node
    for child in node:
        yield from walk(child, depth + 1)


def find(key):
    for node in walk(pyatspi.Registry.getDesktop(0)):
        attributes = node.getAttributes()
        if node.name == key or any(value in attributes for value in [f'id:{key}', f'html-id:{key}']):
            return node


def click(key):
    node = until(lambda: find(key), key)
    action = node.queryAction()
    if not action.nActions or not action.doAction(0):
        raise RuntimeError('No accessible click: ' + key)


def type_editor(key, text):
    node = until(lambda: find(key), key)
    node.queryComponent().grabFocus()
    subprocess.run(['xdotool', 'type', '--clearmodifiers', '--delay', '1', '--', text], check=True)
    subprocess.run(['xdotool', 'key', '--clearmodifiers', 'ctrl+s'], check=True)


def topmost():
    result = subprocess.run(['xdotool', 'search', '--pid', str(app.pid)], capture_output=True, text=True)
    return any('_NET_WM_STATE_ABOVE' in subprocess.run(
        ['xprop', '-id', wid, '_NET_WM_STATE'], capture_output=True, text=True).stdout
        for wid in result.stdout.split())


if os.environ.get('CI') != 'true' or not os.environ.get('DISPLAY'):
    raise RuntimeError('Requires disposable CI runner, dbus-run-session and Xvfb')
binary = shutil.which('s-light-notes')
if not binary:
    raise RuntimeError('Install the deb package before this check')
report_path = Path('release/qa/linux-installed.json').resolve()
report_path.parent.mkdir(parents=True, exist_ok=True)
report = {'passed': False, 'environment': 'installed deb, Xvfb, AT-SPI, Openbox'}
started = time.monotonic()
app = None
wm = subprocess.Popen(['openbox'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    with tempfile.TemporaryDirectory(prefix='slight-linux-ui-') as root:
        home = Path(root)
        (home / 'Documents').mkdir()
        (home / '.config').mkdir()
        (home / '.config/user-dirs.dirs').write_text('XDG_DOCUMENTS_DIR="$HOME/Documents"\n')
        env = {**os.environ, 'HOME': root, 'XDG_CONFIG_HOME': str(home / '.config'),
            'XDG_DATA_HOME': str(home / '.local/share'), 'NO_AT_BRIDGE': '0', 'GTK_MODULES': 'gail:atk-bridge'}
        with (home / 'runtime.log').open('w') as log:
            app = subprocess.Popen([binary], env=env, stdout=log, stderr=log)
            until(lambda: find('在便签中打开'), 'native initialization')
            click('+ 新建笔记')
            text = 'QA-Linux-installed'
            type_editor('note-editor', text)
            notes = home / 'Documents/s-light-notes'

            def saved(content):
                return any(file.read_text().strip() == content for file in notes.glob('*.md'))

            until(lambda: saved(text), 'editor save')
            click('在便签中打开')
            until(lambda: find('置顶'), 'sticky window')
            click('置顶')
            until(topmost, 'native ABOVE window state')
            click('取消置顶')
            until(lambda: not topmost(), 'native ABOVE removed')
            # Sticky editor has an explicit accessible name, unlike the main editor.
            editor = until(lambda: find('便签正文'), 'sticky editor')
            editor.queryComponent().grabFocus()
            subprocess.run(['xdotool', 'key', '--clearmodifiers', 'ctrl+End'], check=True)
            subprocess.run(['xdotool', 'type', '--clearmodifiers', '--', ' sticky-edited'], check=True)
            click('保存')
            until(lambda: saved(text + ' sticky-edited'), 'sticky save')
            click('保存并关闭')
            until(lambda: not find('便签正文'), 'sticky closes')
            editor = until(lambda: find('note-editor'), 'main editor')
            editor.queryComponent().grabFocus()
            subprocess.run(['xdotool', 'key', '--clearmodifiers', 'alt+F4'], check=True)
            app.wait(timeout=15)
            if app.returncode:
                raise RuntimeError('Application exit code: ' + str(app.returncode))
            report.update(passed=True, checks=['native initialization', 'editor save', 'sticky edit',
                'native topmost toggle', 'normal close'])
except Exception as error:
    report['error'] = str(error)
    # Keep only accessible labels/roles from the isolated fixture for CI diagnostics.
    try:
        report['tree'] = [{'name': node.name, 'role': node.getRoleName(), 'attributes': node.getAttributes()}
            for node in walk(pyatspi.Registry.getDesktop(0))][:250]
    except Exception:
        pass
    raise
finally:
    if app is not None and app.poll() is None:
        app.terminate()
        try:
            app.wait(timeout=5)
        except subprocess.TimeoutExpired:
            app.kill()
            app.wait()
    wm.terminate()
    wm.wait(timeout=5)
    report['seconds'] = round(time.monotonic() - started, 2)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(report, indent=2, ensure_ascii=False))
