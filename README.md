# s-light notes v2

s-light notes v2 is a standalone, local-first Markdown notes application with Syncthing-powered P2P synchronization. Notes remain ordinary `.md` files, and the desktop application is packaged with Tauri.

v2 is maintained independently from the v1 Web/PWA repository. It does not require v1 source files to build or test.

## Project Layout

- `app/`: HTML, CSS, JavaScript, PWA assets, and the desktop webview frontend.
- `src-tauri/`: Rust backend and Tauri desktop packaging.
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

## Current Alpha Boundary

- Desktop Markdown create, edit, save, trash, restore, and permanent deletion are implemented.
- Syncthing status, device, folder, scan, and completion reads use the local Tauri bridge.
- Creating the default Syncthing folder requires a preview and a separate, short-lived confirmation.
- Syncthing binary bundling and multi-device release validation are still in progress.
