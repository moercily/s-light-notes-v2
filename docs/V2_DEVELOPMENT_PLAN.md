# s-light notes v2 Development Plan

## 1. Plan Scope

This document is the active implementation plan for v2. The v2 repository is independent from v1 and contains its own frontend, Tauri shell, Rust backend, Syncthing sidecar metadata, tests, and release artifacts.

Status meanings:

- `[x]` completed and verified.
- `[ ]` planned but not completed.
- A checklist item is not considered complete until its acceptance condition is recorded in `V2_TEST_PLAN.md`.

v1 Web/PWA plans remain historical compatibility references. They do not redefine the v2 desktop or mobile release scope.

## 2. Current Baseline

Completed and verified:

- Tauri v2 desktop shell with zero-bundler HTML frontend.
- Independent v2 Markdown storage mode using an application-owned default notes folder.
- Create, read, update, trash, restore, and permanent delete for desktop Markdown notes.
- Pinned Syncthing v2.1.2 desktop sidecars for macOS Apple Silicon/Intel, Windows x64, and Linux x64.
- Application-owned Syncthing identity, configuration, database, logs, ports, and backend credential.
- First-run default folder creation and isolated folder binding.
- Device-code pairing with validation, preview, second confirmation, folder sharing, readback, and rollback.
- Offline local-device QR display with manual code copy fallback.
- Bounded Syncthing event polling while the sync center is open.
- Graceful sidecar shutdown on manual stop, window close, app quit, and Tauri restart requests.
- Sidecar fallback termination when graceful shutdown exceeds its bounded timeout.
- macOS Apple Silicon packaged-app validation, including restart identity preservation and exit cleanup.
- Frontend test suite and 31 Rust tests passing at the latest implementation checkpoint.

Known release gaps:

- macOS Apple Silicon and Windows x64 have packaged-app proof; Linux and macOS Intel native package validation remain pending.
- Windows x64 has been packaged and tested under x64 emulation, but its interactive Markdown loop and native x64 hardware coverage remain pending.
- Android QR capture, Android-to-desktop synchronization, offline recovery, and conflict handling have passed API 36 emulator and arm64 physical-device acceptance.
- Two-desktop synchronization and conflict acceptance remain pending.
- Installable Android debug APKs exist for arm64-v8a and x86_64; iOS has not been created.
- Android naturally scheduled WorkManager exchange, unplugged aggregate power observation, and conflict-action integrity checks pass on the physical arm64 device. Signed APK/AAB packaging is complete; a controlled long-duration power run and store submission remain pending.
- Automatic installer/updater integration has not been created.

Current implementation focus (2026-07-29): secure the Android release identity outside the development machine, prepare fresh-install/store-upload validation, and resume the remaining cross-platform acceptance work.

## 3. Product Release Target

The first usable v2 desktop release must allow a non-technical user to:

1. Install and open a normal desktop application.
2. Create or use the application-owned Markdown notes folder.
3. Pair another device without entering API addresses, ports, or API Keys.
4. Create and edit ordinary `.md` files while offline.
5. See connection, folder, scan, completion, and error states.
6. Quit the app knowing that the alpha sidecar has stopped.
7. Restart the app without losing the device identity or folder configuration.

The first mobile release is a compatibility milestone, not a promise of identical background behavior across platforms. Android and iOS must preserve Markdown compatibility and clearly state their synchronization limitations.

## 4. Priority and Dependency Order

Work must follow this order:

1. Preserve the existing desktop regression gate while Android work is isolated on `codex/android-v2`.
2. Initialize a Tauri Android project targeting API 36 with API 26 as the minimum.
3. Add native Markdown storage and the dedicated mobile shell without changing the desktop entry.
4. Build and manage a pinned Syncthing v2.1.2 Android engine inside the application.
5. Complete Android pairing, QR scanning, bounded background synchronization, and real-device P2P tests.
6. Resume remaining Windows, Linux, macOS Intel, and two-desktop acceptance work after the Android test APK is usable.
7. Add signed installers, update migration, and release automation after platform behavior is stable.

Android work must not weaken the desktop tests, expose Syncthing credentials, or reuse a desktop sidecar binary.

## 5. Phase V2.1: Desktop Alpha Completion

### 5.1 macOS Smoke Test

