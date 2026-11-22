const test = require('node:test');
const assert = require('node:assert/strict');
const templates = require('./templates');
const catalog = require('./catalog');
const gen = require('./generate');

function row(model, extra) {
    return Object.assign({
        id: 7,
        title: 'Естественный lifestyle',
        prompt: 'секретный запрос шаблона',
        model,
        cost: 6,
        hide_prompt: false,
        active: true,
        category: 'image',
        formats: ''
    }, extra || {});
}

test('шаблон вызывает ровно выбранную модель', () => {
    assert.equal(templates.fromDb(row('nano-banana')).model, 'nano-banana');
    assert.equal(templates.fromDb(row('kie-banana-21')).model, 'kie-banana-21');
    assert.equal(templates.fromDb(row('kie-banana-lite')).model, 'kie-banana-lite');
    assert.equal(templates.fromDb(row('nanobanana')).model, 'nanobanana');
});

test('шаблон хранит дешёвый режим и не берёт чужой', () => {
    const cheap = templates.fromDb(row('nano-banana', { quality: 'cheap', cost: 3 }));
    assert.equal(cheap.quality, 'cheap');
    assert.equal(cheap.cost, 3);
    assert.equal(templates.fromDb(row('nano-banana', { quality: '4K' })).quality, '');
    const clip = templates.fromDb(row('kling-2-1-standard', { category: 'video', duration: 10 }));
    assert.equal(clip.duration, 10);
    assert.equal(templates.fromDb(row('kling-2-1-standard', { duration: 7 })).duration, null);
});

test('pro остаётся Чат Pro, а не картинкой', () => {
    const item = templates.fromDb(row('pro', { category: 'video', cost: 15 }));
    assert.equal(item.model, 'pro');
    assert.equal(item.photo, false);
});

test('поля таблицы видны в кабинете, текст запроса остаётся скрыт', () => {
    const item = templates.fromDb(row('nano-banana', { fields: 'фото | Лицо\nтекст | имя | Имя' }));
    assert.equal(item.fields.length, 2);
    assert.equal(item.fields[1].key, 'имя');
    assert.equal(item.photo, true);
    const pub = templates.toPublic(item);
    assert.equal(pub.fields[0].label, 'Лицо');
    assert.equal(Object.prototype.hasOwnProperty.call(pub, 'prompt'), false);
    const textOnly = templates.fromDb(row('nano-banana', { fields: 'текст | тема | Тема' }));
    assert.equal(textOnly.photo, false);
});

test('категории шаблона приходят в кабинет списком', () => {
    const item = templates.fromDb(row('nano-banana', { topics: 'Портреты, портреты; Семья' }));
    assert.deepEqual(item.cats, ['Портреты', 'Семья']);
    assert.deepEqual(templates.toPublic(item).cats, ['Портреты', 'Семья']);
    assert.equal(Object.prototype.hasOwnProperty.call(templates.toPublic(item), 'prompt'), false);
    assert.deepEqual(templates.fromDb(row('nano-banana')).cats, []);
    const many = templates.fromDb(row('nano-banana', { topics: 'Осень, Зима, Весна, Лето, Праздник' }));
    assert.deepEqual(many.cats, ['Осень', 'Зима', 'Весна', 'Лето', 'Праздник']);
});

test('ссылка канала крепится к шаблону и не забирает текст задания', () => {
    const item = templates.fromDb(row('nano-banana'));
    const pub = templates.attachChannelLink(templates.toPublic(item), 'NeyroYaga_ai_bot');
    assert.equal(pub.link, 'https://t.me/NeyroYaga_ai_bot?start=tpl_7');
    assert.equal(Object.prototype.hasOwnProperty.call(pub, 'prompt'), false);
    assert.equal(JSON.stringify(pub).includes('секретный запрос шаблона'), false);
    const hidden = templates.attachChannelLink(templates.toPublic(item), '');
    assert.equal(hidden.link, undefined);
});

test('шаблон ВК открывается во ВК, а не в Telegram', () => {
    const vk = templates.fromDb(row('nano-banana', { audience: 'vk' }));
    const only = templates.attachChannelLink(vk, 'NeyroYaga_ai_bot', 'tg');
    assert.equal(only.link, 'https://vk.com/app54901511_-214554778#t7');
    assert.equal(only.link.includes('t.me'), false);
    const both = templates.attachChannelLink(templates.fromDb(row('nano-banana', { audience: 'all' })), 'NeyroYaga_ai_bot', 'vk');
    assert.equal(both.link, 'https://vk.com/app54901511_-214554778#t7');
    const telegram = templates.attachChannelLink(templates.fromDb(row('nano-banana', { audience: 'tg' })), 'NeyroYaga_ai_bot', 'vk');
    assert.equal(telegram.link, 'https://t.me/NeyroYaga_ai_bot?start=tpl_7');
    const card = templates.attachChannelLink(templates.toPublic(vk), 'NeyroYaga_ai_bot', 'vk');
    assert.equal(card.link, 'https://vk.com/app54901511_-214554778#t7');
    assert.equal(JSON.stringify(card).includes('секретный запрос шаблона'), false);
});

test('текст запроса не уходит в кабинет', () => {
    const item = templates.fromDb(row('kie-banana-lite', { hide_prompt: false }));
    const pub = templates.toPublic(item);
    assert.equal(pub.hidePrompt, true);
    assert.equal(Object.prototype.hasOwnProperty.call(pub, 'prompt'), false);
    assert.equal(item.photo, true);
});

test('каждая модель бота подключена к своему сервису', () => {
    const models = catalog.listModels({ includeDisabled: true });
    assert.ok(models.length >= 50);
    for (const model of models) {
        const plugin = gen.getPlugin(model);
        assert.equal(typeof (plugin && plugin.processRequest), 'function', model.key);
    }
});

test('модель без фото не требует снимок', () => {
    const idea = templates.fromDb(row('kie-ideogram'));
    assert.equal(idea.model, 'kie-ideogram');
    assert.equal(idea.photo, false);
    const kling = templates.fromDb(row('kling-2-1-standard', { category: 'video' }));
    assert.equal(kling.photo, true);
});
