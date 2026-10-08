# s-light notes v2 Test Plan

## Desktop Sticky Checkpoint — 2026-10-08

All eight frontend suites and 34 Rust tests pass. macOS Apple Silicon release
packaging and Android arm64 debug APK packaging pass. Native macOS sticky
save/reopen, pin persistence, main-window recreation, individual close,
empty-draft reuse, and multi-window quit were exercised.

Physical-key activation in another application, Windows/Linux sticky runtime,
and this checkpoint's Android phone regression remain unverified. Detailed
steps and evidence limits are in [`V2_STICKY_NOTES.md`](V2_STICKY_NOTES.md).

## Settings / 0.0.1 Checkpoint — 2026-10-08

All nine frontend suites and 35 Rust tests pass. Packaged macOS settings were
checked for four-category navigation, icon/name/version, key capture + Esc
commit, Esc-only removal, cancellation on navigation, sync status refresh,
and login-startup registration/removal. A second executable launch exited
successfully with one application instance remaining. Autostart and shortcut
settings were restored to their pre-test state.

The macOS bundle reports `0.0.1`; the arm64 Android debug APK reports
version name `0.0.1` and version code `2000001`, above the existing release's
`2000000`. Login after reboot, Windows/Linux native settings acceptance,
cross-application physical shortcut input, and phone runtime testing remain
separate unverified gates. See [`V2_SETTINGS.md`](V2_SETTINGS.md).

## Automated Tests

- From `v2/`, `npm test`
  - Verifies `syncService` uses Tauri invoke when available.
  - Verifies `syncService` falls back to existing Web sync helpers.
  - Verifies `syncService.testConnection()` returns a UI-compatible shape in desktop mode.
  - Verifies `syncService.startEngine()` calls the desktop command.
  - Verifies desktop requests wrap Tauri structure arguments correctly.
  - Verifies the desktop proxy receives the API Key for status and configuration-assist requests.
  - Verifies real desktop connection results include device ID, folders, devices, and selected folder state.
  - Verifies HTTP 403 is shown as an API Key authentication failure.
  - Verifies desktop-only calls fail clearly in Web/PWA context.
  - Verifies the sync center view model separates local save status from P2P sync status.
  - Verifies the desktop service calls Tauri commands for app paths and default notes folder actions.
  - Verifies `desktop` storage mode routes list, read, save, trash, restore, and permanent deletion through the desktop service.
  - Verifies the sync center reports desktop Markdown storage separately from browser storage.
  - Verifies the safe binding preview and separate confirmation controls are present in the desktop sync center.
  - Verifies confirmed-write requests send the short-lived token and current API Key through the dedicated Tauri command.
  - Verifies v2 desktop sync scripts are included in the isolated v2 Service Worker cache.

- From `v2/`, `cargo test --manifest-path src-tauri/Cargo.toml`
  - Verifies unsafe Syncthing proxy paths are rejected.
  - Verifies valid Syncthing REST paths target `127.0.0.1:8384`.
  - Verifies explicit, `PATH`, and common-location Syncthing executable discovery precedence.
  - Verifies managed-process state cleanup and early-exit messages.
  - Verifies unsafe note IDs cannot escape the default notes directory.
  - Verifies API Key header injection is rejected and a valid key is applied as `X-API-Key`.
  - Verifies Markdown files can be created, read, listed, moved to trash, restored, and permanently deleted in a temporary directory.
  - Verifies configuration previews do not write, recognize an existing binding, reject outside paths, and reject duplicate folder IDs.
  - Verifies confirmation tokens are single-use, expire after five minutes, and are required before a write plan can be obtained.
  - Verifies confirmed writes recheck folder ID/path conflicts and preserve the Syncthing default folder template.
  - Verifies the authenticated GET, POST, readback, restart-status, and rollback DELETE sequence against a temporary loopback server.

- From `v2/`, `npm run tauri:build`
  - Verifies the Tauri desktop shell compiles.
  - Verifies the v2 frontend under `v2/app` is bundled into a macOS `.app`.
  - Alpha target is `.app`; DMG packaging is intentionally deferred.

