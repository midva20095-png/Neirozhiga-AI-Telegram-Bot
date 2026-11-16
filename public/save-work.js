(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.nySave = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function versionAtLeast(version, need) {
        const left = String(version || '0').split('.');
        const right = String(need || '0').split('.');
        const length = Math.max(left.length, right.length);
        for (let i = 0; i < length; i++) {
            const a = parseInt(left[i] || '0', 10) || 0;
            const b = parseInt(right[i] || '0', 10) || 0;
            if (a > b) return true;
            if (a < b) return false;
        }
        return true;
    }

    function telegramCanDownload(webApp) {
        if (!webApp || typeof webApp.downloadFile !== 'function') return false;
        if (!webApp.initData) return false;
        return versionAtLeast(webApp.version, '8.0');
    }

    function searchParams(search) {
        return new URLSearchParams(String(search || '').replace(/^\?/, ''));
    }

    function saveRoute(env) {
        const webApp = env && env.webApp;
        if (telegramCanDownload(webApp)) return 'telegram';
        const params = searchParams(env && env.search);
        const platform = params.get('vk_platform') || '';
        if (platform === 'mobile_android' || platform === 'mobile_iphone' || platform === 'mobile_ipad') return 'vk-app';
        if (params.get('vk_app_id') || params.get('vk_user_id') || platform) return 'vk-web';
        return 'browser';
    }

    function attachmentName(name, ext) {
        const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'mp3'].includes(ext) ? ext : 'bin';
        const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
        return (base || 'neuroyaga') + '.' + safeExt;
    }

    function bridgeDownload(message) {
        let data = message;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) { return null; }
        }
        if (!data || typeof data !== 'object') return null;
        const nested = data.data && typeof data.data === 'object' ? data.data : null;
        let type = nested && typeof nested.type === 'string' ? nested.type : '';
        let payload = nested && nested.data && typeof nested.data === 'object' ? nested.data : {};
        if (!type && typeof data.type === 'string' && data.type.indexOf('VKWebApp') === 0) {
            type = data.type;
            payload = data.data && typeof data.data === 'object' ? data.data : {};
        }
        if (type === 'VKWebAppDownloadFileResult') return { ok: payload.result !== false };
        if (type === 'VKWebAppDownloadFileFailed') return { ok: false };
        return null;
    }

    return { versionAtLeast, telegramCanDownload, saveRoute, attachmentName, bridgeDownload };
});
