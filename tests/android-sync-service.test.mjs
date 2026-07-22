import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadAndroidSyncService(invoke) {
  const source = await readFile(
    new URL('../app/js/android-sync-service.js', import.meta.url),
    'utf8'
  );
  const window = invoke ? { __TAURI__: { core: { invoke } } } : {};
  const context = { window, globalThis: window };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'js/android-sync-service.js' });
  return context.window.androidSync;
}

async function testAvailabilityAndNativeBoundary() {
  const unavailable = await loadAndroidSyncService();
  assert.equal(unavailable.isAvailable(), false);
  await assert.rejects(() => unavailable.getStatus(), /本机同步服务/);

  const calls = [];
  const service = await loadAndroidSyncService(async (command, payload) => {
    calls.push({ command, payload });
    return {};
  });
  assert.equal(service.isAvailable(), true);
  await service.getStatus();
  await service.startEngine();
  await service.stopEngine();
  await service.getPairingInfo();
  await service.previewDevicePairing('REMOTE-ID', '手机');
  await service.confirmDevicePairing('one-time-token');
  await service.scanFolder();
  await service.scanDeviceQr();
  await service.getBackgroundPolicy();
  await service.setBackgroundPolicy({
    opportunisticSync: true,
    unmeteredOnly: false,
    backgroundSessionEnabled: true,
  });
  await service.requestNotificationPermission();
  await service.requestLocalNetworkPermission();
  await service.openBatterySettings();

  assert.deepEqual(calls.map(call => call.command), [
    'syncthing_status',
    'syncthing_start',
    'syncthing_stop',
    'syncthing_pairing_info',
    'syncthing_preview_device_pairing',
    'syncthing_confirm_device_pairing',
    'syncthing_scan_folder',
    'android_scan_device_qr',
    'android_get_background_policy',
    'android_set_background_policy',
    'android_request_notification_permission',
    'android_request_local_network_permission',
    'android_open_battery_settings',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[4].payload)), {
    request: { deviceId: 'REMOTE-ID', deviceName: '手机' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[5].payload)), {
    request: { confirmationToken: 'one-time-token' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[9].payload)), {
    request: {
      opportunisticSync: true,
      unmeteredOnly: false,
      backgroundSessionEnabled: true,
    },
  });
  assert.equal(JSON.stringify(calls).includes('apiKey'), false);
  assert.equal(JSON.stringify(calls).includes('8386'), false);
}

await testAvailabilityAndNativeBoundary();
console.log('android-sync-service tests passed');
