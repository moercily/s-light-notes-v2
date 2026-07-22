package com.slightnotes.v2

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class SyncthingForegroundService : Service() {
    companion object {
        private const val CHANNEL_ID = "p2p_sync"
        private const val NOTIFICATION_ID = 2102
        private const val ACTION_START = "com.slightnotes.v2.action.START_SYNC"
        private const val ACTION_STOP = "com.slightnotes.v2.action.STOP_SYNC"

        fun start(context: Context) {
            val intent = Intent(context, SyncthingForegroundService::class.java).setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            stop(context, "user")
        }

        fun stop(context: Context, reason: String) {
            AndroidSyncPolicy.recordStopReason(context, reason)
            SyncthingEngine.stop()
            context.stopService(Intent(context, SyncthingForegroundService::class.java))
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private val statusRefresh = object : Runnable {
        override fun run() {
            val snapshot = SyncthingEngine.snapshot()
            getSystemService(NotificationManager::class.java).notify(
                NOTIFICATION_ID,
                buildNotification(snapshot.message),
            )
            handler.postDelayed(this, 2000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            AndroidSyncPolicy.recordStopReason(this, "notification")
            SyncthingEngine.stop()
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
            return START_NOT_STICKY
        }

        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification("正在启动本机 P2P 同步"),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            } else {
                0
            },
        )
        SyncthingEngine.start(this)
        handler.removeCallbacks(statusRefresh)
        handler.post(statusRefresh)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(statusRefresh)
        SyncthingEngine.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTimeout(startId: Int, fgsType: Int) {
        AndroidSyncPolicy.recordStopReason(this, "systemTimeout")
        SyncthingEngine.stop()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "P2P 同步",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "显示 s-light notes 的本机 P2P 同步状态"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val openPendingIntent = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stopPendingIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, SyncthingForegroundService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("s-light notes")
            .setContentText(text)
            .setContentIntent(openPendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, "停止同步", stopPendingIntent)
            .build()
    }
}
