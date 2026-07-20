package com.slightnotes.v2

import android.app.Activity
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class AndroidBridgePlugin(activity: Activity) : Plugin(activity) {
    @Command
    fun getPlatformStatus(invoke: Invoke) {
        val status = JSObject().apply {
            put("platform", "android")
            put("sdkInt", Build.VERSION.SDK_INT)
            put("engineState", "notConfigured")
        }
        invoke.resolve(status)
    }
}
