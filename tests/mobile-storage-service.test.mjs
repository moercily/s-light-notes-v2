import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadMobileStorageService(invoke) {
  const source = await readFile(
    new URL('../app/js/mobile-storage-service.js', import.meta.url),
    'utf8'
  );
  const window = invoke
    ? { __TAURI__: { core: { invoke } } }
    : {};
  const context = { window, globalThis: window };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'js/mobile-storage-service.js' });
  return context.window.mobileStorageService;
}

async function testReportsAvailability() {
  const available = await loadMobileStorageService(async () => ({}));
  const unavailable = await loadMobileStorageService();

  assert.equal(available.isAvailable(), true);
  assert.equal(unavailable.isAvailable(), false);
  await assert.rejects(() => unavailable.list(false), /原生存储/);
}

async function testRoutesNativeStorageOperations() {
  const calls = [];
  const service = await loadMobileStorageService(async (command, payload) => {
    calls.push({ command, payload });
    return command === 'mobile_storage_list' ? [] : null;
  });

  await service.ensure();
  await service.list(true);
  await service.read('测试', false);
  await service.save(null, '新笔记', '# 新笔记');
  await service.trash('测试');
  await service.restore('测试');
  await service.delete('测试');

  assert.deepEqual(calls.map(call => call.command), [
    'mobile_storage_ensure',
    'mobile_storage_list',
    'mobile_storage_read',
    'mobile_storage_save',
    'mobile_storage_trash',
    'mobile_storage_restore',
    'mobile_storage_delete',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].payload)), {
    request: { inTrash: true },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[3].payload)), {
    request: { id: null, suggestedId: '新笔记', content: '# 新笔记' },
  });
}

await testReportsAvailability();
await testRoutesNativeStorageOperations();

console.log('mobile-storage-service tests passed');
