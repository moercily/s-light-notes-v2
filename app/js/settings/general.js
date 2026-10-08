Settings.register({ id: 'general', title: '通用' });
Settings.addItem('general', {
    id: 'settings-autostart', type: 'switch', group: 'startup', groupTitle: '启动',
    title: '开机自启', description: '登录电脑后自动打开 s-light notes。',
    available: SettingsService.desktop, unsupported: '此选项仅支持桌面应用。',
    read: SettingsService.autostart, write: SettingsService.setAutostart,
});