- From `v2/`, `npm run tauri:build:macos-intel`
  - Verifies the Tauri desktop shell cross-compiles for `x86_64-apple-darwin`.
  - Verifies the Intel `.app` contains the matching x86-64 Syncthing sidecar.

- From `v2/`, `npm run tauri:build:linux`
  - Builds the Linux `deb` and AppImage targets on a native Linux x64 environment.
  - This command is defined and structure-tested; native Linux execution remains pending.

## Desktop Manual Tests

- Launch the Tauri app on macOS, Windows, and Linux.
- Create the default notes folder.
- Open the notes folder from the app.
- Create, edit, save, close, and reopen a Markdown note.
- Confirm the desktop build does not show the browser folder permission picker.
- Confirm the saved `.md` file is visible and readable in the default notes folder.
- Confirm delete, restore, and permanent delete behave consistently with v1.
- Confirm v1 browser entry still opens `index.html` normally.

### macOS Apple Silicon Smoke Checkpoint - 2026-07-15

Verified in the current environment:

- The latest `.app` bundle launches from `src-tauri/target/release/bundle/macos/`.
- With sidecar startup deliberately made unavailable in a disposable package copy, the main app remained running and logged the sidecar startup failure instead of exiting.
- `npm test`, all 31 Rust tests, and `npm run tauri:build` passed from the independent v2 repository.
- The v1 repository still contains only its pre-existing `css/style.css` modification; the v2 run did not change v1.

Manual acceptance confirmed by the user on 2026-07-15:

- Create, edit, save, quit, reopen, and content persistence passed.
- The saved Markdown file was visible and readable outside the app.
- An external Markdown edit was observed by the app after reopen or refresh.
- Delete, restore, repeated delete, permanent delete, and `.trash` behavior passed.
- No browser folder-permission picker appeared during the packaged-app workflow.

Remaining macOS check:

- The disposable-package test proved that sidecar startup failure leaves the main app running, but actual editing and saving while the sidecar is unavailable still requires explicit confirmation.

Manual acceptance run:

1. Open the latest `s-light notes.app` and create a note named `macOS smoke note` with a second line of body text.
2. Quit and reopen the app; open the note and confirm both lines remain.
3. Use **Open Notes Folder** and confirm `macOS smoke note.md` is readable in Finder or a text editor.
4. Append `external edit` in a text editor, then reopen or refresh the app and confirm the added line appears.
5. Delete the note, restore it from Trash, delete it again, and permanently delete it; confirm the file moves through `.trash` and is finally absent.
6. Confirm no browser folder-permission picker appears at any point.

All six manual steps above were reported as passed on 2026-07-15. Phase 5.1 remains open only for the separate editing-without-sidecar check.

### Windows x64 Package Checkpoint - 2026-07-16

Verified in Parallels Windows 11 ARM64 using Windows x64 application emulation:

- Node.js v22.22.0 x64, Rust 1.97.0 with `x86_64-pc-windows-msvc`, Visual Studio 2022 x64 C++ tools, the Windows 11 SDK, and WebView2 were available.
- The frontend suite passed and all 31 Rust tests passed on Windows.
- The first Rust build correctly exposed the missing Windows sidecar, and the next build exposed the required Windows `.ico`; both package gaps were added to the repository and covered by the structure test.
- `syncthing-windows-amd64-v2.1.2.zip` matched SHA-256 `4626c13012e9620ece2393bfc3300aeafead654695d5dc096a873c27a7543c96` from Syncthing's official signed checksum manifest.
- The extracted x86-64 PE sidecar matched SHA-256 `6bff9bbf005ea28f103da7a6508f2677bdd15bd344faf4b7f908872c83d76e3e`.
- The final `npm run tauri:build:windows` NSIS x64 installer was generated, installed per user, and registered an uninstall entry. After the console-window fix it was 12,858,947 bytes with SHA-256 `f8db9e206b07391c45bbadb125ca4ca85c16745a6de28877678fdfd7a21924fc`.
- The installed directory contained the main executable, `syncthing-sidecar.exe`, provenance metadata, and the MPL-2.0 notice.
- First launch created `Documents\\s-light-notes` and an independent application-data tree containing Syncthing config, data, logs, and runtime credentials.
- The installed sidecar returned `{"status":"OK"}` on loopback port 8385.
- A reported empty command window was traced to the main release executable using the Windows console subsystem. Release builds now use the Windows GUI subsystem while debug builds retain their console, and the installed executable was verified with PE subsystem value `2`.
- A normal main-window close stopped the app and both sidecar processes and released port 8385.
- Restart restored sidecar health and preserved the Syncthing certificate and private-key hashes.

