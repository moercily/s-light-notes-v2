# s-light notes v2 Development Plan

## Current v2 Baseline

v2 is maintained as an independent repository. Its root contains the package metadata, tests, documentation, Tauri backend, and the frontend under `app/`. v1 remains a separate Web/PWA repository and is not required to build or test v2.

- `package.json` introduces a v2 alpha project entry and test command.
- `js/sync-service.js` exposes the v2 frontend sync interface.
- `js/sync-center.js` provides the sync center view model and separates local save status from P2P sync status.
- `js/desktop-service.js` provides the frontend bridge for Tauri app paths and default notes folder actions.
- The Tauri desktop build now uses a dedicated `desktop` storage mode to read and write Markdown files in the default notes folder without a browser permission prompt.
- `src-tauri/` contains the Tauri v2 desktop shell scaffold and backend command skeleton.
- The v2 Web/PWA compatibility entry is maintained under `app/` without importing files from the v1 repository.
- The desktop sync dialog has started moving toward a v2 sync center with status cards and a desktop engine start action.
- The sync center can now read, create, and open the v2 default notes folder in the Tauri desktop build.
- Desktop note listing, reading, saving, trash, restore, and permanent deletion are implemented with path validation and symlink checks.

## Phase V2.1: Desktop Shell Alpha

- [x] Install Rust, Cargo, npm, and Tauri CLI dependencies.
- [x] Run frontend tests and Rust tests.
- [x] Build a macOS `.app` bundle from `v2/`.
- [x] Enable the Tauri global API required by the zero-bundler HTML frontend.
- [x] Create and automatically use the v2 default notes folder in the desktop build.
- [x] Complete the desktop Markdown create/read/update/trash/restore loop.
- [ ] Complete macOS real-app smoke testing for save, close, reopen, and external file visibility.
- [ ] Validate and package Windows and Linux builds on their native systems.

The alpha config builds the macOS `.app` target only. DMG packaging remains deferred until the desktop storage and Syncthing connection flows are stable.

## Phase V2.2: Sync Center UI

- [x] Replace the old sync settings dialog with a sync center view.
- [x] Use `window.syncService` for all new desktop sync UI calls.
- [x] Keep existing `js/sync.js` functions as Web/PWA fallback.
- [x] Show local editing status separately from P2P sync status.
- [x] Read the local device ID, folders, devices, connections, selected folder status, and completion data through the credential-aware desktop proxy.
- [x] Route desktop refresh, manual scan, configuration-assist reads, and Syncthing Web UI opening through Tauri commands.

## Phase V2.3: Syncthing Runtime Management

- Detect existing Syncthing first.
- Start Syncthing only after user action.
- Add sidecar bundling after the external binary path works.
- Store credentials outside the notes folder.

Current status: health detection and user-triggered process start are implemented. API Keys are passed only with individual localhost proxy requests and are never written by the Rust backend. The current development machine has no `syncthing` executable on `PATH`, so external-binary start and live authenticated validation remain pending.

## Phase V2.4: Safe Configuration

- [x] Generate a configuration preview restricted to the verified v2 default notes path.
- [x] Detect when the selected Syncthing folder already manages the default notes path.
- [x] Show folder ID, folder path, devices, and restart impact before writing.
- [x] Reject duplicate folder IDs and paths outside the v2 notes directory.
- [x] Convert `syncthing_apply_folder_config` from preview-only to a separate confirmed-write step.
- [x] Issue a five-minute, single-use confirmation token without storing the API Key.
- [x] Re-read folder configuration immediately before writing and reject new ID/path conflicts.
- [x] Verify the new folder after writing and attempt rollback if verification fails.
- Never mutate Syncthing configuration without a second confirmation.

## Next Development Step

- Validate the confirmed-write flow against a disposable folder on a running Syncthing instance.
- Validate the credential-aware proxy against a running Syncthing instance.
- Decide and document the supported external binary locations before adding a bundled sidecar.

## Phase V2.5: Real-Device Validation

- Test two desktop devices on the same LAN.
- Test one desktop plus Android with Syncthing-Fork.
- Test iOS file workflow with Möbius Sync or import/export.
- Capture conflict behavior and update the sync center copy.

## Commit Strategy

- Commit docs and scaffold separately from runtime behavior changes.
- Keep v2 Web/PWA compatibility fixes separate from Tauri-specific work.
- Do not merge v2 changes into a release branch until desktop launch and v1 Web/PWA smoke tests pass.
