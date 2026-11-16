const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

test('подпись запуска ВК включает пустые и нулевые поля', () => {
    process.env.VK_APP_SECRET = 'protected-key';
    const auth = require('./auth');
    const fields = {
        vk_access_token_settings: '',
        vk_app_id: '54895627',
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
    const dropped = Object.assign({ sign }, fields);
    delete dropped.vk_access_token_settings;
    assert.equal(auth.verifyVkLaunch(dropped), null);
});
