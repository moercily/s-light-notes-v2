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
- Desktop packages manage pinned Syncthing v2.1.2 sidecars for macOS
  Apple Silicon/Intel, Windows x64, and Linux x64.
- The Android API 36 client stores real Markdown, exposes notes through the
  system document picker, scans device QR codes, and runs its own pinned
  Syncthing engine for arm64-v8a and x86_64.
- Android-to-desktop pairing, bidirectional transfer, offline recovery,
  conflicts, permissions, lifecycle, and arm64 physical-device behavior have
  passed functional acceptance.
- Android background synchronization is intentionally bounded. Release
  store submission, long-duration power validation, and some native desktop
  package checks remain release gates.
