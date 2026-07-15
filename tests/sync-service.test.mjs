import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadSyncService(contextOverrides = {}) {
  const source = await readFile(new URL('../app/js/sync-service.js', import.meta.url), 'utf8');
  const context = {
    console,
    window: {},
    globalThis: {},
    ...contextOverrides,
  };
  context.window = context.window || {};
  context.globalThis = context.globalThis || context.window;
  context.globalThis.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'js/sync-service.js' });
  return context.window.syncService || context.globalThis.syncService;
}

async function testUsesTauriInvokeWhenAvailable() {
  const calls = [];
  const service = await loadSyncService({
    window: {
      __TAURI__: {
        core: {
          invoke: async (command, payload) => {
            calls.push({ command, payload });
            return { status: 200, body: '{}' };
          },
        },
      },
    },
  });

  const result = await service.scanFolder('notes', { apiKey: 'scan-key' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'syncthing_proxy_request');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload)), {
    request: {
      method: 'POST',
      path: '/rest/db/scan?folder=notes',
      body: null,
      apiKey: 'scan-key',
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {});
}

async function testFallsBackToExistingWebSyncFunctions() {
  const calls = [];
  const service = await loadSyncService({
    window: {
      syncTriggerFolderScan: async (_apiBase, _apiKey, folderId) => {
        calls.push(folderId);
        return { scanned: folderId };
      },
    },
  });

  const result = await service.scanFolder('mobile');

  assert.deepEqual(calls, ['mobile']);
  assert.deepEqual(result, { scanned: 'mobile' });
}

async function testDesktopConnectionReturnsUiCompatibleShape() {
  const calls = [];
  const service = await loadSyncService({
    window: {
      __TAURI__: {
        core: {
          invoke: async (command, payload) => {
            calls.push({ command, payload });
            if (command === 'syncthing_status') {
              return { running: true, available: true, message: 'ok' };
            }
            const path = payload.request.path;
            const bodies = {
              '/rest/system/status': { myID: 'LOCAL-DEVICE' },
              '/rest/config/folders': [{ id: 'notes', label: 'Notes' }],
              '/rest/config/devices': [{ deviceID: 'REMOTE-DEVICE', name: 'Laptop' }],
              '/rest/system/connections': { connections: {} },
              '/rest/db/status?folder=notes': { state: 'idle', needTotalItems: 0 },
            };
            return { status: 200, body: JSON.stringify(bodies[path]) };
          },
        },
      },
    },
  });

  const result = await service.testConnection({ apiKey: 'secret', folderId: 'notes' });

  assert.equal(result.ok, true);
  assert.equal(result.folders.length, 1);
  assert.equal(result.devices.length, 1);
  assert.equal(result.deviceId, 'LOCAL-DEVICE');
  assert.equal(result.folderStatus.state, 'idle');
  assert.equal(result.desktopStatus.running, true);
  const proxyCalls = calls.filter(call => call.command === 'syncthing_proxy_request');
  assert.ok(proxyCalls.length >= 5);
  assert.ok(proxyCalls.every(call => call.payload.request.apiKey === 'secret'));
}

async function testDesktopConnectionReportsApiKeyFailure() {
  const service = await loadSyncService({
    window: {
      __TAURI__: {
        core: {
          invoke: async (command) => {
            if (command === 'syncthing_status') return { running: true, available: true };
            return { status: 403, body: '' };
          },
        },
      },
    },
  });

  const result = await service.testConnection({ apiKey: 'wrong-key' });

  assert.equal(result.ok, false);
  assert.equal(result.error.type, 'auth');
  assert.match(result.error.message, /API Key/);
}

