package com.slightnotes.v2

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

class MainActivity : TauriActivity() {
  private val qrScanner = registerForActivityResult(ScanContract()) { result ->
    DeviceQrScanner.complete(result.contents)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onStart() {
    super.onStart()
    SyncthingForegroundService.start(this)
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
}
