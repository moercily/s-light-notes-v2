import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadStorage(desktopService) {
  const source = await readFile(new URL('../app/js/storage.js', import.meta.url), 'utf8');
  const context = {
    AppState: {
      storageMode: null,
      desktopPaths: null,
      _showTrash: false,
    },
    window: { desktopService },
    extractTitle(content) {
      return (content || '').split('\n')[0].replace(/^#{1,6}\s*/, '') || '未命名';
    },
    generateNoteId(title) {
      return title || '未命名笔记';
    },
    isSyncthingConflictFile(name) {
      return /sync-conflict/i.test(name || '');
    },
    getConflictSourceId(name) {
      return name.replace(/\.md$/i, '').replace(/\.sync-conflict.*$/i, '');
    },
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    source + '\n;globalThis.__storage = { initStorage, listNotes, readNote, saveNote, deleteNote, restoreNote, permanentlyDelete };',
    context,
    { filename: 'js/storage.js' }
  );
  return { context, storage: context.__storage };
}

async function testDesktopModeInitializesAndRoutesStorage() {
  const calls = [];
  const desktopService = {
    isAvailable: () => true,
    ensureNotesFolder: async () => ({ notesDir: '/tmp/notes' }),
    listNotes: async (inTrash) => {
      calls.push(['list', inTrash]);
      return [{
        id: '测试.sync-conflict-20260714',
        content: '# 测试',
        updatedAt: 10,
        inTrash,
      }];
    },
    readNote: async (id, inTrash) => ({ id, content: '# 测试', updatedAt: 10, inTrash }),
    saveNote: async (id, suggestedId, content) => {
      calls.push(['save', id, suggestedId, content]);
      return { id: id || suggestedId, updatedAt: 20 };
    },
    moveToTrash: async (id) => calls.push(['trash', id]),
    restoreNote: async (id) => calls.push(['restore', id]),
    permanentlyDelete: async (id) => calls.push(['delete', id]),
  };
  const { context, storage } = await loadStorage(desktopService);

  assert.equal(await storage.initStorage(), 'desktop');
  assert.equal(context.AppState.storageMode, 'desktop');
  assert.equal(context.AppState.desktopPaths.notesDir, '/tmp/notes');

  const notes = await storage.listNotes();
  assert.equal(notes[0].title, '测试');
  assert.equal(notes[0].isConflict, true);
  assert.equal(notes[0].conflictSourceId, '测试');

  const saved = await storage.saveNote(null, '# 新笔记\n\n正文');
  assert.equal(saved.id, '新笔记');
  assert.equal(saved.title, '新笔记');
  await storage.deleteNote('新笔记');

  context.AppState._showTrash = true;
  await storage.listNotes();
  await storage.restoreNote('新笔记');
  await storage.permanentlyDelete('新笔记');

  assert.deepEqual(calls, [
    ['list', false],
    ['save', null, '新笔记', '# 新笔记\n\n正文'],
    ['trash', '新笔记'],
    ['list', true],
    ['restore', '新笔记'],
    ['delete', '新笔记'],
  ]);
}

await testDesktopModeInitializesAndRoutesStorage();

console.log('desktop-storage tests passed');

// Background refresh checks cheap metadata first and invalidates on a directory revision change.
{
  let revision = 'one', reads = 0;
  const { storage } = await loadStorage({
    isAvailable: () => true,
    ensureNotesFolder: async () => ({ notesDir: '/tmp/notes' }),
    notesRevision: async () => revision,
    listNotes: async () => { reads++; return [{ id: 'n', content: 'body', updatedAt: 1, version: revision }]; },
  });
  await storage.initStorage();
  await storage.listNotes(); await storage.listNotes(); assert.equal(reads, 1);
  revision = 'two'; await storage.listNotes(); assert.equal(reads, 2);
}