async function testDesktopConfigAssistAndFolderPreviewUseWrappedRequests() {
  const calls = [];
  const service = await loadSyncService({
    window: {
      AppState: { sync: { apiKey: 'saved-key' } },
      __TAURI__: {
        core: {
          invoke: async (command, payload) => {
            calls.push({ command, payload });
            if (command === 'syncthing_apply_folder_config') return { requiresConfirmation: true };
            if (command === 'syncthing_confirm_folder_config') return { applied: true };
            return { status: 200, body: '{}' };
          },
        },
      },
    },
  });

  await service.getConfigAssist();
  const preview = await service.bindNotesFolder('/tmp/notes', 'notes', {
    selectedFolderId: 'existing',
    selectedFolderPath: '/tmp/existing',
    selectedFolderDeviceIds: ['DEVICE-A'],
    deviceIds: ['DEVICE-B'],
    existingFolderIds: ['existing'],
    restartRequired: false,
  });
  const applied = await service.confirmNotesFolder('confirmation-token', ' current-key ');

  const proxyCalls = calls.filter(call => call.command === 'syncthing_proxy_request');
  assert.equal(proxyCalls.length, 3);
  assert.ok(proxyCalls.every(call => call.payload.request.apiKey === 'saved-key'));
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls.at(-2).payload)),
    {
      request: {
        path: '/tmp/notes',
        folderId: 'notes',
        selectedFolderId: 'existing',
        selectedFolderPath: '/tmp/existing',
        selectedFolderDeviceIds: ['DEVICE-A'],
        deviceIds: ['DEVICE-B'],
        existingFolderIds: ['existing'],
        restartRequired: false,
      },
    }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls.at(-1))),
    {
      command: 'syncthing_confirm_folder_config',
      payload: {
        request: {
          confirmationToken: 'confirmation-token',
          apiKey: 'current-key',
        },
      },
    }
  );
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(applied.applied, true);
}

async function testStartEngineInvokesDesktopCommand() {
  const calls = [];
  const service = await loadSyncService({
    window: {
      __TAURI__: {
        core: {
          invoke: async (command) => {
            calls.push(command);
            return { running: true };
          },
        },
      },
    },
  });

  const result = await service.startEngine();

  assert.deepEqual(calls, ['syncthing_start']);
  assert.equal(result.running, true);
}

async function testPairingUsesConstrainedDesktopCommandsWithoutApiKeys() {
  const calls = [];
  const service = await loadSyncService({
    window: {
      __TAURI__: {
        core: {
          invoke: async (command, payload) => {
            calls.push({ command, payload });
            if (command === 'syncthing_pairing_info') return { localDeviceId: 'LOCAL' };
            if (command === 'syncthing_preview_device_pairing') {
              return { confirmationToken: 'token' };
            }
            return { paired: true };
          },
        },
      },
    },
  });

  const info = await service.getPairingInfo();
  const preview = await service.previewDevicePairing(' REMOTE-ID ', ' Laptop ');
  const confirmed = await service.confirmDevicePairing(preview.confirmationToken);

  assert.equal(info.localDeviceId, 'LOCAL');
  assert.equal(confirmed.paired, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { command: 'syncthing_pairing_info', payload: {} },
    {
      command: 'syncthing_preview_device_pairing',
      payload: { request: { deviceId: 'REMOTE-ID', deviceName: 'Laptop' } },
    },
    {
      command: 'syncthing_confirm_device_pairing',
      payload: { request: { confirmationToken: 'token' } },
    },
  ]);
  assert.ok(calls.every(call => !JSON.stringify(call).includes('apiKey')));
}

async function testReportsMissingBackendClearly() {
  const service = await loadSyncService();

  await assert.rejects(
    () => service.startEngine(),
    /v2 desktop backend is unavailable/
  );
}

await testUsesTauriInvokeWhenAvailable();
await testFallsBackToExistingWebSyncFunctions();
await testDesktopConnectionReturnsUiCompatibleShape();
await testDesktopConnectionReportsApiKeyFailure();
await testDesktopConfigAssistAndFolderPreviewUseWrappedRequests();
await testStartEngineInvokesDesktopCommand();
await testPairingUsesConstrainedDesktopCommandsWithoutApiKeys();
await testReportsMissingBackendClearly();

console.log('sync-service tests passed');
