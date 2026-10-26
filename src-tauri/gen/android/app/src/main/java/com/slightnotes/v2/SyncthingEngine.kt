package com.slightnotes.v2

import android.content.Context
import android.os.SystemClock
import android.security.NetworkSecurityPolicy
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

    fun isPlausibleDeviceId(value: String): Boolean {
        val compact = value.filterNot(Char::isWhitespace)
        return compact.length in 52..64 && compact.all { it.isLetterOrDigit() || it == '-' }
    }

    fun isValidDeviceName(value: String): Boolean =
        value.length <= 64 && value.none(Char::isISOControl)
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
    private val pairingLock = Any()
    private val pendingPairings = mutableMapOf<String, PendingPairing>()

    private data class PendingPairing(
        val deviceId: String,
        val deviceName: String,
        val createdAt: Long,
    )

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

    fun pairingInfo(): JSONObject {
        requireRunning()
        val status = requestJson("GET", "/rest/system/status")
        val localDeviceId = status.optString("myID").ifBlank { status.optString("myId") }
        require(localDeviceId.isNotBlank()) { "同步引擎未返回本机设备代码。" }
        val configuredDevices = JSONArray(request("GET", "/rest/config/devices").second)
        val connections = requestJson("GET", "/rest/system/connections")
            .optJSONObject("connections") ?: JSONObject()
        val safeDevices = JSONArray()
        for (index in 0 until configuredDevices.length()) {
            val device = configuredDevices.getJSONObject(index)
            val id = device.optString("deviceID")
            if (id.isBlank() || id == localDeviceId) continue
            safeDevices.put(JSONObject().apply {
                put("deviceID", id)
                put("name", device.optString("name").ifBlank { "另一台设备" })
                put("connected", connections.optJSONObject(id)?.optBoolean("connected") == true)
            })
        }

        val folderState = runCatching {
            val state = requestJson("GET", "/rest/db/status?folder=$NOTES_FOLDER_ID")
            JSONObject().apply {
                put("state", state.optString("state", "unknown"))
                put("globalFiles", state.optLong("globalFiles", 0))
                put("localFiles", state.optLong("localFiles", 0))
                put("needFiles", state.optLong("needFiles", 0))
                put("inSyncBytes", state.optLong("inSyncBytes", 0))
            }
        }.getOrElse {
            JSONObject().put("state", "unknown")
        }

        return JSONObject().apply {
            put("localDeviceId", localDeviceId)
            put("folderId", NOTES_FOLDER_ID)
            put("devices", safeDevices)
            put("folderStatus", folderState)
        }
    }

    fun previewDevicePairing(candidate: String, requestedName: String): JSONObject {
        requireRunning()
        val compact = candidate.filterNot(Char::isWhitespace)
        require(SyncthingEnginePolicy.isPlausibleDeviceId(candidate)) {
            "设备代码格式无效，请检查是否完整复制。"
        }
        val normalizedResponse = requestJson("GET", "/rest/svc/deviceid?id=$compact")
        val error = normalizedResponse.optString("error")
        require(error.isBlank()) { "设备代码无效：$error" }
        val remoteDeviceId = normalizedResponse.optString("id")
        require(remoteDeviceId.isNotBlank()) { "同步引擎未返回有效的设备代码。" }

        val localDeviceId = requestJson("GET", "/rest/system/status")
            .optString("myID")
        require(remoteDeviceId != localDeviceId) { "不能把本机设备代码添加为远端设备。" }
        require(!configuredDeviceIds().contains(remoteDeviceId)) { "这台设备已经添加，无需重复配对。" }

        val deviceName = requestedName.trim().ifBlank { "另一台设备" }
        require(SyncthingEnginePolicy.isValidDeviceName(deviceName)) {
            "设备名称不能超过 64 个字符且不能包含控制字符。"
        }
        val token = randomHex(24)
        synchronized(pairingLock) {
            val now = SystemClock.elapsedRealtime()
            pendingPairings.entries.removeAll { now - it.value.createdAt > 300_000 }
            pendingPairings[token] = PendingPairing(remoteDeviceId, deviceName, now)
        }
        return JSONObject().apply {
            put("requiresConfirmation", true)
            put("confirmationToken", token)
            put("expiresInSeconds", 300)
            put("localDeviceId", localDeviceId)
            put("remoteDeviceId", remoteDeviceId)
            put("deviceName", deviceName)
            put("folderId", NOTES_FOLDER_ID)
            put("message", "确认后会添加这台设备并向它共享默认笔记文件夹。另一台设备仍需输入本机设备代码并确认。")
        }
    }

    fun confirmDevicePairing(tokenValue: String): JSONObject {
        requireRunning()
        val token = tokenValue.trim()
        val pairing = synchronized(pairingLock) { pendingPairings.remove(token) }
            ?: error("设备配对确认已失效或已使用，请重新检查设备代码。")
        require(SystemClock.elapsedRealtime() - pairing.createdAt <= 300_000) {
            "设备配对确认已超过五分钟，请重新检查设备代码。"
        }
        require(!configuredDeviceIds().contains(pairing.deviceId)) {
            "确认前该设备已经被添加，未重复写入。"
        }

        val folder = requestJson("GET", "/rest/config/folders/$NOTES_FOLDER_ID")
        val originalDevices = JSONArray(folder.optJSONArray("devices")?.toString() ?: "[]")
        val deviceTemplate = requestJson("GET", "/rest/config/defaults/device")
        deviceTemplate.put("deviceID", pairing.deviceId)
        deviceTemplate.put("name", pairing.deviceName)
        deviceTemplate.put("addresses", JSONArray().put("dynamic"))
        deviceTemplate.put("paused", false)
        requireSuccess(request("POST", "/rest/config/devices", deviceTemplate.toString()), "添加远端设备")

        try {
            val sharedDevices = JSONArray(originalDevices.toString()).put(
                JSONObject().put("deviceID", pairing.deviceId),
            )
            folder.put("devices", sharedDevices)
            requireSuccess(
                request("PUT", "/rest/config/folders/$NOTES_FOLDER_ID", folder.toString()),
                "共享默认笔记文件夹",
            )
            val verifiedDevice = configuredDeviceIds().contains(pairing.deviceId)
            val verifiedFolder = requestJson("GET", "/rest/config/folders/$NOTES_FOLDER_ID")
                .optJSONArray("devices")
            val verifiedShare = verifiedFolder != null && (0 until verifiedFolder.length()).any {
                verifiedFolder.getJSONObject(it).optString("deviceID") == pairing.deviceId
            }
            require(verifiedDevice && verifiedShare) { "设备配对回读验证失败。" }
        } catch (error: Exception) {
            runCatching {
                folder.put("devices", originalDevices)
                request("PUT", "/rest/config/folders/$NOTES_FOLDER_ID", folder.toString())
            }
            runCatching { request("DELETE", "/rest/config/devices/${pairing.deviceId}") }
            throw IllegalStateException("${error.message ?: "设备配对失败。"} 已尝试撤销本轮配置。")
        }

        return JSONObject().apply {
            put("paired", true)
            put("remoteDeviceId", pairing.deviceId)
            put("deviceName", pairing.deviceName)
            put("folderId", NOTES_FOLDER_ID)
            put("connectionState", "waitingForRemote")
            put("message", "本机配置已完成。请在另一台设备上输入本机设备代码并确认，双方确认后会自动连接和同步。")
        }
    }

    fun scanNotesFolder(): JSONObject {
        requireRunning()
        requireSuccess(request("POST", "/rest/db/scan?folder=$NOTES_FOLDER_ID"), "扫描笔记文件夹")
        return JSONObject().put("ok", true).put("folderId", NOTES_FOLDER_ID)
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
        var startedChild: Process? = null
        try {
            check(NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted("127.0.0.1")) {
                "当前安装包无法访问本机同步引擎。"
            }
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
            startedChild = child

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
            // Keep ownership until the child has stopped, including startup cancellation.
            // A failed readiness check must not leave an untracked engine holding its port.
            startedChild?.let { child ->
                runCatching {
                    if (child.isAlive) child.destroy()
                    if (!child.waitFor(1, TimeUnit.SECONDS)) {
                        child.destroyForcibly().waitFor(1, TimeUnit.SECONDS)
                    }
                }
            }
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

    private fun configuredDeviceIds(): Set<String> {
        val devices = JSONArray(request("GET", "/rest/config/devices").second)
        return (0 until devices.length()).mapNotNullTo(mutableSetOf()) { index ->
            devices.getJSONObject(index).optString("deviceID").takeIf(String::isNotBlank)
        }
    }

    private fun requireRunning() {
        val current = snapshot()
        require(current.running) { "本机 P2P 同步引擎尚未就绪，请稍后重试。" }
    }

    private fun requireSuccess(response: Pair<Int, String>, operation: String) {
        require(response.first in 200..299) { "$operation 失败，HTTP ${response.first}。" }
    }

    private fun randomHex(size: Int): String {
        val bytes = ByteArray(size).also(SecureRandom()::nextBytes)
        return bytes.joinToString("") { "%02x".format(it) }
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
