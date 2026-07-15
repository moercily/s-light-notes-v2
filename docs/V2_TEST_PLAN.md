# s-light notes v2 Test Plan

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

Not yet accepted as passed:

- macOS denied Accessibility access to `osascript`, so controls could not be clicked or typed through the automated smoke runner.
- macOS also denied screen capture, so the absence of the browser folder-permission picker could not be independently recorded.
- Create/edit/save/reopen, Finder visibility, external modification, trash/restore/permanent delete, and actual editing while the sidecar is unavailable still require a short manual run.

Manual acceptance run:

1. Open the latest `s-light notes.app` and create a note named `macOS smoke note` with a second line of body text.
2. Quit and reopen the app; open the note and confirm both lines remain.
3. Use **Open Notes Folder** and confirm `macOS smoke note.md` is readable in Finder or a text editor.
4. Append `external edit` in a text editor, then reopen or refresh the app and confirm the added line appears.
5. Delete the note, restore it from Trash, delete it again, and permanently delete it; confirm the file moves through `.trash` and is finally absent.
6. Confirm no browser folder-permission picker appears at any point.

Do not mark Phase 5.1 complete until all six steps are recorded as passed.

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

- Android validates the in-app engine lifecycle, foreground-service notification, battery restrictions, storage permissions, and process recovery.
- iOS validates foreground sync, opportunistic background tasks, suspended-state recovery, and clear last-sync status.
- Android also verifies compatibility with a Syncthing-Fork synchronized folder during migration.
- iOS keeps Möbius Sync or import/export as a fallback until the embedded engine is release-ready.
- Mobile UI does not depend on desktop-only Tauri commands.