- `[x]` Create a note, edit it, close the app, reopen it, and verify content.
- `[x]` Verify the saved `.md` file is visible and readable in Finder.
- `[x]` Modify a Markdown file outside the app and verify the app can observe the change after refresh/reopen.
- `[x]` Verify delete, restore, permanent delete, and `.trash` behavior in the packaged app.
- `[x]` Verify the desktop app never shows the browser folder-permission picker.
- `[ ]` Verify local editing remains available when the sidecar is stopped or unavailable.

Current checkpoint (2026-07-15): the user completed the packaged-app manual acceptance run and confirmed the create/edit/reopen, Finder visibility, external modification, trash lifecycle, and no-browser-permission-picker checks. A disposable package copy also proved that a sidecar startup failure does not terminate the main app. Actual editing and saving while the sidecar is unavailable remains a separate pending check.

Exit condition: all items pass on the packaged macOS Apple Silicon application and are recorded in the manual test section.

### 5.2 Desktop Regression Gate

- `[x]` Run `npm test` from the v2 repository.
- `[x]` Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- `[x]` Run `npm run tauri:build`.
- `[x]` Confirm the v1 repository has no unintended changes. The existing `css/style.css` modification predates this v2 checkpoint and was not touched.
- `[ ]` Confirm the v2 working tree contains only the intended release changes before tagging.

## 6. Phase V2.2: Windows and Linux Desktop Packages

### 6.1 Native Build Matrix

Build and test on the native operating system. Cross-compilation is not accepted as the only verification path.

- `[x]` Windows x64: install Rust, Node.js, Tauri prerequisites, and WebView2 requirements.
- `[x]` Windows x64: run frontend tests, Rust tests, and Tauri build.
- `[ ]` Windows x64: install the generated package and run the desktop Markdown loop.
- `[ ]` Linux x64: install GTK/WebKit/Tauri prerequisites and run frontend tests, Rust tests, and Tauri build.
- `[ ]` Linux x64: install the generated package and run the desktop Markdown loop.
- `[ ]` macOS Intel: build and run the desktop package on native hardware or an approved native CI runner.

Windows checkpoint (2026-07-16): Parallels Windows 11 ARM64 used the x64 Node and `x86_64-pc-windows-msvc` Rust toolchains plus the installed Visual Studio x64 C++ workload. Frontend tests, all 31 Rust tests, the x64 release build, NSIS packaging, installation, launch, sidecar health, normal-exit cleanup, and identity persistence passed under Windows x64 emulation. The interactive Markdown loop and native x64 hardware coverage remain pending.

macOS Intel preparation checkpoint (2026-07-20): the official x86-64 sidecar was verified and `npm run tauri:build:macos-intel` produced an x86-64 `.app` on Apple Silicon. The package launched under Rosetta and its bundled sidecar passed the loopback health check. Native Intel hardware or CI acceptance remains pending.

### 6.2 Sidecar Artifacts

- `[x]` macOS Apple Silicon: `aarch64-apple-darwin` proof completed.
- `[x]` macOS Intel: add and verify `x86_64-apple-darwin` archive integrity, binary architecture, and v2.1.2 execution under Rosetta.
- `[x]` Windows x64: add and verify `x86_64-pc-windows-msvc` with the executable suffix required by Tauri.
- `[x]` Linux x64: add and verify `x86_64-unknown-linux-gnu` archive integrity, ELF architecture, and Go build metadata; native execution remains part of package acceptance.
- `[x]` Record the exact Syncthing version, source URL, checksum, license notice, and target triple for every artifact.
- `[ ]` Verify each package starts its sidecar with an isolated application-data directory and the correct loopback/API/P2P ports.
- `[ ]` Verify each package can coexist with a system Syncthing installation without reusing or overwriting its identity.
- `[ ]` Verify each package stops the sidecar on normal app quit and preserves identity on restart.

### 6.3 Package Acceptance

- `[ ]` Windows installer launches, creates the notes folder, and exposes no raw Syncthing configuration in the normal UI.
- `[ ]` Linux package launches, creates the notes folder, and exposes no raw Syncthing configuration in the normal UI.
- `[ ]` Unsupported architecture, missing sidecar, port conflict, early exit, and corrupt configuration produce actionable messages.
- `[ ]` Package artifacts and checksums are stored outside source-controlled temporary build output.

Exit condition: one installable package is validated for each supported desktop target, with its sidecar artifact and test record.

## 7. Phase V2.3: Real P2P Synchronization

This phase validates the product behavior against two independent Syncthing identities. Mock protocol tests are not sufficient for completion.

