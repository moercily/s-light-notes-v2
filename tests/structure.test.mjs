import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const duplicateRootFilesMustNotExist = [
  'docs-v2',
  'index.html',
  'mobile.html',
  'js/sync-center.js',
  'js/sync-service.js',
];

const v2MustExist = [
  'package.json',
  'app/index.html',
  'app/js/storage.js',
  'app/js/desktop-service.js',
  'app/js/sync-center.js',
  'app/js/sync-service.js',
  'src-tauri/tauri.conf.json',
  'src-tauri/icons/icon.ico',
  'src-tauri/binaries/SYNCTHING_SIDECAR.json',
  'src-tauri/binaries/syncthing-sidecar-aarch64-apple-darwin',
  'src-tauri/binaries/syncthing-sidecar-x86_64-apple-darwin',
  'src-tauri/binaries/syncthing-sidecar-x86_64-pc-windows-msvc.exe',
  'src-tauri/binaries/syncthing-sidecar-x86_64-unknown-linux-gnu',
  'src-tauri/binaries/notices/SYNCTHING_LICENSE.txt',
  'docs/V2_DEVELOPMENT_PLAN.md',
  'tests/sync-service.test.mjs',
  'tests/desktop-storage.test.mjs',
];

for (const path of duplicateRootFilesMustNotExist) {
  assert.equal(existsSync(path), false, `${path} should not duplicate the standalone v2 app structure`);
}

for (const path of v2MustExist) {
  assert.equal(existsSync(path), true, `${path} should exist`);
}

const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const tauriMain = readFileSync('src-tauri/src/main.rs', 'utf8');
assert.match(
  tauriMain,
  /#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]/,
  'Windows release builds should not open a console window'
);
assert.equal(
  packageJson.scripts['tauri:build:macos-intel'],
  'tauri build --target x86_64-apple-darwin --bundles app',
  'macOS Intel releases should use the x86_64 target explicitly'
);
assert.equal(
  packageJson.scripts['tauri:build:windows'],
  'tauri build --bundles nsis',
  'Windows releases should use the explicit NSIS package target'
);
assert.equal(
  packageJson.scripts['tauri:build:linux'],
  'tauri build --bundles deb,appimage',
  'Linux releases should build deb and AppImage packages'
);
assert.equal(
  tauriConfig.app.withGlobalTauri,
  true,
  'plain HTML desktop builds require window.__TAURI__ to be injected'
);
assert.deepEqual(
  tauriConfig.bundle.externalBin,
  ['binaries/syncthing-sidecar'],
  'desktop packages should bundle Syncthing through Tauri externalBin'
);

const sidecarMetadata = JSON.parse(readFileSync('src-tauri/binaries/SYNCTHING_SIDECAR.json', 'utf8'));
assert.equal(sidecarMetadata.version, 'v2.1.2');
assert.equal(sidecarMetadata.compatibility.syncthingConfigVersion, 52);
for (const target of [
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'x86_64-pc-windows-msvc',
  'x86_64-unknown-linux-gnu',
]) {
  const artifact = sidecarMetadata.artifacts[target];
  assert.ok(artifact, `${target} sidecar metadata should exist`);
  const sidecarHash = createHash('sha256')
    .update(readFileSync(`src-tauri/binaries/${artifact.binary.name}`))
    .digest('hex');
  assert.equal(sidecarHash, artifact.binary.sha256, `${target} sidecar should match pinned metadata`);
}
assert.deepEqual(
  tauriConfig.bundle.resources,
  ['binaries/SYNCTHING_SIDECAR.json', 'binaries/notices/SYNCTHING_LICENSE.txt'],
  'sidecar provenance and license should ship with the application'
);

const desktopHtml = readFileSync('app/index.html', 'utf8');
for (const id of [
  'sync-advanced-connection',
  'sync-binding-panel',
  'sync-binding-folder-id',
  'sync-binding-devices',
  'sync-preview-binding',
  'sync-binding-preview',
  'sync-open-confirm-binding',
  'sync-binding-confirm-dialog',
  'sync-binding-confirm-summary',
  'sync-binding-confirm-apply',
  'sync-pairing-panel',
  'sync-local-device-id',
  'sync-copy-device-id',
  'sync-toggle-device-qr',
  'sync-local-device-qr',
  'sync-local-device-qr-image',
  'sync-pair-device-id',
  'sync-preview-pairing',
  'sync-confirm-pairing',
]) {
  assert.match(desktopHtml, new RegExp(`id=["']${id}["']`), `${id} should exist in the sync center`);
}

const serviceWorker = readFileSync('app/sw.js', 'utf8');
for (const asset of ['desktop-service.js', 'sync-service.js', 'sync-center.js']) {
  assert.match(serviceWorker, new RegExp(asset.replace('.', '\\.')), `${asset} should be precached`);
}
assert.match(serviceWorker, /CACHE_PREFIX/, 'v2 should only clean up its own cache namespace');

console.log('v2 structure test passed');
