const test = require('node:test');
const assert = require('node:assert/strict');
const titles = require('../data/foreign-template-titles.json');

const OURS = ['Портрет в неоне', 'Обложка для поста', 'Короткий сценарий', 'Промпт для видео', 'Озвучка текста'];

test('список чужих шаблонов содержит только названия', () => {
    assert.equal(Array.isArray(titles), true);
    assert.equal(titles.length, 112);
    const seen = new Set();
    titles.forEach(title => {
        assert.equal(typeof title, 'string');
        assert.ok(title.trim().length > 0);
        assert.ok(title.length < 180);
        assert.equal(title.includes('\n'), false);
        assert.equal(/промпт|создай |\{пол\}/i.test(title), false);
        seen.add(title.toLowerCase());
    });
    assert.equal(seen.size, titles.length);
    OURS.forEach(title => assert.equal(titles.includes(title), false));
});
