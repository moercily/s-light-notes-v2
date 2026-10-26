"""Small real native-storage/WebView workload and Android composing InputConnection."""
import base64
import hashlib
from pathlib import Path
import tempfile
import time

from android_p2p_fixture import PRIVATE, until

IME = 'com.slightnotes.qa.ime/.FixtureIme'


def input_text(device, text='', mode='commit'):
    encoded = base64.b64encode((text or ' ').encode()).decode()
    result = device.adb('shell', 'am', 'broadcast', '-a', 'com.slightnotes.qa.ime.INPUT',
        '--es', 'mode', mode, '--es', 'payload', encoded)
    if 'result=-1' not in result:
        raise RuntimeError('Test IME has no active WebView InputConnection: ' + result)


def editor_acceptance(device, ime_apk, report):
    device.adb('root')
    device.adb('wait-for-device')
    device.adb('install', '--no-incremental', str(ime_apk))
    # Android's default list includes only enabled IMEs; a freshly installed one
    # must be discovered in the complete list before it can be enabled.
    until(lambda: IME in device.adb('shell', 'ime', 'list', '-a', '-s'), 'test IME registration')
    device.adb('shell', 'ime', 'enable', IME)
    device.adb('shell', 'ime', 'set', IME)
    title, body = 'QA-IME', 'Before composition'
    device.create(title, body)
    files = device.adb('shell', 'ls', PRIVATE + '/notes').splitlines()
    name = next(name for name in files if name.endswith('.md'))
    path = PRIVATE + '/notes/' + name
    original = device.adb('exec-out', 'cat', path)
    device.reopen(title, body)
    device.click('mobile-note-editor')
    device.adb('shell', 'input', 'keyevent', '123')
    input_text(device, ' 中', 'compose')
    input_text(device, ' 中文输入', 'compose')
    time.sleep(1.1)
    if device.adb('exec-out', 'cat', path) != original:
        raise RuntimeError('Partial composing text was persisted before IME commit')
    input_text(device, mode='finish')
    device.click('mobile-back')
    expected = original + ' 中文输入'
    until(lambda: device.adb('exec-out', 'cat', path) == expected, 'committed Chinese text reaches native Markdown')
    device.reopen(title, body + ' 中文输入')
    device.click('mobile-back')
    report['chineseComposition'] = {'environment': 'Android WebView InputConnection with isolated fixture IME',
        'noPartialSave': True, 'commitSavedAndReopened': True, 'physicalKeyboardOrVendorIme': False}
    print('PASS: real Android composing input defers partial save and preserves committed Chinese', flush=True)

    # Populate 200 ordinary UTF-8 files, not a mocked JS notes array.
    source = 'QA-LONG\n\n' + '\n\n'.join(f'第 {index} 段：中文长笔记正文 **加粗** 和 `code`。' for index in range(400))
    with tempfile.TemporaryDirectory(prefix='slight-native-notes-') as temporary:
        fixture = Path(temporary)
        for index in range(199):
            (fixture / f'qa-scale-{index:04d}.md').write_text(f'QA-SCALE-{index:04d}\n原生文件搜索 {index}', encoding='utf-8')
        (fixture / 'qa-long.md').write_text(source, encoding='utf-8')
        device.adb('push', str(fixture) + '/.', PRIVATE + '/notes/')
    uid = device.adb('shell', 'stat', '-c', '%u', PRIVATE).strip()
    if not uid.isdigit() or int(uid) < 10000:
        raise RuntimeError('Unexpected app data owner in disposable AVD')
    device.adb('shell', 'chown', '-R', uid + ':' + uid, PRIVATE + '/notes')
    device.adb('shell', 'am', 'force-stop', 'com.slightnotes.v2')
    started = time.monotonic()
    device.launch()
    device.wait(lambda nodes: any(node.get('class') == 'android.widget.Button'
        and node.get('text', '').startswith('QA-') and node.get('bounds') != '[0,0][0,0]'
        for node in nodes), 'native scale list appears')
    cold_list = time.monotonic() - started
    device.click('mobile-search')
    started = time.monotonic()
    input_text(device, 'QA-SCALE-0198')
    device.note('QA-SCALE-0198')
    search = time.monotonic() - started
    device.click('mobile-search')
    # Replace the query in the guest. Escape would clear an HTML search input.
    device.adb('shell', 'input', 'keycombination', '113', '29')
    input_text(device, 'QA-LONG')
    device.tap(device.note('QA-LONG'))
    device.click('mobile-note-editor')
    device.adb('shell', 'input', 'keycombination', '113', '123')
    started = time.monotonic()
    input_text(device, ' 完成')
    device.click('mobile-back')
    long_path = PRIVATE + '/notes/qa-long.md'
    try:
        until(lambda: device.adb('exec-out', 'cat', long_path) == source + ' 完成', 'long Markdown retains all untouched blocks')
    except Exception:
        actual = device.adb('exec-out', 'cat', long_path)
        first = next((index for index, (a, b) in enumerate(zip(source + ' 完成', actual)) if a != b), min(len(source), len(actual)))
        report['longNoteDiagnostic'] = {'actualBytes': len(actual.encode()), 'expectedBytes': len((source + ' 完成').encode()),
            'insertedAt': actual.find(' 完成'), 'firstDifference': first,
            'expectedContext': (source + ' 完成')[max(0, first - 30):first + 80],
            'actualContext': actual[max(0, first - 30):first + 80]}
        raise
    save = time.monotonic() - started
    report['nativeEditorWorkload'] = {'files': 201, 'generatedScaleFiles': 200, 'longNoteBytes': len(source.encode()),
        'coldLaunchListSeconds': round(cold_list, 2), 'searchSeconds': round(search, 2),
        'longEditAndSaveSeconds': round(save, 2),
        'timingIncludes': 'adb and UI Automator observation overhead; not frame/layout latency',
        'longMarkdownSha256': hashlib.sha256((source + ' 完成').encode()).hexdigest(), 'longRoundtripExact': True}
    print('PASS: 200 native Markdown scale files, search and long-note edit preserve content', flush=True)
