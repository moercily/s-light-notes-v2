/* Local editor preferences shared by main, sticky and mobile windows. */
(function () {
    const key = 's-light-editor-appearance';
    const options = {
        font: { title: '正文字体', values: [['sans', '系统字体'], ['serif', '衬线字体'], ['mono', '等宽字体']] },
        size: { title: '正文字号', values: [['14', '14'], ['16', '16（默认）'], ['18', '18'], ['20', '20'], ['24', '24']] },
        spacing: { title: '正文行距', values: [['1.5', '紧凑'], ['1.8', '标准'], ['2.2', '宽松']] },
    };
    const defaults = { font: 'sans', size: '16', spacing: '1.8' };
    function read() {
        let saved;
        try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { saved = {}; }
        return Object.fromEntries(Object.entries(options).map(([id, option]) => [id,
            option.values.some(([value]) => value === saved?.[id]) ? saved[id] : defaults[id]]));
    }
    function apply() {
        const value = read();
        const style = document.documentElement.style;
        style.setProperty('--editor-font', { sans: 'var(--font-sans)', serif: 'Georgia, "Songti SC", serif', mono: 'var(--font-mono)' }[value.font]);
        style.setProperty('--editor-size', value.size + 'px');
        style.setProperty('--editor-spacing', value.spacing);
    }
    function mount(group) {
        const controls = [];
        for (const [id, option] of Object.entries(options)) {
            const row = document.createElement('label'); row.className = 'editor-preference';
            const text = document.createElement('span'); text.textContent = option.title;
            const select = document.createElement('select'); select.setAttribute('aria-label', option.title);
            for (const [value, title] of option.values) {
                const node = document.createElement('option'); node.value = value; node.textContent = title; select.append(node);
            }
            select.value = read()[id];
            select.onchange = () => {
                try {
                    localStorage.setItem(key, JSON.stringify({ ...read(), [id]: select.value }));
                    apply(); status.textContent = '已保存';
                } catch (_) { select.value = read()[id]; status.textContent = '保存失败，请检查本地存储空间。'; }
            };
            row.append(text, select); group.append(row); controls.push([id, select]);
        }
        const status = document.createElement('p'); status.setAttribute('role', 'status'); group.append(status);
        return { enter() { const value = read(); controls.forEach(([id, select]) => { select.value = value[id]; }); } };
    }
    window.Appearance = { read, apply, mount };
    window.addEventListener('storage', event => { if (!event.key || event.key === key) apply(); });
    apply();
})();