Pending Windows acceptance:

- Run the create/edit/save/reopen, external-file edit, trash/restore/permanent-delete, and no-browser-permission-picker checks in the installed UI.
- Confirm the normal UI exposes no raw Syncthing API address, port, or API Key.
- Repeat packaging and smoke testing on native Windows x64 hardware or an approved native x64 runner; the current ARM64 VM proves x64 compatibility behavior, not native x64 hardware coverage.

## Bundled Sidecar Tests

macOS Apple Silicon packaged-app validation passed on 2026-07-15: the bundle contained the pinned arm64 binary, automatically started it beside an existing system Syncthing instance, used isolated ports and app data, created the default folder binding, preserved a private backend credential, and stopped the sidecar when the app closed.

Lifecycle validation passed on 2026-07-15: normal macOS Quit stopped both sidecar processes, released loopback port 8385, restarted successfully, and preserved the certificate/private-key hashes. The final exit callback also cleaned up an authenticated app-owned sidecar left without a tracked child handle by the earlier failing build.

- Clean machine without Syncthing installed: the packaged app starts its bundled engine.
- Existing system Syncthing: the bundled engine uses a separate home and port without modifying the system instance.
- First run: device identity, backend API Key, notes folder, and folder binding are created without raw configuration UI.
- Restart and upgrade: device identity and folder binding survive app restart and sidecar version update.
- Normal window close, macOS Quit, and Tauri restart requests use graceful authenticated shutdown before tracked-process fallback.
- The sync center states that quitting the alpha app stops synchronization; no hidden tray/background mode remains active.
- Port conflict, missing/wrong-architecture binary, corrupted config, and early process exit produce actionable messages.
- API Key does not appear in frontend state, synchronized Markdown files, logs, or user-visible diagnostics.
- macOS Apple Silicon/Intel, Windows x64, and Linux x64 packages contain the correct target-triple sidecar.
- The sidecar cannot expose its REST/GUI endpoint to the LAN through any frontend-provided value.

## Device Pairing Tests

- The standard desktop UI shows a local device code without exposing API addresses, ports, or API Keys.
- An incomplete, malformed, local, or already-configured device ID is rejected before configuration writes.
- Pairing preview shows the normalized remote device ID, device name, default notes sharing, token lifetime, and mutual-confirmation requirement.
- Confirmation adds exactly one remote device and patches only the device list of `s-light-notes`.
- Device and folder configuration are read back after writing; a failed share or verification triggers rollback.
- A configured but disconnected remote device is shown as waiting for confirmation; a live connection is shown as connected.
- Pairing Tauri invocations contain no API Key, arbitrary folder path, device address, or raw Syncthing configuration.
- Offline QR generation contains only the canonical local device ID and no API Key, folder path, note content, or network address.
- QR display expands and collapses without overflow at desktop and 390px mobile viewport widths; manual copy remains available.

### Desktop Sidecar Artifact Checkpoint - 2026-07-20

- Added the official Syncthing v2.1.2 macOS Intel and Linux x64 binaries using the release assets referenced in the signed checksum manifest.
- `syncthing-macos-amd64-v2.1.2.zip` matched SHA-256 `f04b3d7f1492457e929119b91561f0ddc6bada070f46b68bd2464cda04983424`; its x86-64 Mach-O binary matched `24cd4219041087bf67a2773fe0aa8ad976b8e579b4768c31df365a58058f1743` and reported v2.1.2 under Rosetta.
- `syncthing-linux-amd64-v2.1.2.tar.gz` matched SHA-256 `0cea24660ac7d8df19f01da979827b5c9463a8a60042e296829293cf80213ee4`; its x86-64 ELF binary matched `d5aa7b869042518ae62e35fd40a1ada84d3c7f970863c396da1db0d318509e89` and exposed the expected Linux amd64 Go build metadata.
- The signed checksum manifest is recorded with SHA-256 `fc79100eb44eef13c0a4954afb73422bdc9efea866535b7525d5882d5e037b1a`. PGP signature verification remains pending because GnuPG is not installed on the host.
- `npm run tauri:build:macos-intel` produced an x86-64 `.app`; it launched under Rosetta, bundled the expected sidecar hash, and returned `{"status":"OK"}` on the isolated loopback health endpoint.
- Native macOS Intel lifecycle/Markdown-loop acceptance and all native Linux package acceptance remain open and are not implied by the Rosetta or artifact checks.

