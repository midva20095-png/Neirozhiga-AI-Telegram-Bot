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

test('ссылка ВК открывает шаблон в сообществе НейроЯга', () => {
    assert.equal(share.vkTemplateLink('local:15'), 'https://vk.com/app54901511_-214554778?ref=tpl15');
    assert.equal(share.vkTemplateLink(15, '214554778'), 'https://vk.com/app54901511_-214554778?ref=tpl15');
    assert.equal(share.vkTemplateLink('abc'), '');
    assert.equal(share.vkTemplateId('#tpl=15'), '15');
    assert.equal(share.vkTemplateId('tpl=local:15'), '15');
    assert.equal(share.vkTemplateId('vk_ref=tpl15'), '15');
    assert.equal(share.vkTemplateId('https://vk.com/app54901511_-214554778?ref=tpl15'), '15');
    assert.equal(share.vkTemplateId('vk_user_id=7&vk_ref=tpl15&sign=abc'), '15');
    assert.equal(share.vkTemplateId('help'), '');
    const secret = 'секретный текст задания который нельзя публиковать';
    const text = share.vkTemplateText({ title: 'Обложка', desc: 'Для поста', cost: 20, prompt: secret }, share.vkTemplateLink(15));
    assert.match(text, /Обложка/);
    assert.match(text, /Для поста/);
    assert.match(text, /20 кр/);
    assert.match(text, /https:\/\/vk\.com\/app54901511_-214554778\?ref=tpl15/);
    assert.equal(text.includes('#'), false);
    assert.equal(text.includes(secret), false);
    const card = share.templateCard({ title: 'Обложка', desc: 'Для поста', prompt: secret }, 'https://bot.example/api/templates/15/cover.jpg', share.vkTemplateLink(15));
    assert.match(card, /og:image/);
    assert.match(card, /cover\.jpg/);
    assert.match(card, /ref=tpl15/);
    assert.equal(card.includes(secret), false);
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
