import assert from 'node:assert/strict';
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
assert.equal(
  tauriConfig.app.withGlobalTauri,
  true,
  'plain HTML desktop builds require window.__TAURI__ to be injected'
);

const desktopHtml = readFileSync('app/index.html', 'utf8');
for (const id of [
  'sync-binding-panel',
  'sync-binding-folder-id',
  'sync-binding-devices',
  'sync-preview-binding',
  'sync-binding-preview',
  'sync-open-confirm-binding',
  'sync-binding-confirm-dialog',
  'sync-binding-confirm-summary',
  'sync-binding-confirm-apply',
]) {
  assert.match(desktopHtml, new RegExp(`id=["']${id}["']`), `${id} should exist in the sync center`);
}

const serviceWorker = readFileSync('app/sw.js', 'utf8');
for (const asset of ['desktop-service.js', 'sync-service.js', 'sync-center.js']) {
  assert.match(serviceWorker, new RegExp(asset.replace('.', '\\.')), `${asset} should be precached`);
}
assert.match(serviceWorker, /CACHE_PREFIX/, 'v2 should only clean up its own cache namespace');

console.log('v2 structure test passed');
