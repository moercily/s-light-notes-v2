package com.slightnotes.v2

import android.database.Cursor
import android.database.MatrixCursor
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsProvider
import java.io.File
import java.io.FileNotFoundException

class NotesDocumentsProvider : DocumentsProvider() {
    private val rootId = "notes-root"
    private val defaultRootProjection = arrayOf(
        DocumentsContract.Root.COLUMN_ROOT_ID,
        DocumentsContract.Root.COLUMN_DOCUMENT_ID,
        DocumentsContract.Root.COLUMN_TITLE,
        DocumentsContract.Root.COLUMN_FLAGS,
        DocumentsContract.Root.COLUMN_MIME_TYPES,
        DocumentsContract.Root.COLUMN_AVAILABLE_BYTES,
    )
    private val defaultDocumentProjection = arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
        DocumentsContract.Document.COLUMN_FLAGS,
    )

    private val noteStore: NoteStore by lazy {
        NoteStore(requireNotNull(context).filesDir)
    }

    private val notesDir: File by lazy {
        File(requireNotNull(context).filesDir, "notes").canonicalFile
    }

    override fun onCreate(): Boolean {
        noteStore.ensureReady()
        return true
    }

    override fun queryRoots(projection: Array<out String>?): Cursor {
        val cursor = MatrixCursor(projection ?: defaultRootProjection)
        cursor.newRow().apply {
            add(DocumentsContract.Root.COLUMN_ROOT_ID, rootId)
            add(DocumentsContract.Root.COLUMN_DOCUMENT_ID, rootId)
            add(DocumentsContract.Root.COLUMN_TITLE, "s-light notes")
            add(
                DocumentsContract.Root.COLUMN_FLAGS,
                DocumentsContract.Root.FLAG_SUPPORTS_CREATE or
                    DocumentsContract.Root.FLAG_SUPPORTS_IS_CHILD,
            )
            add(DocumentsContract.Root.COLUMN_MIME_TYPES, MARKDOWN_MIME_TYPES)
            add(DocumentsContract.Root.COLUMN_AVAILABLE_BYTES, notesDir.usableSpace)
        }
        return cursor
    }

    override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor {
        val cursor = MatrixCursor(projection ?: defaultDocumentProjection)
        includeDocument(cursor, documentId)
        return cursor
    }

    override fun queryChildDocuments(
        parentDocumentId: String,
        projection: Array<out String>?,
        sortOrder: String?,
    ): Cursor {
        if (parentDocumentId != rootId) throw FileNotFoundException("未知笔记目录。")
        val cursor = MatrixCursor(projection ?: defaultDocumentProjection)
        noteStore.list(false).forEach { note ->
            includeDocument(cursor, documentId(note.id))
        }
        return cursor
    }

    override fun openDocument(
        documentId: String,
        mode: String,
        signal: CancellationSignal?,
    ): ParcelFileDescriptor {
        signal?.throwIfCanceled()
        val file = noteFile(documentId)
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.parseMode(mode))
    }

    override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String {
        if (parentDocumentId != rootId) throw FileNotFoundException("未知笔记目录。")
        if (mimeType !in ACCEPTED_MIME_TYPES) throw FileNotFoundException("只允许创建 Markdown 笔记。")
        val suggestedId = displayName.removeSuffix(".md").ifBlank { "新建笔记" }
        return documentId(noteStore.save(null, suggestedId, "").id)
    }

    override fun deleteDocument(documentId: String) {
        noteStore.moveToTrash(noteId(documentId))
    }

    override fun getDocumentType(documentId: String): String {
        return if (documentId == rootId) DocumentsContract.Document.MIME_TYPE_DIR else MARKDOWN_MIME
    }

    override fun isChildDocument(parentDocumentId: String, documentId: String): Boolean {
        if (parentDocumentId != rootId || documentId == rootId) return false
        return runCatching { noteFile(documentId).isFile }.getOrDefault(false)
    }

    private fun includeDocument(cursor: MatrixCursor, documentId: String) {
        if (documentId == rootId) {
            cursor.newRow().apply {
                add(DocumentsContract.Document.COLUMN_DOCUMENT_ID, rootId)
                add(DocumentsContract.Document.COLUMN_DISPLAY_NAME, "s-light notes")
                add(DocumentsContract.Document.COLUMN_SIZE, 0L)
                add(DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.MIME_TYPE_DIR)
                add(DocumentsContract.Document.COLUMN_LAST_MODIFIED, notesDir.lastModified())
                add(
                    DocumentsContract.Document.COLUMN_FLAGS,
                    DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE,
                )
            }
            return
        }

        val file = noteFile(documentId)
        cursor.newRow().apply {
            add(DocumentsContract.Document.COLUMN_DOCUMENT_ID, documentId)
            add(DocumentsContract.Document.COLUMN_DISPLAY_NAME, file.name)
            add(DocumentsContract.Document.COLUMN_SIZE, file.length())
            add(DocumentsContract.Document.COLUMN_MIME_TYPE, MARKDOWN_MIME)
            add(DocumentsContract.Document.COLUMN_LAST_MODIFIED, file.lastModified())
            add(
                DocumentsContract.Document.COLUMN_FLAGS,
                DocumentsContract.Document.FLAG_SUPPORTS_WRITE or
                    DocumentsContract.Document.FLAG_SUPPORTS_DELETE,
            )
        }
    }

    private fun documentId(noteId: String): String = "note:$noteId"

    private fun noteId(documentId: String): String {
        if (!documentId.startsWith("note:")) throw FileNotFoundException("未知笔记。")
        return documentId.removePrefix("note:")
    }

    private fun noteFile(documentId: String): File {
        val id = noteId(documentId)
        val file = File(notesDir, "$id.md").canonicalFile
        if (file.parentFile != notesDir || !file.name.endsWith(".md") || !file.isFile) {
            throw FileNotFoundException("笔记不存在或不可开放。")
        }
        return file
    }

    companion object {
        private const val MARKDOWN_MIME = "text/markdown"
        private const val MARKDOWN_MIME_TYPES = "text/markdown\ntext/plain"
        private val ACCEPTED_MIME_TYPES = setOf(MARKDOWN_MIME, "text/plain")
    }
}
