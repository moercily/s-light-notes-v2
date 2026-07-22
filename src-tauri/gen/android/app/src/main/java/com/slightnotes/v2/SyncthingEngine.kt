package com.slightnotes.v2

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

internal object SyncthingEnginePolicy {
    fun isSafeApiPath(path: String): Boolean =
        path.startsWith("/") && !path.contains("..") && !path.contains("://")

    fun isValidApiKey(value: String): Boolean = value.matches(Regex("[a-f0-9]{64}"))
}

object SyncthingEngine {
    const val VERSION = "v2.1.2"
    const val NOTES_FOLDER_ID = "s-light-notes"

    private const val API_BASE = "http://127.0.0.1:8386"
    private const val API_KEY_FILE = "api-key"
    private const val BINARY_NAME = "libsyncthingnative.so"
    private const val STARTUP_ATTEMPTS = 80

    enum class State(val value: String) {
        STOPPED("stopped"),
        STARTING("starting"),
        RUNNING("running"),
        STOPPING("stopping"),
        ERROR("error"),
    }

    data class Snapshot(
        val state: State,
        val available: Boolean,
        val running: Boolean,
        val message: String,
        val deviceId: String?,
    )

    private val lock = Any()
    private var process: Process? = null
    private var worker: Thread? = null
    private var state = State.STOPPED
    private var message = "同步引擎尚未启动。"
    private var deviceId: String? = null
    private var stopRequested = false
    private var stopWorker: Thread? = null
    private var appContext: Context? = null

    fun snapshot(): Snapshot = synchronized(lock) {
        val alive = process?.isAlive == true
        Snapshot(
            state = state,
            available = binaryFile(appContext)?.isFile == true,
            running = alive && state == State.RUNNING,
            message = message,
            deviceId = deviceId,
        )
    }

    fun start(context: Context) {
        val application = context.applicationContext
        synchronized(lock) {
            appContext = application
            if (process?.isAlive == true || worker?.isAlive == true) return
            stopRequested = false
            state = State.STARTING
            message = "正在启动本机 P2P 同步引擎。"
            worker = Thread({ runEngine(application) }, "slight-syncthing-engine").apply {
                isDaemon = true
                start()
            }
        }
    }

    fun stop() {
        synchronized(lock) {
            if (stopWorker?.isAlive == true) return
            stopRequested = true
            if (process?.isAlive == true) {
                state = State.STOPPING
                message = "正在停止本机 P2P 同步引擎。"
            }
            stopWorker = Thread(::stopBlocking, "slight-syncthing-stop").apply {
                isDaemon = true
                start()
            }
        }
    }

    private fun stopBlocking() {
        val activeProcess = synchronized(lock) { process }
        if (activeProcess != null && activeProcess.isAlive) {
            runCatching { request("POST", "/rest/system/shutdown") }
            if (!activeProcess.waitFor(4, TimeUnit.SECONDS)) activeProcess.destroy()
            if (!activeProcess.waitFor(1, TimeUnit.SECONDS)) activeProcess.destroyForcibly()
        }

        synchronized(lock) {
            process = null
            state = State.STOPPED
            message = "本机 P2P 同步已停止。"
            stopWorker = null
        }
    }

    private fun runEngine(context: Context) {
        try {
            val runtime = ensureRuntime(context)
            val binary = requireNotNull(binaryFile(context)) { "安装包中缺少 Android 同步引擎。" }
            require(binary.isFile) { "安装包中的 Android 同步引擎不可用。" }

            val child = ProcessBuilder(
                binary.absolutePath,
                "serve",
                "--config", runtime.configDir.absolutePath,
                "--data", runtime.dataDir.absolutePath,
                "--gui-address", "127.0.0.1:8386",
                "--log-file", runtime.logFile.absolutePath,
                "--log-max-old-files=3",
                "--log-max-size=1048576",
                "--no-browser",
                "--no-restart",
                "--no-upgrade",
            ).apply {
                environment()["STGUIAPIKEY"] = runtime.apiKey
                environment()["STNODEFAULTFOLDER"] = "true"
                environment()["STVERSIONEXTRA"] = "s-light-notes-v2-android"
                redirectErrorStream(true)
                redirectOutput(ProcessBuilder.Redirect.to(runtime.processLogFile))
            }.start()

            synchronized(lock) { process = child }
            waitUntilReady(child)
            ensureNotesFolder(runtime.notesDir)
            val status = requestJson("GET", "/rest/system/status")

            synchronized(lock) {
                if (stopRequested) return@synchronized
                val reportedId = status.optString("myID").ifBlank { status.optString("myId") }
                deviceId = reportedId.takeIf { it.isNotBlank() }
                state = State.RUNNING
                message = "本机 P2P 同步正在运行。"
            }

            val exitCode = child.waitFor()
            synchronized(lock) {
                process = null
                if (stopRequested || exitCode == 0) {
                    state = State.STOPPED
                    message = "本机 P2P 同步已停止。"
                } else {
                    state = State.ERROR
                    message = "同步引擎意外退出，退出码：$exitCode。"
                }
            }
        } catch (error: Exception) {
            synchronized(lock) {
                process = null
                state = if (stopRequested) State.STOPPED else State.ERROR
                message = if (stopRequested) "本机 P2P 同步已停止。" else
                    (error.message ?: "Android 同步引擎启动失败。")
            }
        }
    }