## Sync Event Tests

- Initial polling requests only the latest matching event; subsequent calls continue after the last processed event ID.
- Event types, timeout, and result limit are fixed by Rust and cannot be expanded by frontend input.
- Device, folder, scan, completion, and error events refresh the existing sync-center state instead of creating a second state model.
- Opening the sync center starts event polling; closing it stops further requests after any in-flight call returns.
- Event requests use the backend-owned API Key without exposing it to frontend state.

## External Syncthing Manual Tests

- Syncthing not installed: app shows a clear unavailable state.
- Syncthing installed but stopped: app can attempt start or explain failure.
- Syncthing running: app detects health through `127.0.0.1:8384`.
- Wrong API key: app reports authentication failure.
- Port occupied: app reports connection or service mismatch.
- Existing matching folder: preview reports that no configuration write is needed.
- New folder: preview shows path, folder ID, selected devices, restart impact, and that writing has not occurred.
- New folder confirmation: a separate dialog repeats the exact path, folder ID, device count, and token lifetime.
- Configuration changed after preview: confirmation refuses to replace an ID or duplicate the notes path.
- Successful confirmation: Syncthing contains the new folder and the app refreshes to its live status.
- Verification failure: the app reports whether the newly created folder was rolled back or needs manual inspection.

## Multi-Device Tests

- Device A creates a note; Device B receives it.
- Device B edits a note; Device A receives it.
- Both devices edit the same note offline; conflict file appears after reconnect.
- Conflict file appears in the app as a conflict item.
- Local editing remains usable while remote devices are offline.

## Mobile Tests

### Android Native Engine Build Checkpoint - 2026-07-21

- Syncthing v2.1.2 source archive SHA-256, Go 1.25.11, NDK 28.2.13676358, build flags, ABI paths, and artifact hashes are recorded in `src-tauri/android-engine/SYNCTHING_ANDROID.json`.
- The arm64-v8a and x86_64 engines are verified as Android 64-bit PIE executables with 16 KB ELF load alignment.
- Separate arm64 and x86_64 debug builds passed and each APK contained only its selected Rust library and matching Syncthing engine, plus the MPL-2.0 notice.
- The merged manifest contains `dataSync` foreground-service permissions, an unexported service, no boot receiver, no all-files permission, and extracted native libraries.
- Kotlin storage and engine-policy tests passed for both ABIs; frontend tests, all 31 Rust tests, and macOS desktop packaging also passed at this checkpoint.
- Runtime launch, notification behavior, API 35+ timeout cleanup, device identity generation, and P2P transfer now have an API 36 arm64-emulator record. Physical-device validation remains required.

### Android Pairing Build Checkpoint - 2026-07-22

- arm64 and x86-64 debug APK builds pass with the Android sync center, constrained pairing commands, and ZXing scanner activity.
- Frontend bridge tests verify status, start, stop, pairing preview, confirmation, folder scan, and QR scan calls without API Keys or management ports.
- Kotlin policy tests reject incomplete device codes, control characters, oversized names, unsafe REST paths, and invalid private credentials.
- Pairing confirmation is held in memory for five minutes, consumed once, rechecks live device state, shares only `s-light-notes`, verifies both writes, and attempts rollback after failure.
- The sync center has no horizontal overflow at 320x640, 390x844, or 844x390; long device codes wrap and all tested controls retain at least 44px touch height.
- Camera denial, manual device-code confirmation, mutual desktop pairing, and real file transfer pass on an API 36 arm64 emulator. A physical API 36 arm64 phone also captured a QR code, parsed the canonical device ID, and rejected the already paired device without changing configuration.

