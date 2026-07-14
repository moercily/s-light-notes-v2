import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadDesktopService(contextOverrides = {}) {
  const source = await readFile(new URL('../app/js/desktop-service.js', import.meta.url), 'utf8');
  const context = {
    window: {},
    globalThis: {},
    ...contextOverrides,
  };
  context.window = context.window || {};
  context.globalThis = context.globalThis || context.window;
  context.globalThis.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'js/desktop-service.js' });
  return context.window.desktopService || context.globalThis.desktopService;
}

async function testReportsDesktopAvailability() {
  const service = await loadDesktopService({
    window: {
      __TAURI__: {
        core: {
          invoke: async () => ({}),
        },
      },
    },
  });

  assert.equal(service.isAvailable(), true);
}

async function testReadsAndCreatesDefaultNotesFolder() {
  const calls = [];
  const service = await loadDesktopService({
    window: {
      __TAURI__: {
        core: {
          invoke: async (command) => {
            calls.push(command);
            return {
              appDataDir: '/tmp/app-data',
              notesDir: '/tmp/notes',
            };
          },
        },
      },
    },
  });

  const paths = await service.getAppPaths();
  const ensured = await service.ensureNotesFolder();

  assert.deepEqual(calls, ['get_app_paths', 'ensure_notes_folder']);
  assert.equal(paths.notesDir, '/tmp/notes');
  assert.equal(ensured.appDataDir, '/tmp/app-data');
}

async function testOpenNotesFolderUsesDesktopCommand() {
  const calls = [];
  const service = await loadDesktopService({
    window: {
      __TAURI__: {
        core: {
          invoke: async (command) => {
            calls.push(command);
            return null;
          },
        },
      },
    },
  });

  await service.openNotesFolder();

  assert.deepEqual(calls, ['open_notes_folder']);
}

async function testRoutesDesktopNoteOperations() {
  const calls = [];
  const service = await loadDesktopService({
    window: {
      __TAURI__: {
        core: {
          invoke: async (command, payload) => {
            calls.push({ command, payload });
            return command === 'desktop_list_notes' ? [] : null;
          },
        },
      },
    },
  });

  await service.listNotes(true);
  await service.readNote('测试', false);
  await service.saveNote(null, '新笔记', '# 新笔记');
  await service.moveToTrash('测试');
  await service.restoreNote('测试');
  await service.permanentlyDelete('测试');

  assert.deepEqual(calls.map(call => call.command), [
    'desktop_list_notes',
    'desktop_read_note',
    'desktop_save_note',
    'desktop_move_to_trash',
    'desktop_restore_note',
    'desktop_delete_note',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload)), {
    request: { inTrash: true },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2].payload)), {
    request: { id: null, suggestedId: '新笔记', content: '# 新笔记' },
  });
}

async function testWebModeFailsClearly() {
  const service = await loadDesktopService();

  assert.equal(service.isAvailable(), false);
  await assert.rejects(
    () => service.getAppPaths(),
    /v2 desktop backend is unavailable/
  );
}

await testReportsDesktopAvailability();
await testReadsAndCreatesDefaultNotesFolder();
await testOpenNotesFolderUsesDesktopCommand();
await testRoutesDesktopNoteOperations();
await testWebModeFailsClearly();

console.log('desktop-service tests passed');
