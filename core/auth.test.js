const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

test('подпись запуска ВК включает пустые и нулевые поля', () => {
    process.env.VK_APP_SECRET = 'protected-key';
    const auth = require('./auth');
    const fields = {
        vk_access_token_settings: '',
        vk_app_id: '54901511',
        vk_are_notifications_enabled: '0',
        vk_is_app_user: '1',
        vk_is_favorite: '0',
        vk_language: 'ru',
        vk_platform: 'desktop_web',
        vk_user_id: '82156740'
    };
    const pairs = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('&');
    const sign = crypto.createHmac('sha256', 'protected-key').update(pairs).digest('base64url');
    assert.equal(auth.verifyVkLaunch(Object.assign({ sign }, fields)), '-82156740');
    const raw = Object.keys(fields).sort().map(key => `${key}=${encodeURIComponent(fields[key])}`).join('&') + `&sign=${sign}`;
    assert.equal(auth.verifyVkLaunch(raw), '-82156740');
    assert.equal(auth.verifyVkLaunch({ launch: raw }), '-82156740');
    const dropped = Object.assign({ sign }, fields);
    delete dropped.vk_access_token_settings;
    assert.equal(auth.verifyVkLaunch(dropped), null);
    const other = Object.assign({}, fields, { vk_app_id: '54895627' });
    const otherPairs = Object.keys(other).sort().map(key => `${key}=${other[key]}`).join('&');
    const otherSign = crypto.createHmac('sha256', 'protected-key').update(otherPairs).digest('base64url');
    assert.equal(auth.verifyVkLaunch(Object.assign({ sign: otherSign }, other)), null);
});

test('ключ пользователя ВК принимается только от нового приложения', async () => {
    process.env.VK_APP_SECRET = 'protected-key';
    const auth = require('./auth');
    const ok = async (url) => {
        if (String(url).includes('oauth')) return { json: async () => ({ access_token: 'service-token', expires_in: 0 }) };
        const query = new URL(String(url)).searchParams;
        assert.equal(query.get('access_token'), 'service-token');
        assert.equal(query.get('token'), 'user-token-from-app');
        return { json: async () => ({ response: { success: 1, user_id: 462733829 } }) };
    };
    assert.equal(await auth.vkUserForAppToken('user-token-from-app', ok), '-462733829');
    const denied = async (url) => {
        if (String(url).includes('oauth')) return { json: async () => ({ access_token: 'service-token' }) };
        return { json: async () => ({ error: { error_code: 15, error_msg: 'Access denied' } }) };
    };
    assert.equal(await auth.vkUserForAppToken('foreign-token', denied), null);
    delete process.env.VK_APP_SECRET;
    assert.equal(await auth.vkUserForAppToken('user-token-from-app', ok), null);
    process.env.VK_APP_SECRET = 'protected-key';
});
