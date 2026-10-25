import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
if (process.platform !== 'darwin') throw new Error('Run bundle verification on macOS.');
const app = resolve(process.argv[2] || 'src-tauri/target/release/bundle/macos/s-light notes.app');
const plist = join(app, 'Contents/Info.plist');
const value = field => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${field}`, plist], { encoding: 'utf8' }).trim();
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (value('CFBundleShortVersionString') !== version) throw new Error('App version mismatch');
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
const expected = process.arch === 'arm64' ? 'arm64' : 'x86_64';
for (const binary of [value('CFBundleExecutable'), 'syncthing-sidecar']) {
    const arch = execFileSync('lipo', ['-archs', join(app, 'Contents/MacOS', binary)], { encoding: 'utf8' }).trim();
    if (!arch.split(/\s+/).includes(expected)) throw new Error(`Unexpected ${binary} architecture: ${arch}`);
}
console.log(`Verified macOS ${version}: bundle resource seal and native app/sidecar architecture`);