### 7.1 Two-Desktop Pairing

- `[ ]` Pair two packaged desktop applications on the same LAN using device codes.
- `[ ]` Confirm the local device code and remote device code are both required.
- `[ ]` Confirm the default `s-light-notes` folder is shared only after the confirmation step.
- `[ ]` Confirm both devices show the remote device as connected when the network permits it.
- `[ ]` Confirm reconnecting an offline device resumes synchronization without recreating the folder.

### 7.2 File Synchronization

- `[ ]` Device A creates a note; Device B receives the `.md` file.
- `[ ]` Device B edits the note; Device A receives the update.
- `[ ]` Both devices create different notes while disconnected; both notes survive reconnection.
- `[ ]` Closing and reopening either app does not change the Syncthing device identity.
- `[ ]` Stopping the app stops only the app-owned sidecar and does not stop a separately installed system Syncthing.

### 7.3 Conflict Handling

- `[ ]` Edit the same note independently on both devices while offline.
- `[ ]` Reconnect and verify Syncthing creates a conflict copy rather than silently overwriting content.
- `[x]` Show the conflict copy as a conflict item, separate from normal notes.
- `[x]` Preserve the original conflict content during view, copy, keep, and delete operations.
- `[x]` Update sync-center wording to match the observed conflict behavior.

Exit condition: a two-device test record contains successful create, update, offline, reconnect, and conflict cases.

## 8. Phase V2.4: QR and Pairing Completion

- `[x]` Display the local device code as an offline QR image.
- `[x]` Retain manual copy and manual entry as a fallback.
- `[x]` Define camera permission behavior separately for Android and iOS.
- `[ ]` Add QR scanning for the selected mobile platform.
- `[ ]` Reject malformed or unsupported scanned data before any configuration write.
- `[ ]` Keep the same preview, second confirmation, folder scope, and rollback rules for scanned codes.
- `[ ]` Verify that camera denial leaves manual device-code pairing fully usable.

QR scanning is blocked until the mobile shell and permission model are selected.

## 9. Phase V2.5: Mobile Compatibility Track

### 9.1 Mobile Baseline Before Native Sync

- `[ ]` Test the current Web/PWA compatibility entry on Android Chrome using HTTPS or localhost.
- `[ ]` Test the current Web/PWA compatibility entry on iOS Safari and standalone Home Screen mode.
- `[ ]` Verify 320px-430px layouts, safe-area spacing, keyboard behavior, sidebar behavior, toolbar behavior, and no horizontal overflow.
- `[ ]` Verify Android file workflow with IndexedDB and the selected file-sharing route.
- `[ ]` Verify iOS import/export or Möbius Sync folder workflow.
- `[ ]` Verify mobile editing remains usable when the sync engine is unavailable.

### 9.2 Android Native Route

- `[x]` Select a Tauri mobile shell with an in-app Syncthing engine; Syncthing-Fork is a build/lifecycle reference only.
- `[x]` Create an Android project or Tauri Android target without reusing the desktop sidecar binary.
- `[x]` Target Android 16/API 36, minimum API 26, and the `arm64-v8a` and `x86_64` ABIs using NDK 28 or newer.
- `[x]` Store real Markdown files in an application-owned directory and expose only notes through an Android `DocumentsProvider`.
- `[x]` Build pinned Syncthing v2.1.2 Android native artifacts with recorded source, checksums, license, ABI, and 16 KB page compatibility.
- `[x]` Implement foreground-service lifecycle, bounded WorkManager synchronization, notification handling, and API 35+ timeout cleanup.
- `[x]` Keep foreground editing usable when notification, camera, or background execution permission is unavailable.
- `[x]` Add offline QR scanning with manual device-code fallback and preserve preview/confirmation/rollback rules.
- `[x]` Gate Android 16 local-network access behind `NEARBY_WIFI_DEVICES` without requesting location access.
- `[x]` Pair the API 36 Android runtime with an isolated desktop device and validate create/update/offline/conflict flows.
- `[x]` Document and verify that force-stop halts synchronization and reopening restores the same device identity.
- `[x]` Complete arm64 physical-device acceptance for storage, QR capture, permissions, direct P2P transfer, conflicts, rotation, keyboard, `DocumentsProvider`, and foreground-service lifecycle.
- `[x]` Observe one naturally scheduled WorkManager exchange and measure unplugged physical-device power behavior.

