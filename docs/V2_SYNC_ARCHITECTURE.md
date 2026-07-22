# s-light notes v2 Sync Architecture

## Overview

v2 keeps Syncthing as the sync engine and provides platform-owned lifecycle adapters. Desktop packages manage a sidecar process; Android packages manage a separately built Android-native engine through a Kotlin foreground service. Both paths retain the same constrained status, pairing, scan, confirmation, and rollback behavior.

## Components

- Frontend: existing HTML/CSS/JavaScript editor and note UI.
- `js/sync-service.js`: unified sync interface used by v2 frontend code.
- `js/desktop-service.js`: desktop-only bridge for default-folder Markdown operations.
- Tauri backend: native command layer for app paths, Syncthing process checks, local API proxying, and safe config previews.
- Syncthing: bundled desktop sidecar in release builds; existing system installation only as an advanced/development fallback.
- Android mobile shell: the existing dedicated `mobile.html`, `mobile.css`, and `mobile.js` entry rather than the desktop layout.
- Android Tauri plugin: Kotlin bridge for foreground service, permissions, system file exposure, QR scanning, battery settings, and Android lifecycle events.
- Android Syncthing engine: pinned v2.1.2 native artifacts for `arm64-v8a` and `x86_64`; never the desktop external binary.

## Data Flow

```text
UI action
  -> syncService
  -> Tauri invoke when available
  -> Rust-owned credentials and constrained commands
  -> bundled Syncthing sidecar REST API on loopback
  -> status/proxy result
  -> UI sync center
```

In Web/PWA mode, `syncService` falls back to existing v1 helpers where possible. If no desktop backend exists, operations that require native privileges fail with a clear message.

## Android Data Flow

```text
mobile.html
  -> mobileStorageService / syncService
  -> Tauri Rust Android adapter
  -> Kotlin Tauri plugin
  -> SyncthingForegroundService
  -> bundled libsyncthingnative.so PIE executable
  -> application-owned Markdown directory
  -> P2P transfer to a desktop device
```

- The Android editor and Syncthing engine operate on the same application-owned directory of ordinary `.md` files.
- An Android `DocumentsProvider` exposes active notes and conflict copies through the system file picker without exposing `.trash`, identity, configuration, database, logs, or runtime credentials.
- PWA mode keeps IndexedDB. Android Tauri mode selects native storage and never silently falls back to IndexedDB after native initialization fails.
- Platform-specific Tauri configuration loads the mobile entry and clears desktop `externalBin` packaging for Android.

## Android Lifecycle

- Process-level lifecycle observation starts the managed engine when the application becomes visible and avoids treating an in-app QR activity transition as leaving the application.
- While the app is visible, synchronization remains active without requiring broad storage access.
- Leaving the app stops continuous synchronization by default. A user-enabled `dataSync` foreground service may keep a bounded background session alive only after notification permission is granted and always provides a stop action.
- AndroidX WorkManager 2.10.1 owns one unique periodic task. It runs at most once per one-hour interval with a 15-minute flex window, requires battery-not-low, and uses `UNMETERED` by default or `CONNECTED` after an explicit user setting change.
- The worker skips execution while the application or a user-enabled background session already owns the engine. Otherwise it starts the engine, waits for readiness, scans the fixed notes folder, permits a short exchange window, and stops it.
- API 35+ timeout callbacks stop the engine before the platform declares an ANR and record a user-visible reason.
- The app has no boot receiver and never starts its engine or `dataSync` foreground service from `BOOT_COMPLETED`. WorkManager's library components may restore scheduler metadata, but the worker compares Android's boot count and exits until the user opens the app during that boot.
- Force-stop terminates service and scheduled work. Nothing silently restarts until the user opens the app again.
- Camera denial preserves manual device-code entry; notification denial preserves foreground synchronization.
- API 36+ local-network protection uses `NEARBY_WIFI_DEVICES` with `neverForLocation`. The process lifecycle, manual start command, and WorkManager worker all check the native permission before starting Syncthing; the frontend cannot bypass that gate.
- Battery settings use the general system settings screen. The package does not declare `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` or directly request an exemption.

