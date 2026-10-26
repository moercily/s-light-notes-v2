"""Build a tiny test-only IME for real WebView InputConnection composition in an owned AVD."""
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SDK = Path(os.environ.get('ANDROID_HOME', Path.home() / 'Library/Android/sdk'))
JAVA = Path(os.environ.get('JAVA_HOME', '/Applications/Android Studio.app/Contents/jbr/Contents/Home')) / 'bin'
TOOLS = SDK / 'build-tools/36.0.0'
JAR = SDK / 'platforms/android-36/android.jar'
SOURCE = ROOT / 'tests/android-ime'
OUTPUT = ROOT / 'release/qa/slight-qa-ime.apk'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)


def run(args):
    subprocess.run([str(value) for value in args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


with tempfile.TemporaryDirectory(prefix='slight-qa-ime-') as temporary:
    root = Path(temporary)
    classes = root / 'classes'
    classes.mkdir()
    resources = root / 'resources.zip'
    run([TOOLS / 'aapt2', 'compile', '--dir', SOURCE / 'res', '-o', resources])
    run([TOOLS / 'aapt2', 'link', '-o', OUTPUT, '-I', JAR, '--manifest', SOURCE / 'AndroidManifest.xml', resources])
    run([JAVA / 'javac', '-source', '8', '-target', '8', '-classpath', JAR, '-d', classes, SOURCE / 'FixtureIme.java'])
    dex = root / 'dex'
    dex.mkdir()
    run([TOOLS / 'd8', '--min-api', '26', '--lib', JAR, '--output', dex, *classes.rglob('*.class')])
    with zipfile.ZipFile(OUTPUT, 'a') as archive:
        archive.write(dex / 'classes.dex', 'classes.dex')
    key = root / 'qa.p12'
    # Ephemeral test identity, unrelated to the application's release signing material.
    run([JAVA / 'keytool', '-genkeypair', '-keystore', key, '-storepass', 'android', '-keypass', 'android',
        '-alias', 'qa', '-keyalg', 'RSA', '-validity', '2', '-dname', 'CN=Disposable QA'])
    run([TOOLS / 'apksigner', 'sign', '--ks', key, '--ks-pass', 'pass:android', OUTPUT])
print(OUTPUT)
