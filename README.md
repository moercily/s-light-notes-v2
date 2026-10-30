# s-light notes v2

s-light notes v2 is a standalone, local-first Markdown notes application with Syncthing-powered P2P synchronization. Notes remain ordinary `.md` files. Tauri packages the desktop application and the Android client.

v2 is maintained independently from the v1 Web/PWA repository. It does not require v1 source files to build or test.

## Project Layout

- `app/`: HTML, CSS, JavaScript, PWA assets, and the desktop webview frontend.
- `src-tauri/`: Rust backend, desktop packaging, and the generated Android project.
- `tests/`: frontend and service boundary tests.
- `docs/`: product requirements, architecture, development plan, and test plan.

## Development

Requirements: Node.js, npm, Rust, and Cargo.

```bash
npm install
npm test
npm run tauri:dev
```

Build the desktop application with:

```bash
npm run tauri:build
```

On macOS, the alpha application bundle is generated under `src-tauri/target/release/bundle/macos/`.

Create a local Android release identity once, then build signed split APKs and
app bundles with:

```bash
npm run android:signing:setup
npm run tauri:android:build:release
npm run android:release:collect
```

The signing key and its properties are local, ignored files. Back up
`src-tauri/gen/android/signing/` and
`src-tauri/gen/android/keystore.properties` securely before distributing a
release. Losing them prevents future signed upgrades.

## Current Alpha Boundary

- Desktop Markdown create, edit, save, trash, restore, and permanent deletion are implemented.
- Current development version is `0.1.1` (published release remains `0.0.1`): major features, minor features, then
  functional adjustments/bug fixes/optimization.
- Desktop settings use **通用 / 便签设置 / 同步设置 / 关于**. General includes
  optional login startup; sticky settings record a key combination followed by
  Esc to save, or Esc alone to clear. New installations have no shortcut;
  existing bindings are preserved. See [settings](docs/V2_SETTINGS.md).
- Desktop sticky windows support new notes and reopening existing notes, autosave,
  and a pin button immediately left of close. See [sticky notes](docs/V2_STICKY_NOTES.md).
- Desktop packages manage pinned Syncthing v2.1.2 sidecars for macOS
  Apple Silicon/Intel, Windows x64, and Linux x64.
- The Android API 36 client stores real Markdown, exposes notes through the
  system document picker, scans device QR codes, and runs its own pinned
  Syncthing engine for arm64-v8a and x86_64.
- Android-to-desktop pairing, bidirectional transfer, offline recovery,
  conflicts, permissions, lifecycle, naturally scheduled background exchange,
  and arm64 physical-device behavior have passed functional acceptance.
- Android background synchronization is intentionally bounded. Release
  store submission, controlled long-duration power characterization, and some
  native desktop package checks remain release gates.

## Reliability and portability

The development build preserves untouched Markdown blocks, guards desktop and
Android stale saves, and retains edits when saving fails. Desktop import creates
copies instead of overwriting existing notes. Export creates a new Markdown
folder with a SHA-256 manifest; it excludes trash, application settings, and sync
credentials. Font, size and line spacing are available in General settings and
mobile settings, and apply to sticky windows too.

Switching to trash waits for pending edits to save; failures keep the editor
content intact. Trash and restore preserve same-named files as numbered copies.
During application quit, editors and editing actions stay frozen until all
windows finish saving or the quit is cancelled.

For routine changes, run `npm run test:container` in the isolated headless
Docker/QEMU environment; see [setup and focused checks](docs/HEADLESS_TESTING.md).
Ask before using Parallels or a physical Mac for acceptance testing.
The native CI runs `npm run test:p2p` for actual two-engine loopback transfer,
offline recovery, conflict, identity and shutdown tests. This does not replace two-machine packaged
UI acceptance. The native desktop CI matrix builds macOS arm64/Intel, Windows x64
and Linux x64 installers with checksums. See the [release checklist](docs/V2_RELEASE_CHECKLIST.md)
and [current plan](docs/V2_DEVELOPMENT_PLAN.md) for remaining release gates.

Automatic updates are outside the development scope. Use manually downloaded installers after backing up data. Release preparation materials are in [the 0.1.1 package](docs/RELEASE_MATERIALS_0.1.1.md); its privacy statement remains a draft until publisher and channel details are confirmed.
