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
- The app detects or starts Syncthing where possible.
- The app shows P2P sync status in a dedicated sync center.
- The app keeps editing usable when Syncthing is unavailable.

## Platform Policy

- Desktop is the primary v2 platform: macOS, Windows, and Linux through Tauri.
- Android is supported through a mobile entry that can use a folder synchronized by Syncthing-Fork.
- iOS is supported as a PWA/mobile-compatible entry with Möbius Sync or file import/export workflows.
- iOS does not promise a bundled background Syncthing engine.

## Non-Goals

- No central server.
- No user account system.
- No proprietary primary note database.
- No silent Syncthing configuration writes.
- No automatic conflict merge in v2 alpha.

## Acceptance Criteria

- A normal user can launch the desktop app without manually opening `index.html`.
- The standalone v2 repository builds and tests without files from the v1 repository.
- v1 remains usable as a separately maintained Web/PWA project.
- Notes are still readable as Markdown files outside the app.
- Syncthing status failures are visible and do not block local editing.
- Conflict files are visible as conflicts, not mixed silently into normal notes.
