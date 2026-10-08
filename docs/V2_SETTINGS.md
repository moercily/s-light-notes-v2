# Settings and Version 0.0.1

## User behavior

The desktop main window exposes **设置** instead of separate sync-center and
shortcut-settings buttons. Its sidebar switches between **通用**, **便签设置**,
**同步设置**, and **关于**. Note actions remain in the main window.

- General provides login startup, default off. The native autostart manager
  reads the system entry, enables/disables it, and verifies the resulting state.
  A single-instance plugin prevents login startup and manual launches creating
  separate editors/engines. Web/PWA shows the option as unsupported.
- Sticky settings use a keyboard recorder, not a textual shortcut syntax field.
  Click, press a modifier + main key, then Esc to save. Esc with no recorded
  combination clears the shortcut. Leaving without Esc cancels. Failed
  registration preserves the old value. New installations have no binding;
  older settings keep their binding.
- While recording, the old global binding is suspended. A backend token makes
  restore/commit specific to that attempt. Closing main, app quit, cancellation,
  or a two-minute recording expiry restores the old binding; application restart
  reads the persisted setting. Errors are visible rather than reporting success.
- Sync settings contain the previous sync-center controls and confirmation
  flows. Entering starts bounded event polling; leaving stops that polling
  without stopping the actual engine. Draft input remains mounted across tabs.
- About uses the existing icon and shows the name and version `0.0.1`.
  Esc outside recording closes settings. A pending sync confirmation receives
  Esc first; keyboard focus stays inside the settings interface.

These category changes target the desktop/Web main entry. Android retains its
separate native mobile settings/sync screens; desktop startup and floating-note
shortcut plugins are excluded from Android. Its application version is updated.

## Extending categories and features

`app/js/settings/core.js` provides a registry and serialized lifecycle transitions.
Each category supplies `id`, `title`, optional `init`, `enter`, `leave`, and `items`.
Each item supplies a unique ID, optional group/groupTitle, and either a registered
control `type` or a custom `mount`. A mounted item may return `enter`/`leave`
callbacks. `SettingsService` keeps native operations separate from rendering.

Add a script before `app.js`, then register a category without editing core:

```js
Settings.register({ id: 'appearance', title: '外观' });
Settings.addItem('appearance', {
    id: 'appearance-example', type: 'switch',
    group: 'display', groupTitle: '显示', title: '示例选项',
    read: async () => mySettings.read(),
    write: async enabled => mySettings.write(enabled),
});
```

Add an item to an existing category with `Settings.addItem('general', item)`.
Add a reusable input/control with `Settings.registerControl(type, factory)`.
Registrations may occur after initialization. Controls mount once; entering or
leaving a tab never repeats event binding. Add new scripts/assets to the service
worker cache for Web/PWA offline use.

`sync-actions.js` holds the existing sync controller extracted from `app.js`.
`sync.js` adapts its content and enter/leave hooks to the category registry.
General, sticky, and about have their own modules, so new settings do not need
to be inserted into a central conditional chain.

Native settings commands are granted only to `main`. Sticky windows cannot
change login startup or shortcut settings. Desktop-only dependencies are pinned
to versions compatible with the existing Tauri lock; Android shared sync ACL
coverage remains tested.

## Version maintenance

`package.json` is the release-version source. Tauri reads it through
`version: "../package.json"`. The npm version hook updates the Rust package,
its lock entry, and the generated frontend `app-info.js`; tests reject drift.

Use `npm version 0.0.2 --no-git-tag-version` for the next adjustment/fix/optimization.
The version components mean:

1. Major feature update.
2. Minor feature update.
3. Functional adjustment, bug fix, or software optimization.

Increasing a component resets the components to its right. Product/repository
generation names such as “v2” do not change this three-part application version.

Android `versionCode` is explicitly `2000001` to remain upgradeable from the
earlier `2000000` package despite the version-name reset. Increment this code
for subsequent distributed Android builds; do not derive it from the newly
reset semantic version. Keep the existing application ID and signing identity.

## Verification

The settings suite tests captured keys, Esc commit/clear, failed registration,
cancellation during asynchronous suspension, adding a category/item after init,
serialized tab lifecycle, and consistent frontend/Rust/Tauri version sources.
The packaged macOS UI confirms capture and native state round trips. Autostart
verification checked the real LaunchAgent's executable and `RunAtLoad`, then
removed it through the switch to restore the original disabled state.

The arm64 debug APK builds with version name `0.0.1` and install code `2000001`.
No reboot/login, Windows/Linux native runtime, or Android phone acceptance was
performed in this checkpoint. Existing physical-key cross-application shortcut
verification remains pending; app-targeted recorder testing does not prove it.
