package com.slightnotes.v2

import android.app.Activity
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject

@InvokeArg
class StorageListArgs {
    var inTrash: Boolean = false
}

@InvokeArg
class StorageReadArgs {
    lateinit var id: String
    var inTrash: Boolean = false
}

@InvokeArg
class StorageSaveArgs {
    var id: String? = null
    lateinit var suggestedId: String
    lateinit var content: String
}

@InvokeArg
class StorageTargetArgs {
    lateinit var id: String
}

@TauriPlugin
class AndroidBridgePlugin(activity: Activity) : Plugin(activity) {
    private val appActivity = activity
    private val noteStore by lazy { NoteStore(activity.filesDir) }

    @Command
    fun getPlatformStatus(invoke: Invoke) {
        val engine = SyncthingEngine.snapshot()
        val status = JSObject().apply {
            put("platform", "android")
            put("sdkInt", Build.VERSION.SDK_INT)
            put("engineState", engine.state.value)
        }
        invoke.resolve(status)
    }

    @Command
    fun getEngineStatus(invoke: Invoke) {
        invoke.resolve(engineStatusToJson(SyncthingEngine.snapshot()))
    }

    @Command
    fun startEngine(invoke: Invoke) = resolve(invoke) {
        SyncthingForegroundService.start(appActivity)
        engineStatusToJson(SyncthingEngine.snapshot())
    }

    @Command
    fun stopEngine(invoke: Invoke) = resolve(invoke) {
        SyncthingForegroundService.stop(appActivity)
        engineStatusToJson(SyncthingEngine.snapshot())
    }

    @Command
    fun ensureStorage(invoke: Invoke) = resolve(invoke) {
        noteStore.ensureReady()
        JSObject().put("ready", true)
    }

    @Command
    fun listNotes(invoke: Invoke) = resolve(invoke) {
        val args = invoke.parseArgs(StorageListArgs::class.java)
        val notes = JSArray(noteStore.list(args.inTrash).map(::noteToJson))
        JSObject().put("notes", notes)
    }

    @Command
    fun readNote(invoke: Invoke) = resolve(invoke) {
        val args = invoke.parseArgs(StorageReadArgs::class.java)
        val note = noteStore.read(args.id, args.inTrash)
        JSObject().put("note", note?.let(::noteToJson) ?: JSONObject.NULL)
    }

    @Command
    fun saveNote(invoke: Invoke) = resolve(invoke) {
        val args = invoke.parseArgs(StorageSaveArgs::class.java)
        JSObject().put("note", noteToJson(noteStore.save(args.id, args.suggestedId, args.content)))
    }

    @Command
    fun trashNote(invoke: Invoke) = resolve(invoke) {
        val args = invoke.parseArgs(StorageTargetArgs::class.java)
        JSObject().put("note", noteToJson(noteStore.moveToTrash(args.id)))
    }

    @Command
    fun restoreNote(invoke: Invoke) = resolve(invoke) {
        val args = invoke.parseArgs(StorageTargetArgs::class.java)
        JSObject().put("note", noteToJson(noteStore.restore(args.id)))
    }

    @Command
    fun deleteNote(invoke: Invoke) = resolve(invoke) {
        val args = invoke.parseArgs(StorageTargetArgs::class.java)
        noteStore.delete(args.id)
        JSObject().put("deleted", true)
    }

    private fun resolve(invoke: Invoke, operation: () -> JSObject) {
        try {
            invoke.resolve(operation())
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Android 笔记存储操作失败。")
        }
    }

    private fun noteToJson(note: StoredNote): JSObject {
        return JSObject().apply {
            put("id", note.id)
            put("content", note.content)
            put("updatedAt", note.updatedAt)
            put("inTrash", note.inTrash)
        }
    }

    private fun engineStatusToJson(status: SyncthingEngine.Snapshot): JSObject {
        return JSObject().apply {
            put("mode", "android")
            put("available", status.available)
            put("running", status.running)
            put("managed", true)
            put("engineKind", "androidNative")
            put("engineState", status.state.value)
            put("message", status.message)
            put("deviceId", status.deviceId ?: JSONObject.NULL)
            put("folderId", SyncthingEngine.NOTES_FOLDER_ID)
            put("version", SyncthingEngine.VERSION)
        }
    }
}
