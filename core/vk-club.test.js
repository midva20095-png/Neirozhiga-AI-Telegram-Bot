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

test('в комментарии ответ только на вопрос, без благодарностей и без догадок', () => {
    assert.equal(club.commentAnswer('спасибо'), null);
    assert.equal(club.commentAnswer('спасибо за урок!'), null);
    assert.equal(club.commentAnswer('классный урок'), null);
    assert.equal(club.commentAnswer('урок?').kind, 'answer');
    assert.equal(club.commentAnswer('???'), null);
    const cover = club.commentAnswer('как сделать обложку?');
    assert.equal(cover.kind, 'answer');
    assert.match(cover.text, /Обложк/);
    assert.match(cover.text, /https:\/\/vk\.com\/@neuroyaga-/);
    const price = club.commentAnswer('сколько стоит подписка');
    assert.equal(price.kind, 'answer');
    assert.match(price.text, /50 ₽/);
    assert.match(price.text, /https:\/\/vk\.com\/donut\/club214554778/);
    const unknown = club.commentAnswer('как дела?');
    assert.equal(unknown.kind, 'ask');
    assert.match(unknown.text, /https:\/\/vk\.me\/neuroyaga/);
    assert.doesNotMatch(unknown.text, /Фудфото|ничего не нашла/);
    assert.equal(club.looksLikeLesson('Новый урок по обложке'), true);
    assert.equal(club.looksLikeLesson('Доброе утро, друзья'), false);
    const note = club.lessonNote();
    assert.match(note, /Навигация по урокам/);
    assert.match(note, /vk\.me\/neuroyaga/);
    assert.doesNotMatch(`${cover.text}\n${price.text}\n${unknown.text}\n${note}`, /vk1\.a\.|00368ab5|access_token/);
});

test('запись со стены добавляется к ответу клуба', () => {
    const text = club.reply('клип дракон', [{ title: 'Урок по клипу', url: 'https://vk.com/wall-214554778_1' }]);
    assert.match(text, /Полёт на драконе/);
    assert.match(text, /На стене сообщества/);
    assert.match(text, /wall-214554778_1/);
});
