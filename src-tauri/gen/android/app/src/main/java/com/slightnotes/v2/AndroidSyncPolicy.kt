package com.slightnotes.v2

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

data class BackgroundPolicySnapshot(
    val opportunisticSync: Boolean,
    val unmeteredOnly: Boolean,
    val backgroundSessionEnabled: Boolean,
    val notificationPermissionGranted: Boolean,
    val lastStopReason: String,
)

internal object AndroidSyncPolicyRules {
    fun effectiveBackgroundSession(requested: Boolean, notificationGranted: Boolean): Boolean =
        requested && notificationGranted

    fun networkType(unmeteredOnly: Boolean): NetworkType =
        if (unmeteredOnly) NetworkType.UNMETERED else NetworkType.CONNECTED

    fun isCurrentBoot(storedBootCount: Int, currentBootCount: Int): Boolean =
        storedBootCount >= 0 && storedBootCount == currentBootCount
}

object AndroidSyncPolicy {
    private const val PREFERENCES = "android-sync-policy"
    private const val KEY_OPPORTUNISTIC = "opportunistic-sync"
    private const val KEY_UNMETERED = "unmetered-only"
    private const val KEY_BACKGROUND = "background-session"
    private const val KEY_LAST_STOP = "last-stop-reason"
    private const val KEY_ACTIVE_BOOT = "active-boot-count"
    private const val PERIODIC_WORK = "s-light-notes-opportunistic-sync"

    fun initialize(context: Context) {
        val preferences = preferences(context)
        val editor = preferences.edit().putInt(KEY_ACTIVE_BOOT, bootCount(context))
        if (preferences.getBoolean(KEY_BACKGROUND, false) && !hasNotificationPermission(context)) {
            editor.putBoolean(KEY_BACKGROUND, false)
        }
        editor.apply()
        schedule(context, get(context))
    }

    fun get(context: Context): BackgroundPolicySnapshot {
        val preferences = preferences(context)
        val notificationGranted = hasNotificationPermission(context)
        val requestedBackground = preferences.getBoolean(KEY_BACKGROUND, false)
        return BackgroundPolicySnapshot(
            opportunisticSync = preferences.getBoolean(KEY_OPPORTUNISTIC, true),
            unmeteredOnly = preferences.getBoolean(KEY_UNMETERED, true),
            backgroundSessionEnabled = AndroidSyncPolicyRules.effectiveBackgroundSession(
                requestedBackground,
                notificationGranted,
            ),
            notificationPermissionGranted = notificationGranted,
            lastStopReason = preferences.getString(KEY_LAST_STOP, "") ?: "",
        )
    }

    fun set(
        context: Context,
        opportunisticSync: Boolean,
        unmeteredOnly: Boolean,
        backgroundSessionEnabled: Boolean,
    ): BackgroundPolicySnapshot {
        val granted = hasNotificationPermission(context)
        val effectiveBackground = AndroidSyncPolicyRules.effectiveBackgroundSession(
            backgroundSessionEnabled,
            granted,
        )
        preferences(context).edit()
            .putBoolean(KEY_OPPORTUNISTIC, opportunisticSync)
            .putBoolean(KEY_UNMETERED, unmeteredOnly)
            .putBoolean(KEY_BACKGROUND, effectiveBackground)
            .apply()
        val updated = get(context)
        schedule(context, updated)
        if (!updated.backgroundSessionEnabled && !AndroidAppRuntime.isForeground()) {
            SyncthingForegroundService.stop(context, "backgroundPolicy")
        }
        return updated
    }

    fun recordStopReason(context: Context, reason: String) {
        preferences(context).edit().putString(KEY_LAST_STOP, reason).apply()
    }

    fun wasOpenedThisBoot(context: Context): Boolean = AndroidSyncPolicyRules.isCurrentBoot(
        preferences(context).getInt(KEY_ACTIVE_BOOT, -1),
        bootCount(context),
    )

    fun hasNotificationPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED

    fun requiresLocalNetworkPermission(): Boolean = Build.VERSION.SDK_INT >= 36

    fun hasLocalNetworkPermission(context: Context): Boolean =
        !requiresLocalNetworkPermission() ||
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.NEARBY_WIFI_DEVICES,
            ) == PackageManager.PERMISSION_GRANTED

    fun openBatterySettings(context: Context) {
        val settingsIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(
            if (settingsIntent.resolveActivity(context.packageManager) != null) settingsIntent else fallback,
        )
    }

    private fun schedule(context: Context, policy: BackgroundPolicySnapshot) {
        val workManager = WorkManager.getInstance(context.applicationContext)
        if (!policy.opportunisticSync) {
            workManager.cancelUniqueWork(PERIODIC_WORK)
            return
        }
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(AndroidSyncPolicyRules.networkType(policy.unmeteredOnly))
            .setRequiresBatteryNotLow(true)
            .build()
        val work = PeriodicWorkRequestBuilder<OpportunisticSyncWorker>(
            1,
            TimeUnit.HOURS,
            15,
            TimeUnit.MINUTES,
        ).setConstraints(constraints).build()
        workManager.enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            work,
        )
    }

    private fun preferences(context: Context) =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    private fun bootCount(context: Context): Int = runCatching {
        Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT)
    }.getOrDefault(-1)
}

object AndroidAppRuntime : DefaultLifecycleObserver {
    @Volatile
    private var foreground = false
    @Volatile
    private var initialized = false
    private lateinit var appContext: Context

    fun isForeground(): Boolean = foreground

    fun initialize(context: Context) {
        synchronized(this) {
            if (initialized) return
            appContext = context.applicationContext
            ProcessLifecycleOwner.get().lifecycle.addObserver(this)
            initialized = true
        }
    }

    override fun onStart(owner: LifecycleOwner) {
        foreground = true
        AndroidSyncPolicy.initialize(appContext)
        if (AndroidSyncPolicy.hasLocalNetworkPermission(appContext)) {
            SyncthingForegroundService.start(appContext)
        } else {
            AndroidSyncPolicy.recordStopReason(appContext, "localNetworkPermission")
            SyncthingForegroundService.stop(appContext, "localNetworkPermission")
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        foreground = false
        if (!AndroidSyncPolicy.get(appContext).backgroundSessionEnabled) {
            SyncthingForegroundService.stop(appContext, "appBackground")
        }
    }
}
