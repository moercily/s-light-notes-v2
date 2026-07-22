package com.slightnotes.v2

import android.content.Context
import android.os.SystemClock
import androidx.work.Worker
import androidx.work.WorkerParameters

class OpportunisticSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : Worker(appContext, workerParams) {
    override fun doWork(): Result {
        val policy = AndroidSyncPolicy.get(applicationContext)
        if (!AndroidSyncPolicy.wasOpenedThisBoot(applicationContext) ||
            !policy.opportunisticSync ||
            policy.backgroundSessionEnabled ||
            AndroidAppRuntime.isForeground()
        ) {
            return Result.success()
        }

        var completed = false
        return try {
            SyncthingEngine.start(applicationContext)
            if (!waitForEngine()) {
                if (AndroidAppRuntime.isForeground()) return Result.success()
                SyncthingEngine.stop()
                return Result.retry()
            }
            SyncthingEngine.scanNotesFolder()
            waitForExchangeWindow()
            completed = true
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        } finally {
            if (!AndroidAppRuntime.isForeground() &&
                !AndroidSyncPolicy.get(applicationContext).backgroundSessionEnabled
            ) {
                AndroidSyncPolicy.recordStopReason(
                    applicationContext,
                    if (completed) "opportunisticComplete" else "opportunisticFailed",
                )
                SyncthingEngine.stop()
            }
        }
    }

    private fun waitForEngine(): Boolean {
        repeat(80) {
            if (isStopped || AndroidAppRuntime.isForeground()) return false
            val snapshot = SyncthingEngine.snapshot()
            if (snapshot.running) return true
            if (snapshot.state == SyncthingEngine.State.ERROR) return false
            SystemClock.sleep(250)
        }
        return false
    }

    private fun waitForExchangeWindow() {
        repeat(30) {
            if (isStopped || AndroidAppRuntime.isForeground()) return
            SystemClock.sleep(500)
        }
    }
}
