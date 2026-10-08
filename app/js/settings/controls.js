(function () {
    Settings.registerControl('switch', (group, item) => {
        const row = document.createElement('label'); row.className = 'settings-switch';
        const text = document.createElement('span');
        const title = document.createElement('strong'); title.textContent = item.title;
        const description = document.createElement('small'); description.textContent = item.description || '';
        text.append(title, description);
        const input = document.createElement('input'); input.type = 'checkbox'; input.id = item.id;
        input.setAttribute('role', 'switch');
        const status = document.createElement('p'); status.className = 'settings-status'; status.setAttribute('role', 'status');
        row.append(text, input); group.append(row, status);
        let value = false;
        async function enter() {
            input.disabled = true;
            try {
                if (item.available && !item.available()) { status.textContent = item.unsupported; return; }
                value = await item.read(); input.checked = value; status.textContent = '';
                input.disabled = false;
            } catch (error) { status.textContent = String(error); }
        }
        input.onchange = async () => {
            input.disabled = true;
            try { value = await item.write(input.checked); input.checked = value; status.textContent = value ? '已开启' : '已关闭'; }
            catch (error) { input.checked = value; status.textContent = String(error); }
            finally { input.disabled = false; }
        };
        return { enter };
    });
})();
