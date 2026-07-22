package com.slightnotes.v2

import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject

object DeviceQrScanner {
    private val lock = Any()
    private var pending: Invoke? = null

    fun start(activity: MainActivity, invoke: Invoke) {
        synchronized(lock) {
            if (pending != null) {
                invoke.reject("已有二维码扫描正在进行。")
                return
            }
            pending = invoke
        }
        activity.runOnUiThread(activity::launchDeviceQrScan)
    }

    fun complete(contents: String?) {
        val invoke = synchronized(lock) {
            val current = pending
            pending = null
            current
        } ?: return

        if (contents.isNullOrBlank()) {
            invoke.resolve(JSObject().put("cancelled", true))
            return
        }
        invoke.resolve(JSObject().apply {
            put("cancelled", false)
            put("deviceId", contents.trim())
        })
    }
}
