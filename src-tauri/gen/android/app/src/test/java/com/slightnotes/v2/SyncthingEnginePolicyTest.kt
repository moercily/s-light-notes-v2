package com.slightnotes.v2

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncthingEnginePolicyTest {
    @Test
    fun acceptsOnlyConstrainedLoopbackRestPaths() {
        assertTrue(SyncthingEnginePolicy.isSafeApiPath("/rest/system/status"))
        assertTrue(SyncthingEnginePolicy.isSafeApiPath("/rest/db/scan?folder=s-light-notes"))
        assertFalse(SyncthingEnginePolicy.isSafeApiPath("rest/system/status"))
        assertFalse(SyncthingEnginePolicy.isSafeApiPath("/rest/../config"))
        assertFalse(SyncthingEnginePolicy.isSafeApiPath("https://example.test/rest/system/status"))
    }

    @Test
    fun acceptsOnlyPrivateGeneratedApiKeys() {
        assertTrue(SyncthingEnginePolicy.isValidApiKey("a".repeat(64)))
        assertFalse(SyncthingEnginePolicy.isValidApiKey("A".repeat(64)))
        assertFalse(SyncthingEnginePolicy.isValidApiKey("short"))
        assertFalse(SyncthingEnginePolicy.isValidApiKey("a".repeat(63) + "\n"))
    }

    @Test
    fun packagesBothPinnedNativeExecutables() {
        val artifacts = mapOf(
            "arm64-v8a" to 32191744L,
            "x86_64" to 33877008L,
        )
        artifacts.forEach { (abi, expectedSize) ->
            val artifact = File("src/main/jniLibs/$abi/libsyncthingnative.so")
            assertTrue("missing $abi Syncthing engine", artifact.isFile)
            assertEquals(expectedSize, artifact.length())
        }
    }
}
