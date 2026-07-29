package com.slightnotes.v2

import androidx.work.NetworkType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidSyncPolicyTest {
    @Test
    fun backgroundSessionRequiresVisibleNotificationPermission() {
        assertTrue(AndroidSyncPolicyRules.effectiveBackgroundSession(true, true))
        assertFalse(AndroidSyncPolicyRules.effectiveBackgroundSession(true, false))
        assertFalse(AndroidSyncPolicyRules.effectiveBackgroundSession(false, true))
    }

    @Test
    fun opportunitySyncDefaultsToConstrainedNetworkTypes() {
        assertEquals(NetworkType.UNMETERED, AndroidSyncPolicyRules.networkType(true))
        assertEquals(NetworkType.CONNECTED, AndroidSyncPolicyRules.networkType(false))
    }

    @Test
    fun scheduledWorkRunsOnlyAfterTheAppOpenedDuringCurrentBoot() {
        assertTrue(AndroidSyncPolicyRules.isCurrentBoot(12, 12))
        assertFalse(AndroidSyncPolicyRules.isCurrentBoot(11, 12))
        assertFalse(AndroidSyncPolicyRules.isCurrentBoot(-1, 12))
    }
}
