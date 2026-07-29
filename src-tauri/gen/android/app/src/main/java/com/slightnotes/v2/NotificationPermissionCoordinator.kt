package com.slightnotes.v2

import android.os.Build
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject

object NotificationPermissionCoordinator {
    private val lock = Any()
    private var pending: Invoke? = null

    fun request(activity: MainActivity, invoke: Invoke) {
        if (AndroidSyncPolicy.hasNotificationPermission(activity)) {
            invoke.resolve(result(true))
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            invoke.resolve(result(true))
            return
        }
        synchronized(lock) {
            if (pending != null) {
                invoke.reject("已有通知权限请求正在进行。")
                return
            }
            pending = invoke
        }
        activity.runOnUiThread(activity::launchNotificationPermissionRequest)
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
