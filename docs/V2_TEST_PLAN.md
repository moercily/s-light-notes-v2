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
  - Verifies unsafe note IDs cannot escape the default notes directory.
  - Verifies API Key header injection is rejected and a valid key is applied as `X-API-Key`.
  - Verifies Markdown files can be created, read, listed, moved to trash, restored, and permanently deleted in a temporary directory.
  - Verifies configuration previews do not write, recognize an existing binding, reject outside paths, and reject duplicate folder IDs.
  - Verifies confirmation tokens are single-use, expire after five minutes, and are required before a write plan can be obtained.
  - Verifies confirmed writes recheck folder ID/path conflicts and preserve the Syncthing default folder template.

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

## Syncthing Manual Tests

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

- Android opens the mobile entry and imports/uses a Syncthing-Fork synchronized folder workflow.
- iOS opens the PWA/mobile entry and uses Möbius Sync or import/export workflow.
- Mobile UI does not depend on desktop-only Tauri commands.
