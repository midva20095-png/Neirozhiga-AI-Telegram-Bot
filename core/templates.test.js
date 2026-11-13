const test = require('node:test');
const assert = require('node:assert/strict');
const templates = require('./templates');

function row(model, extra) {
    return Object.assign({
        id: 7,
        title: 'Естественный lifestyle',
        prompt: 'портрет',
        model,
        cost: 6,
        hide_prompt: true,
        active: true,
        category: 'image',
        formats: ''
    }, extra || {});
}

test('шаблон на Nano Banana Братухи уходит на Banana Lite, фото по-прежнему нужно', () => {
    const prev = process.env.KIE_API_KEY;
    process.env.KIE_API_KEY = 'test-key';
    try {
        const item = templates.fromDb(row('nano-banana'));
        assert.equal(item.model, 'kie-banana-lite');
        assert.equal(item.photo, true);
        assert.equal(item.cost, 6);
        assert.ok(item.formats.includes('9:16'));
        assert.equal(item.formats.includes('4:5'), false);
    } finally {
        if (prev == null) delete process.env.KIE_API_KEY;
        else process.env.KIE_API_KEY = prev;
    }
});

test('pro остаётся Чат Pro, а не картинкой', () => {
    const item = templates.fromDb(row('pro', { category: 'video', hide_prompt: false, cost: 15 }));
    assert.equal(item.model, 'pro');
    assert.equal(item.photo, false);
});

test('тихий сбой картинки повторяется через Banana Lite', () => {
    const prev = process.env.KIE_API_KEY;
    process.env.KIE_API_KEY = 'test-key';
    try {
        const err = new Error('Произошла ошибка, нейросеть временно недоступна. Попробуйте повторить запрос позже.');
        assert.equal(templates.fallbackModel('nanobanana', err), 'kie-banana-lite');
        assert.equal(templates.fallbackModel('kie-banana-lite', err), null);
        assert.equal(templates.fallbackModel('flash', err), null);
        assert.equal(templates.fallbackModel('nanobanana', new Error('Прикрепите фото')), null);
        assert.equal(templates.fallbackModel('kie-banana-lite', new Error('Фото не загрузилось. Кредиты не списаны.')), 'nanobanana');
    } finally {
        if (prev == null) delete process.env.KIE_API_KEY;
        else process.env.KIE_API_KEY = prev;
    }
});
