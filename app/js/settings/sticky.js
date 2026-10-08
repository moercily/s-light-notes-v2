Settings.register({ id: 'sticky', title: '便签设置' });
Settings.addItem('sticky', { id: 'sticky-shortcut', group: 'shortcuts', groupTitle: '快捷键', mount(group) {
    const label = document.createElement('strong'); label.textContent = '新建便签';
    const button = document.createElement('button'); button.type = 'button'; button.id = 'settings-sticky-shortcut'; button.className = 'settings-shortcut';
    const hint = document.createElement('p'); hint.className = 'settings-hint'; hint.textContent = '点击录制，按下组合键后按 Esc 保存。只按 Esc 则清除快捷键。';
    const status = document.createElement('p'); status.className = 'settings-status'; status.setAttribute('role', 'status');
    group.append(label, button, hint, status);
    const recorder = ShortcutRecorder.create({ service: SettingsService, notify(state) {
        button.dataset.recording = String(state.recording);
        button.disabled = state.busy;
        button.textContent = state.recording ? (state.value ? ShortcutRecorder.display(state.value) : '等待按键…') : ShortcutRecorder.display(state.value);
        if (state.message) status.textContent = state.message;
        if (state.recording && !state.busy) button.focus();
        if (!state.recording) updateStickyShortcutHint(state.value);
    } });
    button.onclick = () => recorder.begin().catch(error => { status.textContent = String(error); });
    document.addEventListener('keydown', event => { recorder.key(event).catch(error => { status.textContent = String(error); }); }, true);
    button.addEventListener('blur', () => { if (!button.disabled) recorder.cancel().catch(error => { status.textContent = String(error); }); });
    let unlisten = null;
    return {
        async enter() {
            button.disabled = true;
            if (!SettingsService.desktop()) { button.textContent = '仅支持桌面应用'; status.textContent = '此平台不能使用桌面全局快捷键。'; return; }
            try {
                const value = await SettingsService.sticky(); recorder.load(value.shortcut); status.textContent = value.error || '';
                if (!unlisten) unlisten = await window.__TAURI__.event.listen('sticky-recording-cancelled', () => recorder.expired());
                button.disabled = false;
            } catch (error) { status.textContent = String(error); }
        },
        async leave() {
            try { await recorder.cancel(); status.textContent = ''; }
            catch (error) { DesktopEditing.report(error); }
        },
    };
} });
