import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadSyncCenter() {
  const source = await readFile(new URL('../app/js/sync-center.js', import.meta.url), 'utf8');
  const context = {
    window: {},
    globalThis: {},
  };
  context.globalThis = context.window;
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'js/sync-center.js' });
  return context.window.SyncCenter;
}

async function testSeparatesLocalSaveFromP2pSync() {
  const SyncCenter = await loadSyncCenter();
  const model = SyncCenter.createModel({
    appState: {
      isDirty: true,
      storageMode: 'fsa',
      sync: {
        enabled: true,
        connected: true,
        folderId: 'notes',
        folderStatus: { state: 'syncing', needTotalItems: 3 },
        devices: [{ deviceID: 'A' }, { deviceID: 'B' }],
        connections: { connections: { A: { connected: true }, B: { connected: false } } },
      },
    },
  });

  assert.equal(model.localSave.label, '本地保存');
  assert.equal(model.localSave.value, '有未保存修改');
  assert.equal(model.p2pSync.label, 'P2P 同步');
  assert.equal(model.p2pSync.value, '同步中');
  assert.equal(model.folder.value, 'notes');
  assert.equal(model.devices.value, '1 / 2 台设备已连接');
}

async function testExplainsDesktopBackendAvailability() {
  const SyncCenter = await loadSyncCenter();
  const model = SyncCenter.createModel({
    appState: {
      isDirty: false,
      storageMode: 'idb',
      sync: { enabled: false, connected: false },
    },
    desktopStatus: {
      available: false,
      message: 'desktop backend unavailable',
    },
  });

  assert.equal(model.localSave.value, '已保存到浏览器');
  assert.equal(model.engine.value, '桌面同步引擎不可用');
  assert.equal(model.engine.detail, 'desktop backend unavailable');
  assert.equal(model.p2pSync.value, '未配置');
}

async function testReportsDesktopMarkdownStorage() {
  const SyncCenter = await loadSyncCenter();
  const model = SyncCenter.createModel({
    appState: {
      isDirty: false,
      storageMode: 'desktop',
      sync: { enabled: false, connected: false },
    },
  });

  assert.equal(model.localSave.value, '已保存到桌面目录');
  assert.match(model.localSave.detail, /Syncthing/);
}

async function testReportsManagedEngineLifecycle() {
  const SyncCenter = await loadSyncCenter();
  const starting = SyncCenter.createModel({
    appState: { sync: {} },
    desktopStatus: {
      available: true,
      running: false,
      managed: true,
      message: 'waiting for health',
    },
  });
  const running = SyncCenter.createModel({
    appState: { sync: {} },
    desktopStatus: {
      available: true,
      running: true,
      managed: true,
      message: 'healthy',
    },
  });

  assert.equal(starting.engine.value, '正在启动');
  assert.equal(starting.engine.detail, 'waiting for health');
  assert.equal(running.engine.value, '由应用托管');
}

await testSeparatesLocalSaveFromP2pSync();
await testExplainsDesktopBackendAvailability();
await testReportsDesktopMarkdownStorage();
await testReportsManagedEngineLifecycle();

console.log('sync-center tests passed');