## Android Native Boundary

- The Android engine is built from pinned Syncthing v2.1.2 source for arm64 and x86-64 with Go 1.25.11 and NDK 28 or newer, and its ELF load segments are verified at 16 KB alignment.
- `libsyncthingnative.so` is an Android PIE executable stored under `jniLibs` so the package manager extracts it to the private native-library directory. It is launched as a managed child process and is not loaded as a JNI shared library.
- Kotlin owns process/service lifecycle, safe REST requests, the private API Key, fixed runtime paths, initial folder binding, pairing validation, one-time confirmation tokens, readback, and rollback. Rust exposes only constrained Tauri commands and never returns the credential to JavaScript.
- The Android sync center receives only device IDs, display names, connection booleans, bounded folder counters, and user-facing messages. It cannot provide device addresses, arbitrary REST paths, folder paths, ports, or raw configuration.
- ZXing launches only from the explicit scan action. A scan fills the device-code field and still passes through the same preview and confirmation flow as manual entry.
- The REST endpoint remains loopback-only and fixed by native code. JavaScript cannot provide a port, API base, path, or credential.
- Android notes paths are resolved natively and cannot be replaced by a frontend-supplied path or document URI.
- Android package metadata records source revision, Go/NDK versions, ABI hashes, and MPL-2.0 notices.

## Tauri Commands

- `get_app_paths`: returns app data and default notes paths.
- `ensure_notes_folder`: creates the default notes folder.
- `syncthing_status`: checks local Syncthing health.
- `syncthing_start`: starts the discovered executable with `--no-browser`; an explicit `SLIGHT_SYNCTHING_BIN` takes priority.
- `syncthing_stop`: stops only a Syncthing process started by this app session.
- `syncthing_proxy_request`: proxies safe local REST requests to Syncthing.
- `syncthing_apply_folder_config`: returns a confirmation summary and a five-minute, single-use token without writing configuration.
- `syncthing_confirm_folder_config`: consumes the token, rechecks live folder conflicts, creates one new folder, and verifies the result.
- `syncthing_pairing_info`: returns the local device ID, an offline-generated QR SVG, configured devices, pending devices, and current connection state without returning credentials.
- `syncthing_events`: performs bounded long polling with fixed event filters, an incremental event ID, and backend-owned credentials.
- `syncthing_preview_device_pairing`: validates and normalizes one remote device ID and returns a five-minute confirmation summary without writing.
- `syncthing_confirm_device_pairing`: consumes the one-time token, adds one device, shares only `s-light-notes`, verifies both writes, and rolls back on failure.
- `open_notes_folder`: opens the notes folder in the system file manager.
- `open_syncthing_web`: opens the Syncthing Web UI.
- `desktop_list_notes`: lists Markdown files in the default notes folder or its `.trash` directory.
- `desktop_read_note`: reads one validated Markdown note.
- `desktop_save_note`: creates or updates one validated Markdown note.
- `desktop_move_to_trash`: moves a note into the local `.trash` directory.
- `desktop_restore_note`: restores a note from `.trash`.
- `desktop_delete_note`: permanently deletes a note from `.trash`.
- Android-only `android_get_background_policy` and `android_set_background_policy`: read and update constrained opportunity/background choices without exposing native credentials or paths.
- Android-only `android_request_notification_permission`: requests notification access only after a user action and returns a boolean result.
- Android-only `android_request_local_network_permission`: requests API 36+ nearby-device access from the explicit sync-start flow and returns a boolean result.
- Android-only `android_open_battery_settings`: opens system battery settings without requesting an optimization exemption.

## Desktop Storage Boundary

- The desktop editor selects `desktop` storage mode when the Tauri backend is available.
- Tauri injects `window.__TAURI__` for the existing zero-bundler HTML frontend; desktop calls remain limited to the registered command set.
- All desktop note operations resolve from the application default notes folder; the frontend cannot send an arbitrary file path.
- Note IDs containing path separators or platform-unsafe filename characters are rejected.
- Symlinked note files and symlinked managed directories are not followed.
- Web/PWA builds continue to use File System Access API or IndexedDB without calling desktop commands.

