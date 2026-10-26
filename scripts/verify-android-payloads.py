"""Reject APK/AAB artifacts containing an older build of a native library."""
import hashlib
import os
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'src-tauri/gen/android/app/build/outputs'
TARGET = Path(os.environ.get('CARGO_TARGET_DIR', ROOT / 'src-tauri/target'))
JNI = ROOT / 'src-tauri/gen/android/app/src/main/jniLibs'
ABIS = [('arm64-v8a', 'aarch64-linux-android', 'arm64'), ('x86_64', 'x86_64-linux-android', 'x86_64')]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def verify():
    checked = 0
    for abi, target, flavor in ABIS:
        expected = {
            'libs_light_notes_lib.so': TARGET / target / 'release/libs_light_notes_lib.so',
            'libsyncthingnative.so': JNI / abi / 'libsyncthingnative.so',
        }
        for artifact, prefix in [
            (BUILD / f'apk/{flavor}/release/app-{flavor}-release.apk', 'lib'),
            (BUILD / 'bundle/universalRelease/app-universal-release.aab', 'base/lib'),
        ]:
            with zipfile.ZipFile(artifact) as archive:
                for library, source in expected.items():
                    if digest(archive.read(f'{prefix}/{abi}/{library}')) != digest(source.read_bytes()):
                        raise RuntimeError(f'Stale native payload: {artifact.name}: {abi}/{library}')
                    checked += 1
    print(f'PASS: {checked} APK/AAB native payloads match current Rust and Syncthing libraries')


if __name__ == '__main__':
    verify()
