package com.slightnotes.v2

import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject

object LocalNetworkPermissionCoordinator {
    private val lock = Any()
    private var pending: Invoke? = null

    fun request(activity: MainActivity, invoke: Invoke) {
        if (AndroidSyncPolicy.hasLocalNetworkPermission(activity)) {
            invoke.resolve(result(true))
            return
        }
        synchronized(lock) {
            if (pending != null) {
                invoke.reject("已有局域网权限请求正在进行。")
                return
            }
            pending = invoke
        }
        activity.runOnUiThread {
            try {
                activity.launchLocalNetworkPermissionRequest()
            } catch (_: Exception) {
                val request = synchronized(lock) { pending.also { pending = null } }
                request?.reject("无法打开局域网权限请求，请重新打开应用后重试。")
            }
        }
    }

    fun complete(granted: Boolean) {
        val invoke = synchronized(lock) {
            val current = pending
            pending = null
            current
        } ?: return
        invoke.resolve(result(granted))
    }

    private fun result(granted: Boolean) = JSObject().apply {
        put("granted", granted)
    }
}
