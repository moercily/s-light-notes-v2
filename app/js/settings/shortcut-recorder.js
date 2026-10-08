(function () {
    const modifierKeys = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph']);
    function combination(event) {
        if (event.repeat || event.isComposing || modifierKeys.has(event.key) || event.key === 'Escape') return null;
        if (!(event.ctrlKey || event.metaKey || event.altKey)) throw new Error('请同时按下 Ctrl、Command 或 Alt 和一个主键。');
        if (!event.code || !/^[A-Za-z][A-Za-z0-9]*$/.test(event.code)) throw new Error('无法识别此按键，请换一个组合。');
        return [event.ctrlKey && 'Control', event.metaKey && 'Super', event.altKey && 'Alt', event.shiftKey && 'Shift', event.code].filter(Boolean).join('+');
    }
    function display(value) {
        const superName = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? 'Command' : 'Win';
        return value ? value.replace(/Super/g, superName).replace(/Control/g, 'Ctrl').replace(/Key(?=[A-Z])/g, '').replace(/Digit(?=\d)/g, '') : '无快捷键';
    }
    function create({ service, notify = () => {} }) {
        let token = null, draft = '', current = '', busy = false, recording = false;
        let pending = Promise.resolve();
        function emit(message = '') { notify({ recording, busy, value: recording ? draft : current, message }); }
        async function begin() {
            if (busy || recording) return;
            busy = true; emit('正在准备录制…');
            try { pending = service.beginRecording(); token = await pending; draft = ''; recording = true; emit('按下组合，再按 Esc 保存；直接按 Esc 清除。'); }
            finally { busy = false; emit(); }
        }
        async function cancel() {
            if (busy) await pending.catch(() => {});
            if (token === null) return;
            try { await service.endRecording(token); }
            finally { token = null; recording = false; draft = ''; emit(); }
        }
        async function key(event) {
            if (!recording || busy) return false;
            event.preventDefault(); event.stopImmediatePropagation();
            if (event.key !== 'Escape') {
                try { const value = combination(event); if (value) { draft = value; emit('按 Esc 保存。'); } }
                catch (error) { emit(String(error)); }
                return true;
            }
            busy = true; emit('保存中…');
            try {
                pending = service.setShortcut(draft, token);
                const result = await pending;
                current = result.shortcut; token = null; recording = false; emit(current ? '快捷键已保存。' : '已清除快捷键。');
            } catch (error) {
                await cancel(); emit(String(error));
            } finally { busy = false; emit(); }
            return true;
        }
        return { begin, cancel, key, recording: () => recording || busy,
            load(value) { current = value; emit(); },
            expired() { token = null; recording = false; busy = false; emit('录制已结束，原快捷键保持不变。'); } };
    }
    window.ShortcutRecorder = { combination, display, create };
})();