### Android Background Policy Build Checkpoint - Current Branch

- Background policy controls cover opportunity sync, unmetered-only behavior, explicit continued-background sessions, notification permission, and the system battery-settings entry.
- Kotlin unit tests verify that continued-background sessions cannot become active without notification permission and that network settings map only to `UNMETERED` or `CONNECTED` WorkManager constraints.
- The unique periodic worker is constrained by battery-not-low and defaults to a one-hour interval with a 15-minute flex window. It does not start a second engine while the app or a visible background session already owns synchronization.
- WorkManager scheduler metadata may survive a reboot, but a boot-count gate prevents the worker from starting Syncthing until the app has been opened during the current boot.
- Process lifecycle handling keeps app-owned QR scanning from being treated as a true background transition. Leaving the application stops continuous synchronization unless the user enabled the notified session.
- API 35+ timeout, notification stop, app-background stop, policy stop, and opportunity-completion reasons are persisted for the sync-center status.
- Frontend tests and arm64/x86-64 Kotlin compilation and unit tests pass. API 36 emulator checks pass for notification denial, QR permission denial, notification stop, API timeout, force-stop, reboot gating, and foreground/background transitions. Physical foreground/background, notification, force-stop, identity recovery, and naturally timed bounded exchange behavior also pass. On 2026-07-29, JobScheduler recorded one successful worker; Syncthing logs show it connected to the paired desktop, transferred files, and stopped after the opportunity window.

### Android 16 Local Network Compatibility

- Install the API 36 build, enable local-network protection with `adb shell am compat enable RESTRICT_LOCAL_NETWORK com.slightnotes.v2`, and reboot the device or emulator.
- Before permission is granted, verify the app remains editable, reports that nearby-device access is required, and does not start the native engine from app lifecycle, manual start, or WorkManager.
- Tap **Start Sync**, deny nearby-device access, and verify local editing remains usable and the action can be retried.
- Tap **Start Sync** again, grant nearby-device access, and verify engine startup, Syncthing discovery, incoming connections, and direct LAN transfer.
- Revoke Nearby devices in system settings while the app is backgrounded; reopen the app and verify the managed engine stops and returns to the permission-required state.
- Confirm the merged manifest includes `NEARBY_WIFI_DEVICES` with `neverForLocation`, and does not include fine/coarse/background location permissions.
- Restore the default compatibility state after testing with `adb shell am compat disable RESTRICT_LOCAL_NETWORK com.slightnotes.v2`.

### Android Conflict Workflow Checkpoint - Current Branch

- The Android sync bridge filters Syncthing conflict IDs and returns only ID, source ID, and update time; note content is not included in the conflict-status result.
- The mobile note list marks conflicts separately. Opening one hides the ordinary delete and formatting actions, sets the editor to `contenteditable=false`, and exposes keep-copy, copy-content, and trash actions.
- Keeping a copy writes the same Markdown content through the normal native save path under a non-conflict unique name. Viewing and copying do not write the original conflict file.
- A 320x640 browser fixture confirmed no horizontal overflow, 44px conflict actions, a 44px sync-center conflict row, and a read-only editor attribute. The fixture was removed after validation.
- API 36 runtime acceptance passes for competing Android/desktop offline edits, Syncthing conflict-file creation on both peers, conflict-list refresh, and read-only opening. On the physical arm64 phone, a controlled conflict passed clipboard copy, keep-as-new, and trash checks. The source, conflict, kept copy, and trashed conflict each retained SHA-256 `4eaf4c4ea9883ea8f0c7dfe451557c51e2a363fd1d3c4e2f7962904684d74bca`; only the chosen conflict path moved into `.trash`. Synthetic copies were removed after verification.

### Android API 36 Runtime Acceptance - Current Branch

