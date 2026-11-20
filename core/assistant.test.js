const test = require('node:test');
const assert = require('node:assert/strict');
const assistant = require('./assistant');

test('срок доната выключает помощника, отмена продления нет', () => {
    assert.equal(assistant.accessChange('create'), true);
    assert.equal(assistant.accessChange('prolong'), true);
    assert.equal(assistant.accessChange('expire'), false);
    assert.equal(assistant.accessChange('cancel'), null);
});

test('номер дона берётся и из кабинета ВК, и из события', () => {
    assert.equal(assistant.vkId(-15), 15);
    assert.equal(assistant.vkId(15), 15);
    assert.equal(assistant.vkId(0), 0);
    assert.equal(assistant.maskToken('vk1.a.secretKEY'), '···tKEY');
});

test('живой список донов включает текущих и выключает пропавших', () => {
    const plan = assistant.planLive(
        [{ user_id: 1, active: true }, { user_id: 2, active: true }, { user_id: 3, active: false }],
        [{ id: 2, name: 'Анна' }, { id: 4, name: 'Борис' }]
    );
    assert.deepEqual(plan.on.map(item => item.id), [2, 4]);
    assert.deepEqual(plan.off, [1]);
});

test('команда второму боту уходит с секретом и не кладёт его в тело', async () => {
    const calls = [];
    const result = await assistant.postAssistant('/access', { userId: 9, active: false }, async (url, options) => {
        calls.push({ url, options });
        return { ok: true };
    }, { ASSISTANT_URL: 'https://assistant.example/', ASSISTANT_SECRET: 'secret-key' });
    assert.equal(result.ok, true);
    assert.equal(calls[0].url, 'https://assistant.example/access');
    assert.equal(calls[0].options.headers['X-Donut-Secret'], 'secret-key');
    assert.equal(JSON.parse(calls[0].options.body).active, false);
    assert.equal(JSON.stringify(calls[0].options.body).includes('secret-key'), false);
    const missing = await assistant.postAssistant('/access', { userId: 9, active: true }, async () => ({ ok: true }), {});
    assert.equal(missing.ok, false);
});

test('фраза дона принимает ссылку и ответ и отбрасывает кривую кнопку', () => {
    const reply = assistant.cleanReply({
        greeting: '  Здравствуйте.  ',
        buttons: [
            { label: 'Каталог', link: 'https://vk.com/market-1' },
            { label: 'Доставка', text: 'Привезём сегодня.' }
        ]
    });
    assert.equal(reply.greeting, 'Здравствуйте.');
    assert.equal(reply.buttons[0].link, 'https://vk.com/market-1');
    assert.equal(reply.buttons[1].text, 'Привезём сегодня.');
    assert.equal(assistant.cleanReply({ buttons: [{ label: 'Сайт', link: 'http://example.com' }] }), null);
    assert.equal(assistant.cleanReply({ buttons: [{ label: 'Два', link: 'https://vk.com/a', text: 'и текст' }] }), null);
    assert.equal(JSON.stringify(reply).includes('secret'), false);
});

test('без адреса второго бота здоровье показывает, что он не подключён', async () => {
    const health = await assistant.readHealth(async () => { throw new Error('нет сети'); }, {});
    assert.equal(health.configured, false);
    assert.match(health.error, /Адрес/);
});
