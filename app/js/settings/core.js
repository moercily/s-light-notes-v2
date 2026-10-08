/* Categories own their lifecycle; items are extensible controls within categories. */
(function () {
    const categories = new Map();
    const controls = new Map();
    let active = null;
    let initialized = false;
    let opened = false;
    let operation = Promise.resolve();
    let restoreFocus = null;
    const background = new Map();
    const enqueue = task => {
        operation = operation.catch(error => console.error(error)).then(task);
        return operation;
    };
    function register(category) {
        if (categories.has(category.id)) throw new Error('Duplicate settings category: ' + category.id);
        categories.set(category.id, { items: [], ...category });
        if (initialized) mountCategory(categories.get(category.id));
    }
    function addItem(categoryId, item) {
        const category = categories.get(categoryId);
        if (!category) throw new Error('Unknown settings category: ' + categoryId);
        if (category.items.some(existing => existing.id === item.id)) throw new Error('Duplicate settings item: ' + item.id);
        category.items.push(item);
        if (category.panel) mountItem(category, item);
    }
    function mountItem(category, item) {
        let group = [...category.panel.children].find(node => node.dataset.group === (item.group || 'default'));
        if (!group) {
            group = document.createElement('section');
            group.className = 'settings-group';
            group.dataset.group = item.group || 'default';
            if (item.groupTitle) {
                const title = document.createElement('h3'); title.textContent = item.groupTitle; group.append(title);
            }
            category.panel.append(group);
        }
        const factory = item.mount || controls.get(item.type);
        if (!factory) throw new Error('Unknown settings control: ' + item.type);
        item.instance = factory(group, item) || {};
    }
    function mountCategory(category) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = category.title; button.dataset.category = category.id;
        button.id = 'settings-tab-' + category.id;
        button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', 'false');
        button.setAttribute('aria-controls', 'settings-panel-' + category.id);
        button.onclick = () => select(category.id).then(() => button.focus());
        const panel = document.createElement('section'); panel.className = 'settings-panel'; panel.hidden = true;
        panel.id = 'settings-panel-' + category.id; panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', button.id); panel.tabIndex = 0;
        category.panel = panel; category.button = button;
        $('#settings-sidebar').append(button); $('#settings-content').append(panel);
        category.items.forEach(item => mountItem(category, item));
        category.init?.(panel);
    }
    async function leave(category) {
        if (!category) return;
        for (const item of category.items) await item.instance?.leave?.();
        await category.leave?.();
    }
    function select(id) {
        return enqueue(async () => {
            const next = categories.get(id);
            if (!next || !opened || active === next) return;
            await leave(active);
            if (active) { active.panel.hidden = true; active.button.setAttribute('aria-selected', 'false'); }
            active = next; active.panel.hidden = false; active.button.setAttribute('aria-selected', 'true');
            $('#settings-page-title').textContent = active.title;
            await active.enter?.();
            for (const item of active.items) await item.instance?.enter?.();
        });
    }
    function open(id = active?.id || 'general') {
        if (!initialized) init();
        if (!opened) {
            restoreFocus = document.activeElement; opened = true;
            for (const id of ['#sidebar', '#editor-area']) {
                const node = $(id);
                if (node) { background.set(node, node.inert); node.inert = true; }
            }
            $('#settings-dialog').classList.remove('hidden'); active = null;
        }
        return select(id).then(() => active?.button.focus());
    }
    function close() {
        return enqueue(async () => {
            if (!opened) return;
            await leave(active); opened = false;
            if (active) { active.panel.hidden = true; active.button.setAttribute('aria-selected', 'false'); }
            $('#settings-dialog').classList.add('hidden');
            background.forEach((inert, node) => { node.inert = inert; }); background.clear();
            restoreFocus?.focus();
        });
    }
    function init() {
        if (initialized) return;
        initialized = true;
        categories.forEach(mountCategory);
        $('#btn-settings').onclick = () => open();
        $('#settings-close').onclick = close;
        $('#settings-dialog').onclick = event => { if (event.target === $('#settings-dialog')) close(); };
        document.addEventListener('keydown', event => {
            if (!opened) return;
            const confirmation = $('#sync-binding-confirm-dialog');
            if (confirmation && !confirmation.classList.contains('hidden')) {
                if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeSyncBindingConfirmation(); }
                return;
            }
            // Settings keys must not change notes behind this page.
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
            else if (event.ctrlKey || event.metaKey) event.stopImmediatePropagation();
            if (event.key === 'Tab') {
                const focusable = [...$('#settings-dialog').querySelectorAll('button, input, select, textarea, [tabindex="0"]')]
                    .filter(node => !node.disabled && node.getClientRects().length);
                const first = focusable[0], last = focusable.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        }, true);
        $('#settings-sidebar').addEventListener('keydown', event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const list = [...categories.values()]; const index = list.indexOf(active);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
            select(list[next].id).then(() => list[next].button.focus());
        });
    }
    window.Settings = { register, addItem, registerControl: (type, factory) => controls.set(type, factory), init, open, close, select, isOpen: () => opened };
})();
