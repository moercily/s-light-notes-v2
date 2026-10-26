package com.slightnotes.v2

import android.Manifest
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.lang.ref.WeakReference

class MainActivity : TauriActivity() {
  companion object {
    @Volatile private var current = WeakReference<MainActivity>(null)

    // Tauri keeps plugins across Activity recreation; permission launchers do not.
    fun currentActivity(): MainActivity? = current.get()?.takeUnless { it.isDestroyed || it.isFinishing }
  }

  private val notificationPermission = registerForActivityResult(
    ActivityResultContracts.RequestPermission(),
  ) { granted ->
    NotificationPermissionCoordinator.complete(granted)
  }

  private val localNetworkPermission = registerForActivityResult(
    ActivityResultContracts.RequestPermission(),
  ) { granted ->
    LocalNetworkPermissionCoordinator.complete(granted)
  }

  private val cameraPermission = registerForActivityResult(
    ActivityResultContracts.RequestPermission(),
  ) { granted ->
    DeviceQrScanner.completePermission(this, granted)
  }

  private val qrScanner = registerForActivityResult(ScanContract()) { result ->
    DeviceQrScanner.complete(result.contents)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    current = WeakReference(this)
    AndroidSyncPolicy.initialize(this)
    AndroidAppRuntime.initialize(this)
  }

  override fun onDestroy() {
    if (current.get() === this) current.clear()
    super.onDestroy()
  }

  fun launchDeviceQrScan() {
    qrScanner.launch(
      ScanOptions()
        .setDesiredBarcodeFormats(listOf("QR_CODE"))
        .setPrompt("扫描另一台设备的 Syncthing 设备码")
        .setBeepEnabled(false)
        .setOrientationLocked(false),
    )
  }

  fun launchCameraPermissionRequest() {
    cameraPermission.launch(Manifest.permission.CAMERA)
  }

  fun launchNotificationPermissionRequest() {
    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
  }

  fun launchLocalNetworkPermissionRequest() {
    localNetworkPermission.launch(Manifest.permission.NEARBY_WIFI_DEVICES)
  }
}
