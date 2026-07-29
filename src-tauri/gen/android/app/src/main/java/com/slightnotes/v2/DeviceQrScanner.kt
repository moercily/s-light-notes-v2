package com.slightnotes.v2

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
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
        if (ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.CAMERA,
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            activity.runOnUiThread(activity::launchDeviceQrScan)
        } else {
            activity.runOnUiThread(activity::launchCameraPermissionRequest)
        }
    }

    fun completePermission(activity: MainActivity, granted: Boolean) {
        if (granted) {
            val hasPendingScan = synchronized(lock) { pending != null }
            if (hasPendingScan) activity.runOnUiThread(activity::launchDeviceQrScan)
            return
        }

        val invoke = takePending() ?: return
        invoke.resolve(cancelled("cameraPermission"))
    }

    fun complete(contents: String?) {
        val invoke = takePending() ?: return

        if (contents.isNullOrBlank()) {
            invoke.resolve(cancelled("userCancelled"))
            return
        }
        invoke.resolve(JSObject().apply {
            put("cancelled", false)
            put("deviceId", contents.trim())
        })
    }

    private fun takePending(): Invoke? = synchronized(lock) {
        val current = pending
        pending = null
        current
    }

    private fun cancelled(reason: String) = JSObject().apply {
        put("cancelled", true)
        put("reason", reason)
    }
}
