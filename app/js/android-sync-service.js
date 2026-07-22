/* Android-only synchronization bridge. Credentials, ports, and paths stay native. */
(function () {
    function getInvoke() {
        return window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    }

    async function invoke(command, payload) {
        const nativeInvoke = getInvoke();
        if (typeof nativeInvoke !== 'function') {
            throw new Error('Android 本机同步服务不可用。');
        }
        return nativeInvoke(command, payload || {});
    }

    window.androidSync = {
        isAvailable() {
            return typeof getInvoke() === 'function';
        },
        getStatus() {
            return invoke('syncthing_status');
        },
        startEngine() {
            return invoke('syncthing_start');
        },
        stopEngine() {
            return invoke('syncthing_stop');
        },
        getPairingInfo() {
            return invoke('syncthing_pairing_info');
        },
        previewDevicePairing(deviceId, deviceName) {
            return invoke('syncthing_preview_device_pairing', {
                request: { deviceId, deviceName },
            });
        },
        confirmDevicePairing(confirmationToken) {
            return invoke('syncthing_confirm_device_pairing', {
                request: { confirmationToken },
            });
        },
        scanFolder() {
            return invoke('syncthing_scan_folder');
        },
        scanDeviceQr() {
            return invoke('android_scan_device_qr');
        },
        getBackgroundPolicy() {
            return invoke('android_get_background_policy');
        },
        setBackgroundPolicy(policy) {
            return invoke('android_set_background_policy', {
                request: {
                    opportunisticSync: Boolean(policy.opportunisticSync),
                    unmeteredOnly: Boolean(policy.unmeteredOnly),
                    backgroundSessionEnabled: Boolean(policy.backgroundSessionEnabled),
                },
            });
        },
        requestNotificationPermission() {
            return invoke('android_request_notification_permission');
        },
        requestLocalNetworkPermission() {
            return invoke('android_request_local_network_permission');
        },
        openBatterySettings() {
            return invoke('android_open_battery_settings');
        },
    };
})();