- Installed the arm64 debug APK on a clean API 36 emulator and verified native Markdown create/save/reopen plus system Files visibility through `DocumentsProvider`.
- Verified nearby-device denial leaves editing available and prevents engine startup; granting access starts the bundled engine with a fixed loopback-only management endpoint. Later revocation stops it safely.
- Verified foreground synchronization without notification permission, explicit notified background synchronization, the notification stop action, default background stop, force-stop non-resurrection, reboot gating, and stable Syncthing identity across reopen and reboot.
- Forced the API 35+ `dataSync` foreground-service timeout and verified the service and child engine stop cleanly with a recorded reason and no crash.
- Paired the Android runtime with an isolated packaged desktop Syncthing peer using the app's manual device-code confirmation. A note created on Android arrived on desktop, and a desktop-created note arrived in the Android private Markdown directory.
- Stopped synchronization, edited the same two notes independently on both peers, reconnected, and verified real `.sync-conflict-*` files appeared on both sides and in the app's conflict workflow.
- Verified camera denial keeps the pairing screen usable, and portrait plus low-height landscape screenshots retain status-bar separation and usable controls.
- Final regression passed `npm test`, all 31 Rust tests, arm64/x86-64 Kotlin unit tests, both split debug APK builds through the Tauri Android entry point, and macOS application packaging. Reinstalling the final arm64 APK over the tested app preserved notes, conflicts, and the existing Syncthing identity.
- Final debug artifacts: `app-arm64-debug.apk` SHA-256 `4cc901f48b9f1b66267ce09002b21b440f0099a3f836bd8ccbe82e45c6fd563c`; `app-x86_64-debug.apk` SHA-256 `6e3297ac39ed9ae21065205d0bf626e973311b74ee9312e88587250c5ffd1854`.
- Not yet passed: x86-64 emulator runtime, controlled long-duration physical-phone power characterization, fresh-install signed-release runtime, and store submission.

### Android 16 Physical Device Acceptance - 2026-07-22

- Installed the arm64 debug APK on a Xiaomi 2211133C running Android 16/API 36 and HyperOS 3.0. The device reported `arm64-v8a`, a 1080x2400 display, and the 2025-10-01 security patch.
- Created, saved, reopened, and synchronized real Markdown from the application-private notes directory. The system file picker showed the `s-light notes` provider and exposed only ordinary notes and conflict copies, not `.trash`, Syncthing identity, configuration, database, logs, or credentials.
- Verified the nearby-device permission gate before startup, successful grant, later revocation with immediate engine stop, continued local editing, and recovery after the permission was restored.
- Paired with an isolated desktop Syncthing peer through the app's preview and confirmation flow. Android-to-desktop and desktop-to-Android creation, modification, offline recovery, and direct LAN transfer passed.
- Produced a real conflict through independent offline edits. The app listed the conflict, opened it read-only, and preserved its content as a new ordinary note without deleting the original conflict file.
- Granted camera access only from the scan action and captured a QR code containing the isolated peer ID. Parsing succeeded and duplicate-device protection rejected the existing peer without applying another configuration change.
- Verified foreground synchronization without notification permission. With an explicit notified background session enabled, the engine remained active after Home and Android reported a persistent notification with a stop action; disabling the session restored default background stop behavior.
- Verified force-stop prevents process or engine resurrection. Reopening restored the same Syncthing certificate/key identity, fixed folder, paired peer, and scheduled WorkManager task.
- Portrait keyboard input kept the editor usable. Portrait and landscape layouts retained system-bar separation, stable headers, and usable controls; the landscape keyboard naturally leaves only a shallow editing area on this device.
- Security checks found the management API only on `127.0.0.1:8386`, while P2P used the expected LAN listener. Engine identity, configuration, database, logs, and API key remained inside application-private storage.
- Follow-up physical acceptance on 2026-07-29 observed a naturally scheduled WorkManager run while unplugged. The worker connected to paired device `5KRUWAE`, exchanged files, completed successfully, and stopped after its bounded window. Battery level moved from 30% to 29% during the broader unplugged inspection.
- Android's aggregate battery statistics since the last charge estimated 32.5 mAh for the app UID: 6.28 mAh foreground, 3.34 mAh background, 0.0405 mAh foreground service, and 0.431 mAh cached. Screen-off/doze attribution included 0.762 mAh CPU, 0.823 mAh camera, and 0.147 mAh Wi-Fi; the recorded WorkManager job used 479 ms and completed once. This is a mixed-use upper bound that includes earlier camera and foreground testing, not an isolated drain benchmark.
- The same follow-up completed the conflict clipboard, keep-as-new, trash, and SHA-256 preservation checks. A debug-package reinstall preserved the Syncthing certificate and private-key hashes exactly.

