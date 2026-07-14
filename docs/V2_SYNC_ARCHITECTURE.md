# s-light notes v2 Sync Architecture

## Overview

v2 keeps Syncthing as the sync engine and adds a desktop backend that makes it feel native. The app manages local status, safe proxying, scan requests, and configuration previews while Syncthing handles P2P transfer.

## Components

- Frontend: existing HTML/CSS/JavaScript editor and note UI.
- `js/sync-service.js`: unified sync interface used by v2 frontend code.
- `js/desktop-service.js`: desktop-only bridge for default-folder Markdown operations.
- Tauri backend: native command layer for app paths, Syncthing process checks, local API proxying, and safe config previews.
- Syncthing: local process or existing system installation.

## Data Flow

```text
UI action
  -> syncService
  -> Tauri invoke when available
  -> Syncthing REST API on 127.0.0.1:8384
  -> status/proxy result
  -> UI sync center
```

In Web/PWA mode, `syncService` falls back to existing v1 helpers where possible. If no desktop backend exists, operations that require native privileges fail with a clear message.

## Tauri Commands

- `get_app_paths`: returns app data and default notes paths.
- `ensure_notes_folder`: creates the default notes folder.
- `syncthing_status`: checks local Syncthing health.
- `syncthing_start`: starts the discovered executable with `--no-browser`; an explicit `SLIGHT_SYNCTHING_BIN` takes priority.
- `syncthing_stop`: stops only a Syncthing process started by this app session.
- `syncthing_proxy_request`: proxies safe local REST requests to Syncthing.
- `syncthing_apply_folder_config`: returns a confirmation summary and a five-minute, single-use token without writing configuration.
- `syncthing_confirm_folder_config`: consumes the token, rechecks live folder conflicts, creates one new folder, and verifies the result.
- `open_notes_folder`: opens the notes folder in the system file manager.
- `open_syncthing_web`: opens the Syncthing Web UI.
- `desktop_list_notes`: lists Markdown files in the default notes folder or its `.trash` directory.
- `desktop_read_note`: reads one validated Markdown note.
- `desktop_save_note`: creates or updates one validated Markdown note.
- `desktop_move_to_trash`: moves a note into the local `.trash` directory.
- `desktop_restore_note`: restores a note from `.trash`.
- `desktop_delete_note`: permanently deletes a note from `.trash`.

## Desktop Storage Boundary

- The desktop editor selects `desktop` storage mode when the Tauri backend is available.
- Tauri injects `window.__TAURI__` for the existing zero-bundler HTML frontend; desktop calls remain limited to the registered command set.
- All desktop note operations resolve from the application default notes folder; the frontend cannot send an arbitrary file path.
- Note IDs containing path separators or platform-unsafe filename characters are rejected.
- Symlinked note files and symlinked managed directories are not followed.
- Web/PWA builds continue to use File System Access API or IndexedDB without calling desktop commands.

## Security Rules

- The backend only targets `http://127.0.0.1:8384` in the alpha implementation.
- External engine discovery checks `SLIGHT_SYNCTHING_BIN`, the process `PATH`, and common native install paths. An invalid explicit path fails without silently choosing another binary.
- Proxy paths must start with `/` and must not contain `://` or `..`.
- API keys must not be stored in the notes folder.
- API keys are validated against header injection and attached only to the current localhost request as `X-API-Key`; the Rust backend does not persist them.
- Desktop status refresh, scan, device/folder reads, and configuration-assist reads must use the Tauri proxy instead of browser `fetch`.
- Folder config writes require a user-visible confirmation step.
- Configuration previews accept only the canonical v2 default notes path, reject duplicate folder IDs, and never call a Syncthing write endpoint.
- Confirmation tokens are held only in application memory, expire after five minutes, and can be used once. API Keys are not stored with them.
- Confirmed writes re-read live Syncthing configuration and never replace an existing folder ID or an existing binding for the same path.
- After creating a folder, the backend reads it back. If verification fails, it attempts to remove only the newly created folder ID.
- The app must never expose the Syncthing proxy to LAN devices by default.

## v2 Alpha Limitations

- Syncthing binary bundling is not complete yet.
- API key discovery is not automated; users enter the key and may optionally remember it in local frontend storage.
- Confirmed folder writing is implemented but still requires live validation against a running Syncthing instance before release use.
- Mobile background sync depends on platform-specific Syncthing clients.