## Desktop Lifecycle

- The alpha product lifecycle is app-bound: closing the final window or quitting the app stops the bundled sidecar.
- Manual stop, window destruction, app exit requests, final event-loop exit, and future Tauri restart requests share the same backend cleanup path.
- Cleanup first posts to the authenticated Syncthing `/rest/system/shutdown` endpoint and waits for health to disappear. It kills only the app-tracked child if graceful shutdown exceeds the bounded timeout.
- A running app can also shut down an authenticated app-owned sidecar left by an earlier interrupted instance, even when no child handle remains.
- Syncthing identity, database, and configuration remain in the application-data directory and are not deleted during shutdown or app replacement.

## Security Rules

- The bundled backend targets `http://127.0.0.1:8385`; this value is fixed in Rust and cannot be supplied by the frontend. External development override mode uses `http://127.0.0.1:8384`.
- Automated protocol tests may inject a temporary loopback port into private Rust helpers; no Tauri command or frontend interface can change the production API target.
- External engine discovery checks `SLIGHT_SYNCTHING_BIN`, the process `PATH`, and common native install paths. An invalid explicit path fails without silently choosing another binary.
- After a user-triggered start, the backend polls local health for a bounded period, reports an early exit, and keeps a live process handle so only app-managed Syncthing can be stopped.
- Proxy paths must start with `/` and must not contain `://` or `..`.
- The bundled API Key is generated by Rust, stored as a private application-data file, passed to Syncthing through the child-process environment, and never returned to JavaScript or placed in process arguments.
- The bundled sidecar API Key must remain in the Rust/application-data boundary and must not be returned to frontend JavaScript.
- The sidecar uses an application-owned home directory and must not read or overwrite a system Syncthing identity.
- Release builds pin the sidecar version and disable Syncthing self-upgrade so application updates own compatibility and rollback.
- API keys are validated against header injection and attached only to the current localhost request as `X-API-Key`; the Rust backend does not persist them.
- Desktop status refresh, scan, device/folder reads, and configuration-assist reads must use the Tauri proxy instead of browser `fetch`.
- External user-managed folder config writes require a user-visible confirmation step. The isolated app-owned sidecar may create its default folder automatically and verifies the write by reading it back.
- Configuration previews accept only the canonical v2 default notes path, reject duplicate folder IDs, and never call a Syncthing write endpoint.
- Confirmation tokens are held only in application memory, expire after five minutes, and can be used once. API Keys are not stored with them.
- Confirmed writes re-read live Syncthing configuration and never replace an existing folder ID or an existing binding for the same path.
- After creating a folder, the backend reads it back. If verification fails, it attempts to remove only the newly created folder ID.
- The app must never expose the Syncthing proxy to LAN devices by default.
- Device pairing accepts only a validated Syncthing device ID and a bounded display name; the frontend cannot provide addresses, folder paths, folder IDs, or arbitrary device options.
- Pairing writes require a separate confirmation token. The backend rechecks duplicates, preserves existing folder devices, and verifies both the device and folder configuration.
- The QR image encodes only the canonical local device ID. Rust generates the SVG offline; it contains no API Key, network address, folder path, or note content.
- Event polling fixes the accepted event types, timeout, and result limit in Rust. The frontend supplies only the last processed non-negative event ID and stops polling when the sync center closes.
- Sidecar start and stop share one lifecycle lock so a close request cannot race with an in-progress automatic start.

## v2 Alpha Limitations

- Desktop sidecars are pinned for macOS Apple Silicon/Intel, Windows x64, and Linux x64. Native package validation remains pending for macOS Intel and Linux x64.
- QR display, device-code pairing, and sync-center event refresh are available. Camera scanning and conflict-resolution workflows are not complete.
- External development override mode still accepts a user-provided API Key; standard bundled-sidecar UI hides those advanced fields.
- Android background sync is bounded by foreground-service and job quotas; it is not an all-day daemon. iOS background behavior remains a separate later track.
