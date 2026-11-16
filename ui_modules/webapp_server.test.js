const test = require('node:test');
const assert = require('node:assert/strict');
const { vkPageOrigin, vkCorsHeaders, vkRequestToken } = require('./webapp_server');

test('кабинет на хостинге ВК может обращаться к серверу', () => {
    assert.equal(vkPageOrigin('https://vk.com'), true);
    assert.equal(vkPageOrigin('https://vk.ru'), true);
    assert.equal(vkPageOrigin('https://m.vk.ru'), true);
    assert.equal(vkPageOrigin('https://prod-app54895627-abc.pages.vk-apps.com'), true);
    assert.equal(vkPageOrigin('https://prod-app54895627-13f25f9efcb2.pages-ac.vk-apps.ru'), true);
    assert.equal(vkPageOrigin('https://static.userapi.com'), true);
    assert.equal(vkPageOrigin('https://evilvk.com'), false);
    assert.equal(vkPageOrigin('https://vk.com.evil.com'), false);
    assert.equal(vkPageOrigin('http://vk.com'), false);
    assert.equal(vkPageOrigin(''), false);
    assert.match(vkCorsHeaders, /X-User-Token/);
    assert.match(vkCorsHeaders, /X-Telegram-Init-Data/);
});

test('пополнение и перенос ВК видят токен из заголовка кабинета', () => {
    const header = vkRequestToken({
        headers: { 'x-user-token': 'header-token' },
        query: {},
        body: { group: '214554778' }
    });
    assert.equal(header, 'header-token');
    const body = vkRequestToken({
        headers: {},
        query: {},
        body: { tk: 'body-token', packageId: 'pack' }
    });
    assert.equal(body, 'body-token');
    const query = vkRequestToken({ headers: {}, query: { tk: 'query-token' }, body: {} });
    assert.equal(query, 'query-token');
});
