Settings.register({
    id: 'sync', title: '同步设置',
    init: bindSyncSettingsEvents,
    items: [{ id: 'sync-center', mount(group) {
        const content = $('#sync-dialog');
        content.classList.remove('dialog-overlay', 'hidden');
        group.append(content);
        $('#sync-close').hidden = true;
    } }],
    enter: () => enterSyncSettings(),
    leave: () => leaveSyncSettings(),
});
