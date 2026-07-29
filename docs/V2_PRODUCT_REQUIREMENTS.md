# s-light notes v2 Product Requirements

## Product Goal

s-light notes v2 is a P2P synced Markdown notes app. Notes remain ordinary `.md` files, while Syncthing provides device-to-device file synchronization without a central account server.

## Target Users

- People who want local-first notes across their own devices.
- Users who prefer file ownership over cloud-only note services.
- Non-technical users who should not need to open raw HTML files, start a Node proxy, or understand Syncthing ports.

## v2 Experience

- Desktop users install and open a normal app.
- The app creates or selects a notes folder.
- Desktop release packages include and automatically manage a Syncthing sidecar.
- Normal users do not install, start, or manually configure a separate Syncthing application.
- Device connection uses an in-app device-code or QR pairing flow instead of API addresses, ports, or API Keys.
- The app shows P2P sync status in a dedicated sync center.
- The v2 alpha sync center clearly states that quitting the app stops P2P synchronization.
- The app keeps editing usable when Syncthing is unavailable.

## Platform Policy

- Desktop is the primary v2 platform: macOS, Windows, and Linux through Tauri with a bundled Syncthing sidecar.
- Desktop alpha does not silently remain in the tray or background after the user quits the app.
- Android is the current highest-priority delivery platform and targets an in-app Syncthing engine managed by an Android foreground service; Syncthing-Fork remains a compatibility/testing reference only.
- Android targets API 36 with API 26 as its minimum and initially supports arm64 physical devices plus x86-64 emulators.
- Android stores real Markdown files in an application-owned directory and exposes only note files through the system document picker. It does not request broad all-files access.
- Android foreground sync is user-visible and bounded by current platform limits. The app does not promise continuous all-day background execution or start a data-sync foreground service at boot.
- Android runs continuous synchronization while the app is visible. By default, leaving the app stops the continuous engine and permits only short, system-scheduled opportunity sync on an unmetered network while the battery is not low.
- Continuing a bounded synchronization session after leaving the app is an explicit user choice and requires notification permission. Denial leaves foreground editing and synchronization available.
- The app may open Android battery settings for explanation and recovery, but does not request exemption from system battery optimization.
- Android remains editable when the engine is stopped or camera, notification, and background execution access is unavailable.
- On Android 16+, P2P startup requests nearby-device access only after the user taps the sync start action. Denial or later revocation stops P2P but does not block local notes, and the permission is explicitly marked as not used for location.
- iOS may embed an adapted Syncthing engine, but only promises foreground and opportunistic background synchronization.
- Möbius Sync or file import/export remains an iOS fallback until the in-app engine is validated.

## Non-Goals

- No central server.
- No user account system.
- No proprietary primary note database.
- No silent Syncthing configuration writes.
- No automatic conflict merge in v2 alpha.

## Acceptance Criteria

- A normal user can launch the desktop app without manually opening `index.html`.
- A clean desktop installation can enable P2P sync without installing or opening Syncthing separately.
- Normal sync setup does not expose API addresses, API Keys, ports, or raw Syncthing configuration.
- The standalone v2 repository builds and tests without files from the v1 repository.
- v1 remains usable as a separately maintained Web/PWA project.
- Notes are still readable as Markdown files outside the app.
- Syncthing status failures are visible and do not block local editing.
- Conflict files are visible as conflicts, not mixed silently into normal notes.
- The first Android test APK includes in-app P2P sync, not only offline IndexedDB storage.
- Android can pair with a packaged desktop without exposing API addresses, ports, API Keys, or raw configuration.
- Android and desktop can exchange Markdown in both directions, recover after offline edits, and preserve conflict copies.
- Android notes are visible through the system file picker while Syncthing identity, configuration, database, logs, and credentials remain private.
- Force-stopping Android stops synchronization; reopening the app restores the managed engine without changing its device identity.
