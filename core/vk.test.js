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
    process.env.WEBAPP_URL = 'https://bot.example';
    const personal = JSON.parse(vk.mainMenu(10));
    assert.match(personal.buttons[1][1].action.link, /^https:\/\/bot\.example\/vk\.html\?tk=-10\./);
    assert.doesNotMatch(vk.cabinetLink(-10, 'pack_100'), /yookassa|yoomoney/);
    const pay = JSON.parse(vk.payMessageKeyboard(-10, 'pack_100'));
    assert.equal(pay.inline, true);
    assert.equal(pay.buttons[0][0].action.label, 'Оплатить');
    const auth = require('./auth');
    assert.equal(auth.verifyUserToken(auth.signUserId(-10)), '-10');
    assert.equal(auth.verifyUserToken(auth.signUserId(5)), '5');
    assert.equal(auth.verifyUserToken('1.' + 'a'.repeat(32)), null);
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

test('кабинет ВК открывает приложение напрямую, без сообщества', () => {
    process.env.VK_APP_ID = '54895627';
    process.env.VK_GROUP_ID = '230706467';
    const personal = JSON.parse(vk.mainMenu(10));
    const action = personal.buttons[1][1].action;
    assert.equal(action.type, 'open_app');
    assert.equal(action.app_id, 54895627);
    assert.equal(action.owner_id, undefined);
    assert.match(action.hash, /^tk=-10\./);
    delete process.env.VK_APP_ID;
    delete process.env.VK_GROUP_ID;
});