Android implementation checkpoint (2026-07-21): the dedicated Tauri project, platform split, native Markdown store, `DocumentsProvider`, mobile layout, and both pinned Syncthing engine artifacts are implemented. The arm64 and x86-64 artifacts are Android PIE executables packaged under `jniLibs` with the `.so` suffix used by the established Android wrapper pattern; they are managed as child processes and are not JNI libraries. Both ABI builds compile and package successfully. Foreground-service source and API 35+ timeout cleanup are present, but runtime service, permission, background, and P2P acceptance remain open until an emulator or connected device is available.

Android pairing checkpoint (2026-07-22): the dedicated mobile sync center, safe status model, manual device-code flow, offline ZXing QR scanner entry, five-minute single-use confirmation, folder sharing, readback, and rollback are implemented. JavaScript cannot provide API credentials, management addresses, note paths, device addresses, or raw Syncthing configuration. arm64 and x86-64 APK builds, both Kotlin test variants, and 320px/390px/landscape browser layout checks pass. Camera permission and actual QR capture now pass on a physical API 36 arm64 phone, including canonical device-code parsing and duplicate-device rejection.

Android background-policy checkpoint (2026-07-29): process-level foreground detection now keeps synchronization active across in-app activities such as QR scanning. Leaving the app stops the continuous engine by default. AndroidX WorkManager 2.10.1 schedules a unique one-hour best-effort task with a 15-minute flex window, battery-not-low constraint, and unmetered network by default; the worker starts the engine only for a bounded scan/exchange window and refuses to run until the user has opened the app during the current system boot. A separately controlled background session requires notification permission, remains user-visible, uses `START_NOT_STICKY`, and records notification, policy, opportunity-completion, and API 35+ timeout stop reasons. No app-owned boot receiver or battery-optimization exemption request is added. API 36 emulator checks pass for notification denial, the visible stop action, system foreground-service timeout cleanup, force-stop, reboot gating, and identity persistence. On the unplugged arm64 phone, JobScheduler recorded a naturally timed successful worker; Syncthing logs show it connected to the paired desktop, exchanged files, and stopped after the bounded opportunity. Android battery statistics provide a mixed-use upper bound for the app since the last charge, including one successful WorkManager job; a controlled long-duration isolation run remains useful for store-quality power characterization.

Android 16 local-network checkpoint (current branch): the package declares `NEARBY_WIFI_DEVICES` with `neverForLocation`, requests it only from the user-triggered sync start flow on API 36+, and keeps note editing available after denial. Process startup, manual start, and WorkManager all enforce the native permission gate. JavaScript receives only required/granted booleans and cannot bypass the check. API 36 emulator and physical arm64 checks pass for the permission-required state, grant, later revocation, engine shutdown, rediscovery, and direct LAN transfer.

Android conflict-workflow checkpoint (2026-07-29): Syncthing conflict filenames are identified through the shared Markdown naming rules and shown with a dedicated badge in the mobile note list plus a source/time list in the sync center. Opening a conflict copy forces the editor to `contenteditable=false`, hides editing tools, and offers only preserve-as-new, copy-content, and trash actions. A constrained Android bridge test confirms conflict status results omit note content, and 320x640 browser checks confirm the read-only panel and sync list have no horizontal overflow with 44px controls. A physical API 36 runtime and an isolated desktop peer produced real conflict files after independent offline edits. A controlled physical-device integrity pass then verified clipboard copy, keep-as-new, and trash: the source, kept copy, conflict, and trashed conflict all retained the same SHA-256 content hash, while only the selected conflict path moved to `.trash`.

Android API 36 runtime checkpoint (2026-07-29): emulator acceptance and physical arm64 acceptance both pass for install/launch, application-private Markdown, `DocumentsProvider`, guarded native-engine startup, stable identity, pairing, bidirectional transfer, offline reconnection, real conflict generation, conflict-action integrity, and naturally scheduled bounded synchronization. The physical phone also passes camera QR capture, duplicate-device protection, permission revocation/recovery, portrait keyboard input, landscape layout, notified background synchronization, default background stop, force-stop non-resurrection, and unplugged aggregate battery observation. The management API remains loopback-only and all engine credentials remain in app-private storage. Controlled long-duration power characterization, x86-64 emulator runtime, fresh-install signed-release smoke testing, and store submission remain open.

