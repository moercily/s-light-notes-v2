package com.slightnotes.v2

import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

data class StoredNote(
    val id: String,
    val content: String,
    val updatedAt: Long,
    val inTrash: Boolean,
)

class NoteStore(private val root: File) {
    private val notesDir = File(root, "notes")
    private val trashDir = File(notesDir, ".trash")

    init {
        ensureDirectory(notesDir)
        ensureDirectory(trashDir)
    }

    fun ensureReady() {
        ensureDirectory(notesDir)
        ensureDirectory(trashDir)
    }

    fun list(inTrash: Boolean): List<StoredNote> {
        val directory = directory(inTrash)
        return directory.listFiles()
            .orEmpty()
            .asSequence()
            .filter { it.name.endsWith(".md") && isRegularFile(it) }
            .map { readFile(it, inTrash) }
            .sortedByDescending { it.updatedAt }
            .toList()
    }

    fun read(id: String, inTrash: Boolean): StoredNote? {
        val file = noteFile(directory(inTrash), id)
        if (!file.exists()) return null
        requireRegularFile(file)
        return readFile(file, inTrash)
    }

    fun save(id: String?, suggestedId: String, content: String): StoredNote {
        val directory = directory(false)
        val resolvedId = id?.let(::validateId) ?: uniqueId(directory, suggestedId)
        val destination = noteFile(directory, resolvedId)
        if (destination.exists()) requireRegularFile(destination)
        atomicWrite(destination, content)
        return readFile(destination, false)
    }

    fun moveToTrash(id: String): StoredNote {
        return move(id, notesDir, trashDir, true)
    }

    fun restore(id: String): StoredNote {
        return move(id, trashDir, notesDir, false)
    }

    fun delete(id: String) {
        val file = noteFile(trashDir, id)
        requireRegularFile(file)
        check(file.delete()) { "无法永久删除笔记。" }
    }

    private fun move(id: String, sourceDir: File, destinationDir: File, inTrash: Boolean): StoredNote {
        val source = noteFile(sourceDir, id)
        requireRegularFile(source)
        val destinationId = uniqueId(destinationDir, id)
        val destination = noteFile(destinationDir, destinationId)
        moveFile(source, destination)
        return readFile(destination, inTrash)
    }

    private fun readFile(file: File, inTrash: Boolean): StoredNote {
        requireRegularFile(file)
        return StoredNote(
            id = file.name.removeSuffix(".md"),
            content = file.readText(StandardCharsets.UTF_8),
            updatedAt = file.lastModified(),
            inTrash = inTrash,
        )
    }

    private fun uniqueId(directory: File, suggestedId: String): String {
        val base = validateId(suggestedId)
        var candidate = base
        var counter = 2
        while (noteFile(directory, candidate).exists()) {
            candidate = "$base-$counter"
            counter += 1
        }
        return candidate
    }

    private fun noteFile(directory: File, rawId: String): File {
        val id = validateId(rawId)
        val canonicalDirectory = directory.canonicalFile
        val candidate = File(canonicalDirectory, "$id.md").canonicalFile
        require(candidate.parentFile == canonicalDirectory) { "笔记名称超出允许目录。" }
        return candidate
    }

    private fun validateId(rawId: String): String {
        val id = rawId.trim()
        require(id.isNotEmpty() && id != "." && id != "..") { "笔记名称不能为空。" }
        require(id.length <= 180) { "笔记名称过长。" }
        require(id.none { it.isISOControl() || it in INVALID_FILENAME_CHARS }) {
            "笔记名称包含不安全字符。"
        }
        return id
    }

    private fun directory(inTrash: Boolean): File = if (inTrash) trashDir else notesDir

    private fun ensureDirectory(directory: File) {
        check(directory.mkdirs() || directory.isDirectory) { "无法创建笔记目录。" }
        check(!Files.isSymbolicLink(directory.toPath())) { "笔记目录不能是符号链接。" }
    }

    private fun isRegularFile(file: File): Boolean {
        return file.isFile && !Files.isSymbolicLink(file.toPath())
    }

    private fun requireRegularFile(file: File) {
        check(file.exists() && isRegularFile(file)) { "笔记文件不存在或不可用。" }
    }

    private fun atomicWrite(destination: File, content: String) {
        val temporary = File.createTempFile(".note-", ".tmp", destination.parentFile)
        try {
            FileOutputStream(temporary).use { output ->
                output.write(content.toByteArray(StandardCharsets.UTF_8))
                output.fd.sync()
            }
            moveFile(temporary, destination, replaceExisting = true)
        } finally {
            temporary.delete()
        }
    }

    private fun moveFile(source: File, destination: File, replaceExisting: Boolean = false) {
        val options = if (replaceExisting) {
            arrayOf(StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } else {
            arrayOf(StandardCopyOption.ATOMIC_MOVE)
        }
        try {
            Files.move(source.toPath(), destination.toPath(), *options)
        } catch (_: AtomicMoveNotSupportedException) {
            val fallback = if (replaceExisting) {
                arrayOf(StandardCopyOption.REPLACE_EXISTING)
            } else {
                emptyArray()
            }
            Files.move(source.toPath(), destination.toPath(), *fallback)
        }
    }

    companion object {
        private val INVALID_FILENAME_CHARS = setOf('/', '\\', ':', '*', '?', '"', '<', '>', '|')
    }
}
