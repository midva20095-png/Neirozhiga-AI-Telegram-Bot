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

test('pro остаётся Чат Pro, а не картинкой', () => {
    const item = templates.fromDb(row('pro', { category: 'video', cost: 15 }));
    assert.equal(item.model, 'pro');
    assert.equal(item.photo, false);
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
