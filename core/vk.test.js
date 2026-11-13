const test = require('node:test');
const assert = require('node:assert/strict');
const vk = require('./vk');

test('аккаунт ВК не совпадает с числом Telegram', () => {
    assert.equal(vk.accountId(236645486), -236645486);
    assert.equal(vk.accountId(0), null);
    assert.equal(vk.accountId(-5), null);
    assert.equal(vk.accountId('нет'), null);
});

test('отказ ВК объясняется без ключа', () => {
    assert.match(vk.connectHint({ code: 100, message: 'longpoll for this group is not enabled' }), /Long Poll API/);
    assert.match(vk.connectHint({ code: 15, message: 'Access denied' }), /Управление/);
    assert.match(vk.connectHint({ code: 5, message: 'invalid access_token vk1.a.secret' }), /Ключ сообщества/);
});

test('из события ВК берётся только входящий текст человека', () => {
    const update = {
        type: 'message_new',
        object: { message: { from_id: 10, peer_id: 10, text: '  нарисуй кота ', out: 0 } }
    };
    assert.deepEqual(vk.readIncoming(update), { fromId: 10, peerId: 10, text: 'нарисуй кота', payload: null });
    assert.equal(vk.readIncoming({ type: 'message_new', object: { message: { from_id: 10, text: 'я', out: 1 } } }), null);
    assert.equal(vk.readIncoming({ type: 'message_reply' }), null);
    assert.equal(vk.isGreeting('Начать'), true);
    assert.equal(vk.isGreeting('нарисуй кота'), false);
});

test('меню ВК открывает кабинет и не считает кнопки запросом', () => {
    const menu = JSON.parse(vk.mainMenu());
    const labels = menu.buttons.flat().map(button => button.action.label);
    assert.deepEqual(labels, ['Баланс', 'Модели', 'Пополнить', 'Кабинет', 'Справка']);
    assert.equal(menu.buttons[1][1].action.link, 'https://babayagaland.ru');
    const sections = JSON.parse(vk.sectionKeyboard());
    assert.equal(sections.inline, false);
    assert.ok(sections.buttons.length <= 10);
    assert.equal(sections.buttons.at(-1)[0].action.label, 'Меню');
    assert.equal(vk.menuAction('Картинки', { g: 'image' }), 'group');
    assert.equal(vk.menuAction('Чат', { m: 'flash' }), 'model');
    assert.equal(vk.menuAction('Пополнить'), 'pay');
    assert.equal(vk.menuAction('', { command: 'start' }), 'hello');
    assert.equal(vk.menuAction('нарисуй кота'), '');
    const event = vk.readEvent({
        type: 'message_event',
        object: { user_id: 10, peer_id: 10, event_id: 'e1', payload: '{"m":"flash"}' }
    });
    assert.equal(event.payload.m, 'flash');
});
