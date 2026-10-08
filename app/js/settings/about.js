Settings.register({ id: 'about', title: '关于' });
Settings.addItem('about', { id: 'app-identity', mount(group) {
    const identity = document.createElement('div'); identity.className = 'settings-about';
    const icon = document.createElement('img'); icon.src = AppInfo.icon; icon.alt = AppInfo.name + ' 图标';
    const name = document.createElement('h3'); name.textContent = AppInfo.name;
    const version = document.createElement('p'); version.textContent = '版本 ' + AppInfo.version; version.id = 'settings-app-version';
    identity.append(icon, name, version); group.append(identity);
} });