### Android Signed Release Checkpoint - 2026-07-29

- The release configuration refuses to run without ignored local signing properties. `npm run android:signing:setup` creates a 4096-bit RSA PKCS12 identity and local properties with owner-only permissions and refuses to replace an existing identity.
- `npm run tauri:android:build:release` targets only aarch64 and x86_64, producing two installable APKs and one universal AAB. The AAB contains both `arm64-v8a` and `x86_64` Rust and Syncthing libraries.
- Both APKs pass Android `apksigner` verification with v2 and v3 signature schemes. The AAB passes JAR signature verification. All three artifacts use certificate SHA-256 `bde886bebb20114c53661299f4d40bb679acbe433bb476eb4ab5bf7977efaddd`.
- Package metadata is `com.slightnotes.v2`, version code `2000000`, version name `2.0.0-alpha.0`, minimum API 26, and target API 36.
- Collected release artifacts:
  - arm64-v8a APK: 19,145,129 bytes; SHA-256 `de93522ffbe2962aa5d0166cea0c54140817d4f28211a6dc720d46b5776383a4`.
  - x86_64 APK: 19,924,144 bytes; SHA-256 `0a3c8feb827eaba71f44012f5c7f2b547e1905eea8c6e91e33f2ef277d3741ad`.
  - universal AAB: 37,363,533 bytes; SHA-256 `85eda2369427ec8b3afbef40ac30b55964987117360d96350613f86671661e88`.
- `npm test`, all 31 Rust tests after rebuilding the moved repository cache, arm64/x86_64 debug plus release Kotlin unit-test variants, and macOS desktop application packaging pass at this checkpoint.
- The signing identity is local and ignored but has not yet been backed up outside the development machine. Store upload validation remains pending.
- The installed acceptance build uses the Android debug certificate, while release artifacts use the local release certificate. Android rejects an in-place signature change, so the signed APK cannot replace the accepted debug package without uninstalling it and erasing application-private data. The phone's notes and identity were preserved; signed runtime smoke testing remains assigned to a fresh device or disposable test profile.

- Android build gate: target API 36, minimum API 26, NDK 28 or newer, and only the planned `arm64-v8a` and `x86_64` native artifacts.
- Android emulator gate: install and launch on an API 36 x86-64 image; verify 320px-430px layout, safe areas, keyboard, rotation, Android back handling, and no horizontal overflow.
- Android storage gate: create, save, reopen, trash, restore, permanently delete, and externally read/edit Markdown through the system `DocumentsProvider`.
- Android fallback gate: native-storage initialization failures are visible and do not silently move Tauri notes into IndexedDB; PWA continues to use IndexedDB normally.
- Android engine gate: verify pinned source metadata, ABI hashes, 16 KB page compatibility, isolated identity/config/data/log paths, fixed loopback API, and no desktop sidecar in the APK.
- Android lifecycle gate: verify foreground start, visible notification, notification stop action, graceful shutdown, early exit, API 35+ timeout handling, and no boot-started data-sync service.
- Android permission gate: camera denial preserves manual pairing; notification denial preserves foreground sync; battery restrictions and force-stop produce clear recoverable states.
- Android background gate: WorkManager performs bounded best-effort sync on an unmetered network and does not keep an undocumented daemon alive.
- Android P2P gate: pair a connected arm64 phone with a packaged desktop, exchange notes in both directions, edit while offline, reconnect, preserve identity, and retain Syncthing conflict copies.
- Android security gate: normal UI and JavaScript contain no API Key, raw config, arbitrary note path, management port, or LAN-exposed REST endpoint.
- Android regression gate: run `npm test`, all Rust tests, the macOS desktop build, and the Android build before the first user APK handoff.
- iOS validates foreground sync, opportunistic background tasks, suspended-state recovery, and clear last-sync status.
- Syncthing-Fork is used only as an optional behavior/build reference; the Android APK must not depend on or launch it.
- iOS keeps Möbius Sync or import/export as a fallback until the embedded engine is release-ready.
- Mobile UI does not depend on desktop-only Tauri commands.
