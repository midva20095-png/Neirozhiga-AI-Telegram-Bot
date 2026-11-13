const test = require('node:test');
const assert = require('node:assert/strict');
const share = require('./share');

test('ссылка на шаблон ведёт в бота и не содержит текст задания', () => {
    assert.equal(share.templateLink('NeyroYaga_ai_bot', 'local:15'), 'https://t.me/NeyroYaga_ai_bot?start=tpl_15');
    assert.equal(share.templateLink('@NeyroYaga_ai_bot', 15), 'https://t.me/NeyroYaga_ai_bot?start=tpl_15');
    assert.equal(share.templateLink('bot', 'abc'), '');
    assert.equal(share.parseStart('tpl_15'), '15');
    assert.equal(share.parseStart('tpl_'), '');
    assert.equal(share.parseStart('start'), '');
});

test('пост в канал показывает название и не показывает задание', () => {
    const secret = 'секретный текст задания который нельзя публиковать';
    const caption = share.workCaption('Портрет в неоне');
    assert.match(caption, /Портрет в неоне/);
    assert.equal(caption.includes(secret), false);
    assert.equal(share.workCaption(''), 'Работа в НейроЯге');
    const card = share.templateCaption({ title: 'Обложка', desc: 'Для поста', cost: 20, prompt: secret });
    assert.match(card, /Обложка/);
    assert.match(card, /Для поста/);
    assert.match(card, /20 кр/);
    assert.equal(card.includes(secret), false);
});
