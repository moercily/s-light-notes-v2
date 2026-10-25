# Desktop Sticky Notes

## Using sticky windows

While the application runs, use the configured shortcut to create a sticky.
New installations default to no shortcut; existing shortcuts are preserved.
The main sidebar also has **＋ 便签**.
Use the arrow beside a saved note, or **在便签中打开** in the editor toolbar,
to open that note. **设置 → 便签设置** records the global shortcut and displays
invalid-combination or registration errors. Press a combination, then Esc to
save; Esc alone clears it. A shortcut requires Control,
Command/Super, or Alt; plain typing and Shift-only combinations are rejected.

Sticky windows start at 360×420 logical pixels and resize down to 280×240.
The header contains new, draggable title, pin, and close. Pin is immediately
left of close and changes the native always-on-top state. Placement, size,
and pin state for saved notes are stored locally in
`app_config_dir/sticky-settings.json`; they are not synchronized as Markdown.
Saved positions outside current monitor work areas fall back to the center.

Each saved note has one sticky window. Multiple different notes can stay open;
repeated new requests reuse a clean empty draft. Empty drafts create no file.
Existing notes can intentionally be saved empty. Trash notes and Syncthing
conflict files remain read-only, with **保留为新笔记** available.

The Markdown editor and 500 ms autosave are shared with the main application.
Close saves pending edits first. A failed save leaves the window open and
shows the error. **全部笔记** focuses or recreates the main window. Closing
main preserves remaining stickies and the app-managed sync engine. Closing
the final window or choosing application Quit stops the app and engine.
There is no tray behavior. Optional login startup is controlled separately in
**设置 → 通用** and is off by default; see [`V2_SETTINGS.md`](V2_SETTINGS.md).

## Editing and window boundaries

- `app/js/desktop-editing.js` owns the per-window save queue and close handshake.
  Save completions track the editing session so switching notes cannot rebind
  an earlier save result. New keystrokes during a pending save remain dirty.
- `desktop_save_note` requires the loaded content version when updating an
  existing note. Backend writes serialize and use a same-directory temporary
  file, flush, and rename. Stale or deleted sources reject overwrites.
- App save/trash/restore events refresh other windows. Focus and a two-second
  visible-window poll also detect changes from external editors/Syncthing.
  Clean editors reload; dirty editors retain their content and offer reload
  or save-copy. There is no automatic conflict merge.
- Close events target one window. Quit uses an attempt token and waits for
  every window; failed saves cancel quit and re-enable editing. Late
  acknowledgements from cancelled attempts cannot close a later attempt.
- `src-tauri/src/desktop/sticky.rs` owns native windows, shortcut registration,
  pin state, placement, and close acknowledgements. The shortcut dependency is
  desktop-only and pinned to the version compatible with the current Tauri lock.
- Main has the existing note/sync permissions plus sticky opening/settings.
  Stickies receive read/save, sticky actions, event listening, and dragging;
  they receive no sync configuration or credential commands. Android retains
  permissions for sync commands shared with the desktop command manifest.

## Validation checkpoint — 2026-10-08

Passed:

- All eight frontend/service suites, including queued edits, new-ID/version
  propagation, empty notes, stale saves, note switching during saves, and
  close waiting/veto behavior.
- All 34 Rust tests, including content version changes, stale/deleted sources,
  atomic save output/temporary cleanup, and shortcut alias/modifier validation.
- macOS Apple Silicon release `.app` packaging.
- Android arm64 compilation and debug APK packaging. Shared Android command
  authorization is covered by the frontend structure regression test.
- Packaged macOS UI: new and saved stickies, Markdown autosave and file
  readback, edit visibility in main, independent pin state, persisted pin on
  reopen, empty-draft reuse, main-close preserving sticky, recreating main,
  and quitting multiple open windows with no app/sidecar process left.
- Shortcut settings report successful registration of the default combination.

Not yet verified:

- Physical-key global shortcut activation from another foreground application.
  Automated app-targeted key injection did not activate it; the UI automation
  tool did not allow selecting Finder for a cross-application check. Registration
  and parser tests are evidence of setup, not proof of physical-key activation.
- Windows/Linux native sticky layout, shortcut activation, and pin/lifecycle.
- Android physical-device regression for this checkpoint: `adb devices` returned
  no connected device. This feature is desktop-only; APK build is not a runtime test.

The disposable sticky QA note is moved to the application's `.trash` after
verification and can be restored. Original notes are retained.

## 2026-10-25 reliability update

Sticky windows now apply the same font, size and spacing preferences as the main
editor. Close vetoes incomplete IME composition and failed saves. Markdown blocks
retain source text while untouched, and reload ignores stale asynchronous reads.
Physical cross-application keys, Windows/Linux runtime and real-login startup
acceptance remain outstanding. See the current test-plan checkpoint.