Android signed-release checkpoint (2026-07-29): the Gradle release build now fails closed when local signing material is absent. A one-time setup command creates a 4096-bit RSA PKCS12 identity and ignored local properties with owner-only permissions; neither is committed. The release workflow produces signed arm64-v8a and x86_64 APKs plus one universal AAB containing both supported ABIs. APK Signature Scheme v2/v3, AAB JAR signing, certificate equality, package/version metadata, native contents, and SHA-256 manifests pass. The local signing identity must be backed up before external distribution.

Android branch and delivery policy:

- Implementation branch: `codex/android-v2`, created from v2 `main` at `8b461ff`.
- The first commit updates the four active v2 documents only; Android project generation begins after that commit.
- Intermediate APKs are internal validation artifacts. The first user handoff requires working P2P sync on a connected arm64 device.
- The first handoff uses a debug APK installed with ADB. Release signing and store submission follow functional acceptance.
- The branch is not merged into `main` until Android P2P, conflicts, lifecycle, permissions, and desktop regression gates pass.

Android exit condition: an API 36 emulator and a connected arm64 device can install the app; the device can edit offline, expose Markdown through the system file picker, pair with a desktop, sync both directions, recover after reconnect, show conflict copies, and stop synchronization after force-stop.

### 9.3 iOS Native Route

- `[ ]` Create an iOS project or Tauri iOS target with the existing editor core.
- `[ ]` Implement Files/document-picker access and security-scoped folder handling.
- `[ ]` Define foreground synchronization and opportunistic background task behavior.
- `[ ]` Preserve Möbius Sync and import/export as a fallback until embedded synchronization is proven.
- `[ ]` Test permission denial, suspended app recovery, relaunch, and file conflict visibility on two real iOS devices.
- `[ ]` Verify App Store/TestFlight signing and privacy declarations before distribution.

Mobile exit condition: at least one platform has an installable client with a documented synchronization promise, real-device tests, and a Markdown-compatible fallback.

## 10. Phase V2.6: Release and Update Engineering

- `[x]` Select NSIS as the first Windows installer format and provide `npm run tauri:build:windows`.
- `[x]` Add fail-closed Android release signing, split APK packaging, a universal AAB, and checksum collection without committing signing material.
- `[ ]` Back up the Android release identity outside the development machine and complete store listing, privacy, and upload validation.
- `[ ]` Select Linux package formats.
- `[ ]` Add macOS Intel, Windows, and Linux artifact checksums to the release process.
- `[ ]` Add code signing/notarization requirements for supported desktop platforms.
- `[ ]` Add an updater only after package installation and sidecar migration are stable.
- `[ ]` Make the updater call the same sidecar shutdown barrier before replacing binaries.
- `[ ]` Preserve Syncthing identity, configuration, database, and notes-folder binding across updates.
- `[ ]` Test interrupted update, rollback, incompatible sidecar version, and failed restart behavior.
- `[ ]` Create a release checklist covering installer, first run, pairing, sync, conflict, offline, update, and uninstall behavior.

## 11. Explicit Non-Goals for This Plan

- No central sync server, account system, or cloud note database.
- No real-time collaborative editing.
- No automatic conflict merge in v2 alpha.
- No silent background/tray synchronization before an explicit product decision and platform review.
- No direct reuse of the desktop Syncthing sidecar binary in Android or iOS packages.
- No automatic update system before native package behavior is stable.

## 12. Immediate Execution Queue

The next implementation sessions should use this order:

1. Back up the Android release identity outside the development machine.
2. Smoke-test the signed arm64 release as a fresh install on a separate device or disposable test profile.
3. Validate the AAB upload and complete the store listing and privacy materials.
4. Run a controlled long-duration unplugged power characterization.
5. Resume native Linux, macOS Intel, Windows x64 hardware, x86-64 Android emulator, and two-desktop acceptance.

The accepted debug build and the new release build use different signing identities. Android therefore cannot install the release APK over the debug package in place; doing so requires uninstalling the debug package and would erase its application-private notes and Syncthing identity. The accepted phone is intentionally preserved, so release runtime validation must use a fresh installation target.

## 13. Change and Commit Rules

- Keep v2 commits in the independent v2 repository.
- Keep desktop, mobile, sidecar, and release changes in separate commits when practical.
- Do not mark a checklist item complete from a mock test alone when the item requires a real OS, installer, device, or network.
- Update this plan and `V2_TEST_PLAN.md` together when an acceptance condition changes.
- Do not merge v2 into a release branch until the target package, sidecar, and corresponding manual test record exist.
