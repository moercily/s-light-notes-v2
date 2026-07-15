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

- [x] Detect an existing system Syncthing installation for development and compatibility.
- [x] Start an external Syncthing only after explicit user action.
- [x] Track managed process startup, health, early exit, and shutdown.
- [x] Bundle Syncthing as the default desktop sidecar so normal users install only s-light notes.
- [x] Store the sidecar identity, database, logs, and credentials outside the notes folder.

Current status: the macOS Apple Silicon package includes Syncthing v2.1.2 and starts it automatically. The Rust backend owns its isolated config/data/log/runtime directories, persistent random API Key, loopback GUI/API port, P2P ports, first-run notes-folder binding, device-code pairing, health checks, and shutdown. Pairing validates and normalizes the remote device ID, requires a second confirmation, adds one device, shares only the default notes folder, and verifies or rolls back the transaction. The local device code can also be rendered as an offline QR image without exposing credentials. Live packaged-app validation completed on 2026-07-15 while a separate system Syncthing instance was running. `SLIGHT_SYNCTHING_BIN` remains an explicit development override; QR scanning, events, Windows, Linux, and macOS Intel artifacts are still pending.

### V2.3 Sidecar Product Decision

- The bundled Syncthing sidecar is the primary desktop sync engine for release builds.
- A system-installed Syncthing remains an advanced/development fallback, not a normal-user prerequisite.
- The standard UI must not ask users to start Syncthing, enter an API address, enter an API Key, or open the Syncthing Web UI.
- The Rust backend owns sidecar startup, shutdown, credentials, configuration, health checks, and REST access.
- Syncthing automatic upgrades are disabled; the application version pins and updates the bundled engine.
- Existing system Syncthing data must not be reused or overwritten by the bundled engine.

### V2.3 Sidecar Implementation Checklist

- [x] Pin one Syncthing version and record its source, checksum, license notices, and supported configuration schema.
- [x] Add the Apple Silicon target-triple binary under `src-tauri/binaries/` and configure Tauri `bundle.externalBin`.
- [ ] Add macOS Intel, Windows x64, and Linux x64 packages. The macOS Apple Silicon proof is complete.
- [x] Create an application-owned Syncthing home under the Tauri app-data directory.
- [x] Generate a random API Key in Rust and keep it out of frontend state and the synchronized notes directory.
- [x] Bind the REST/GUI endpoint to loopback on an application-owned port and reject LAN exposure.
- [x] Launch the sidecar with no browser, no self-upgrade, bounded restart handling, and application-owned logs.
- [x] Prefer the bundled sidecar in release builds while retaining explicit external-binary override for development.
- [x] On first run, create and bind the default notes folder without exposing raw Syncthing configuration.
- [x] Replace API address and API Key fields with a normal device-pairing wizard.
- [x] Add device-code pairing, mutual confirmation, default-folder sharing, and understandable connection states.
- [x] Add an offline QR representation of the local device code.
- [ ] Add QR scanning where the platform permits it, with manual code entry retained as the fallback.
- [ ] Subscribe to Syncthing events for device, folder, scan, completion, conflict, and error updates.
- [ ] Decide whether closing the window stops sync or leaves a tray/background process, and expose that as a clear setting.
- [ ] Stop the sidecar cleanly before app updates and preserve its identity/configuration across upgrades.

### V2.3 Sidecar Acceptance Criteria

- A clean computer without Syncthing installed can install s-light notes and start the sync engine.
- The first normal sync setup does not require a terminal, browser, port, API address, API Key, or separate Syncthing application.
- The bundled engine uses an isolated identity/configuration directory and can coexist with a system Syncthing installation.
- The frontend never receives the sidecar API Key; it invokes only constrained Tauri commands.
- Sidecar crashes, port conflicts, unsupported binaries, and configuration migration failures produce actionable app messages.
- App updates preserve the device identity and notes folder binding while updating the pinned sidecar safely.

## Phase V2.4: Safe Configuration

- [x] Generate a configuration preview restricted to the verified v2 default notes path.
- [x] Detect when the selected Syncthing folder already manages the default notes path.
- [x] Show folder ID, folder path, devices, and restart impact before writing.
- [x] Reject duplicate folder IDs and paths outside the v2 notes directory.
- [x] Convert `syncthing_apply_folder_config` from preview-only to a separate confirmed-write step.
- [x] Issue a five-minute, single-use confirmation token without storing the API Key.
- [x] Re-read folder configuration immediately before writing and reject new ID/path conflicts.
- [x] Verify the new folder after writing and attempt rollback if verification fails.
- [x] Validate the authenticated create/readback/rollback request sequence against a temporary local protocol fixture.
- Never mutate a user-managed external Syncthing configuration without a second confirmation. The isolated app-owned sidecar may idempotently bootstrap its own ports and default notes folder.

## Next Development Step

- Add Syncthing event subscriptions for device, folder, scan, completion, conflict, and error updates.
- Add QR scanning only after camera permission and desktop/mobile packaging boundaries are defined.
- Validate executable discovery and startup on native Windows and Linux before packaging their sidecars.
- Add and checksum macOS Intel, Windows x64, and Linux x64 sidecar artifacts.

## Phase V2.5: Real-Device Validation

- Test two desktop devices on the same LAN.
- Test one desktop plus Android with Syncthing-Fork.
- Test iOS file workflow with Möbius Sync or import/export.
- Capture conflict behavior and update the sync center copy.

Mobile packaging does not reuse the desktop sidecar artifact directly. Android should wrap the Syncthing core in a platform foreground service and can target continuous background sync. iOS may embed an adapted Syncthing core, but its product promise is foreground and opportunistic background sync because continuous background execution cannot be guaranteed.

## Commit Strategy

- Commit docs and scaffold separately from runtime behavior changes.
- Keep v2 Web/PWA compatibility fixes separate from Tauri-specific work.
- Do not merge v2 changes into a release branch until desktop launch and v1 Web/PWA smoke tests pass.
