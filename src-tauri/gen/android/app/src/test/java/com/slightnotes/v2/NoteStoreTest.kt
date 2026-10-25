package com.slightnotes.v2

import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NoteStoreTest {
    private lateinit var root: java.io.File
    private lateinit var store: NoteStore

    @Before
    fun setUp() {
        root = Files.createTempDirectory("s-light-notes-test").toFile()
        store = NoteStore(root)
    }

    @After
    fun tearDown() {
        root.deleteRecursively()
    }

    @Test
    fun checkedSavesRejectStaleDeletedAndConflictSources() {
        val first = store.saveChecked(null, "note", "first", null)
        val version = NoteStore.contentVersion(first.content)
        store.saveChecked(first.id, "note", "second", version)
        assertThrows(IllegalStateException::class.java) { store.saveChecked(first.id, "note", "stale", version) }
        assertEquals("second", store.read(first.id, false)?.content)
        store.moveToTrash(first.id)
        assertThrows(IllegalStateException::class.java) { store.saveChecked(first.id, "note", "revive", version) }
        val conflict = store.save(null, "note.sync-conflict-example", "conflict")
        assertThrows(IllegalStateException::class.java) { store.saveChecked(conflict.id, "note", "overwrite", NoteStore.contentVersion(conflict.content)) }
    }

    @Test
    fun savesReadsAndListsMarkdownFiles() {
        val saved = store.save(null, "第一条笔记", "# 第一条笔记\n\n正文")

        assertEquals("第一条笔记", saved.id)
        assertEquals("# 第一条笔记\n\n正文", store.read(saved.id, false)?.content)
        assertEquals(listOf(saved.id), store.list(false).map { it.id })
        assertTrue(java.io.File(root, "notes/${saved.id}.md").isFile)
    }

    @Test
    fun keepsDuplicateNamesAsSeparateFiles() {
        val first = store.save(null, "同名笔记", "第一份")
        val second = store.save(null, "同名笔记", "第二份")

        assertEquals("同名笔记", first.id)
        assertEquals("同名笔记-2", second.id)
    }

    @Test
    fun movesRestoresAndPermanentlyDeletesNotes() {
        val saved = store.save(null, "回收测试", "内容")
        val trashed = store.moveToTrash(saved.id)

        assertNull(store.read(saved.id, false))
        assertNotNull(store.read(trashed.id, true))

        val restored = store.restore(trashed.id)
        assertNotNull(store.read(restored.id, false))
        assertFalse(store.list(true).any { it.id == trashed.id })

        store.moveToTrash(restored.id)
        store.delete(restored.id)
        assertNull(store.read(restored.id, true))
    }

    @Test
    fun rejectsUnsafeNoteIds() {
        assertThrows(IllegalArgumentException::class.java) {
            store.save("../outside", "outside", "内容")
        }
        assertThrows(IllegalArgumentException::class.java) {
            store.read("folder/note", false)
        }
    }
}
