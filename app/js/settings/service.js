(function () {
    const desktop = () => !!window.desktopService?.isAvailable();
    const invoke = (command, args = {}) => window.__TAURI__.core.invoke(command, args);
    window.SettingsService = {
        desktop,
        autostart: () => invoke('settings_autostart'),
        setAutostart: enabled => invoke('settings_set_autostart', { enabled }),
        sticky: () => invoke('sticky_settings'),
        beginRecording: () => invoke('sticky_begin_recording'),
        endRecording: recordingToken => invoke('sticky_end_recording', { recordingToken }),
        setShortcut: (shortcut, recordingToken) => invoke('sticky_set_shortcut', { shortcut, recordingToken }),
    };
})();