    private data class RuntimePaths(
        val configDir: File,
        val dataDir: File,
        val notesDir: File,
        val logFile: File,
        val processLogFile: File,
        val apiKey: String,
    )

    private fun ensureRuntime(context: Context): RuntimePaths {
        val root = File(context.filesDir, "syncthing")
        val configDir = File(root, "config")
        val dataDir = File(root, "data")
        val logDir = File(root, "logs")
        val runtimeDir = File(root, "runtime")
        val notesDir = File(context.filesDir, "notes")
        listOf(configDir, dataDir, logDir, runtimeDir, notesDir).forEach {
            require(it.isDirectory || it.mkdirs()) { "无法创建同步引擎私有目录。" }
        }
        val apiKey = loadOrCreateApiKey(File(runtimeDir, API_KEY_FILE))
        return RuntimePaths(
            configDir,
            dataDir,
            notesDir,
            File(logDir, "syncthing.log"),
            File(logDir, "process.log"),
            apiKey,
        )
    }

    private fun loadOrCreateApiKey(file: File): String {
        if (file.isFile) {
            val existing = file.readText().trim()
            if (SyncthingEnginePolicy.isValidApiKey(existing)) return existing
        }
        val bytes = ByteArray(32).also(SecureRandom()::nextBytes)
        val key = bytes.joinToString("") { "%02x".format(it) }
        val temporary = File(file.parentFile, "${file.name}.tmp")
        temporary.writeText(key)
        if (file.exists()) require(file.delete()) { "无法替换已损坏的同步引擎凭据。" }
        require(temporary.renameTo(file)) { "无法保存同步引擎凭据。" }
        return key
    }

    private fun waitUntilReady(child: Process) {
        repeat(STARTUP_ATTEMPTS) {
            if (stopRequested) error("同步启动已取消。")
            if (!child.isAlive) error("同步引擎在启动期间退出。")
            val healthy = runCatching {
                request("GET", "/rest/noauth/health", authenticate = false).first in 200..299
            }.getOrDefault(false)
            if (healthy) return
            Thread.sleep(250)
        }
        error("同步引擎启动超时。")
    }

    private fun ensureNotesFolder(notesDir: File) {
        val folders = JSONArray(request("GET", "/rest/config/folders").second)
        for (index in 0 until folders.length()) {
            val folder = folders.getJSONObject(index)
            if (File(folder.optString("path")).canonicalFile == notesDir.canonicalFile) return
            require(folder.optString("id") != NOTES_FOLDER_ID) {
                "同步文件夹 ID 已被其他目录占用。"
            }
        }

        val folder = requestJson("GET", "/rest/config/defaults/folder")
        folder.put("id", NOTES_FOLDER_ID)
        folder.put("label", "s-light notes")
        folder.put("path", notesDir.canonicalPath)
        folder.put("devices", JSONArray())
        val result = request("POST", "/rest/config/folders", folder.toString())
        require(result.first in 200..299) { "无法绑定 Android 笔记同步目录。" }

        val verified = JSONArray(request("GET", "/rest/config/folders").second)
        require((0 until verified.length()).any { index ->
            val item = verified.getJSONObject(index)
            item.optString("id") == NOTES_FOLDER_ID &&
                File(item.optString("path")).canonicalFile == notesDir.canonicalFile
        }) { "Android 笔记同步目录回读验证失败。" }
    }

    private fun requestJson(method: String, path: String): JSONObject {
        val response = request(method, path)
        require(response.first in 200..299) { "同步引擎返回 HTTP ${response.first}。" }
        return JSONObject(response.second)
    }

    private fun request(
        method: String,
        path: String,
        body: String? = null,
        authenticate: Boolean = true,
    ): Pair<Int, String> {
        require(SyncthingEnginePolicy.isSafeApiPath(path)) {
            "同步引擎请求路径无效。"
        }
        val context = requireNotNull(appContext) { "Android 同步上下文尚未初始化。" }
        val apiKey = loadOrCreateApiKey(File(File(context.filesDir, "syncthing/runtime"), API_KEY_FILE))
        val connection = URL(API_BASE + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 1500
            connection.readTimeout = 3000
            connection.useCaches = false
            if (authenticate) connection.setRequestProperty("X-API-Key", apiKey)
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            return status to (stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "")
        } finally {
            connection.disconnect()
        }
    }

    private fun binaryFile(context: Context?): File? {
        context ?: return null
        return File(context.applicationInfo.nativeLibraryDir, BINARY_NAME)
    }
}
