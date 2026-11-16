const test = require('node:test');
const assert = require('node:assert/strict');
const save = require('./save-work');

const vkPhone = '?vk_platform=mobile_iphone&vk_user_id=1&vk_app_id=54895627&sign=abc';
const vkDesktop = '?vk_platform=desktop_web&vk_user_id=1&vk_app_id=54895627&sign=abc';

test('в приложении ВК скачивание не уходит в метод Telegram', () => {
    const telegram = { version: '6.0', initData: '', downloadFile() { throw new Error('WebAppMethodUnsupported'); } };
    assert.equal(save.saveRoute({ webApp: telegram, search: vkPhone }), 'vk-app');
    assert.equal(save.saveRoute({ webApp: telegram, search: '?vk_platform=mobile_android&vk_user_id=1' }), 'vk-app');
    assert.equal(save.saveRoute({ webApp: telegram, search: '?vk_platform=mobile_ipad&vk_user_id=1' }), 'vk-app');
    assert.equal(save.saveRoute({ webApp: telegram, search: vkDesktop }), 'vk-web');
    assert.equal(save.saveRoute({ webApp: telegram, search: '' }), 'browser');
});

test('скачивание Telegram включается только в самом Telegram', () => {
    const ready = { version: '8.0', initData: 'query_id=1', downloadFile() {} };
    assert.equal(save.telegramCanDownload(ready), true);
    assert.equal(save.saveRoute({ webApp: ready, search: vkPhone }), 'telegram');
    assert.equal(save.telegramCanDownload({ version: '7.9', initData: 'query_id=1', downloadFile() {} }), false);
    assert.equal(save.telegramCanDownload({ version: '8.0', initData: '', downloadFile() {} }), false);
});

test('ответ ВК на скачивание читается и имя файла остаётся безопасным', () => {
    assert.deepEqual(save.bridgeDownload({ data: { type: 'VKWebAppDownloadFileResult', data: { result: true } } }), { ok: true });
    assert.deepEqual(save.bridgeDownload({ type: 'VKWebAppDownloadFileFailed', data: { error_type: 'client_error' } }), { ok: false });
    assert.equal(save.bridgeDownload({ data: { type: 'VKWebAppOpenLinkResult', data: {} } }), null);
    assert.equal(save.attachmentName('neuroyaga-12.png', 'jpg'), 'neuroyaga-12.jpg');
    assert.equal(save.attachmentName('../secret.png', 'png'), 'secret.png');
    assert.equal(save.attachmentName('', 'mp4'), 'neuroyaga.mp4');
});
