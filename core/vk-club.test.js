const test = require('node:test');
const assert = require('node:assert/strict');
const club = require('./vk-club');

test('подписки клуба описывают уровни и ведут на донат', () => {
    const text = club.reply('какие подписки для донов');
    assert.match(text, /Фудфото/);
    assert.match(text, /50 ₽/);
    assert.match(text, /Бабка-таргетолог/);
    assert.match(text, /Базовая поддержка по ИИ/);
    assert.match(text, /https:\/\/vk\.com\/donut\/club214554778/);
    assert.doesNotMatch(text, /vk1\.a\.|00368ab5|access_token/);
});

test('запрос про обложку даёт урок и ссылку', () => {
    const text = club.reply('как сделать обложку нейросетью');
    assert.match(text, /Обложк/);
    assert.match(text, /https:\/\/vk\.com\/@neuroyaga-/);
    assert.doesNotMatch(text, /vk1\.a\.|00368ab5/);
});

test('запись со стены добавляется к ответу клуба', () => {
    const text = club.reply('клип дракон', [{ title: 'Урок по клипу', url: 'https://vk.com/wall-214554778_1' }]);
    assert.match(text, /Полёт на драконе/);
    assert.match(text, /На стене сообщества/);
    assert.match(text, /wall-214554778_1/);
});
