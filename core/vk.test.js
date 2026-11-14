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
    assert.deepEqual(labels, ['Кабинет', 'Баланс', 'Модели', 'Пополнить', 'Перенос', 'Справка/Рейтинг']);
    for (const row of menu.buttons) {
        const links = row.filter(button => button.action.type === 'open_link');
        if (!links.length) continue;
        assert.equal(row.length, 1);
        assert.equal(links[0].color, undefined);
        assert.match(links[0].action.link, /^https:\/\//);
    }
    assert.equal(menu.buttons[0].length, 1);
    assert.equal(menu.buttons[0][0].action.type, 'open_link');
    assert.equal(menu.buttons[0][0].action.link, 'https://babayagaland.ru');
    process.env.WEBAPP_URL = 'https://bot.example';
    const personal = JSON.parse(vk.mainMenu(10));
    const cabinet = personal.buttons.flat().find(button => button.action.label === 'Кабинет');
    assert.match(cabinet.action.link, /^https:\/\/bot\.example\/vk\.html\?tk=-10\./);
    assert.doesNotMatch(vk.cabinetLink(-10, 'pack_100'), /yookassa|yoomoney/);
    const pay = JSON.parse(vk.payKeyboard());
    assert.equal(pay.buttons.at(-1)[0].action.label, 'Назад');
    const locked = JSON.parse(vk.payLockKeyboard());
    assert.deepEqual(locked.buttons.map(row => row.map(button => button.action.label)), [['Назад']]);
    const link = JSON.parse(vk.payLinkKeyboard('https://yookassa.ru/checkout/test'));
    assert.deepEqual(link.buttons.map(row => row.map(button => button.action.label)), [['Оплатить'], ['Назад']]);
    assert.equal(link.buttons[0][0].action.type, 'open_link');
    assert.equal(link.buttons[0][0].action.link, 'https://yookassa.ru/checkout/test');
    assert.equal(vk.emailOk('user@example.com'), true);
    assert.equal(vk.emailOk('не почта'), false);
    assert.equal(vk.menuAction('Назад', { a: 'pay_back' }), 'pay_back');
    assert.match(vk.USER_HELP, /Как пополнить/);
    assert.doesNotMatch(vk.USER_HELP, /окно ВК|базе бота/);
    const auth = require('./auth');
    assert.equal(auth.verifyUserToken(auth.signUserId(-10)), '-10');
    assert.equal(auth.verifyUserToken(auth.signUserId(5)), '5');
    assert.equal(auth.verifyUserToken('1.' + 'a'.repeat(32)), null);
    const sections = JSON.parse(vk.sectionKeyboard());
    assert.equal(sections.inline, false);
    assert.ok(sections.buttons.length <= 10);
    assert.equal(sections.buttons.at(-1)[0].action.label, 'Назад');
    assert.equal(vk.menuAction('Справка/Рейтинг'), 'more');
    assert.equal(vk.menuAction('Назад'), 'pay_back');
    assert.equal(vk.menuAction('Отмена'), 'opt_cancel');
    assert.equal(vk.menuAction('К разделам'), 'models');
    assert.equal(vk.menuAction('Картинки', { g: 'image' }), 'group');
    assert.equal(vk.menuAction('Чат', { m: 'flash' }), 'model');
    assert.equal(vk.menuAction('Пополнить'), 'pay');
    assert.equal(vk.menuAction('Перенос'), 'move');
    assert.equal(vk.menuAction('Рейтинг'), 'rate');
    assert.equal(vk.menuAction('Бот ИИ', { a: 'models' }), 'models');
    assert.equal(vk.menuAction('', { q: 'cheap' }), 'quality');
    assert.equal(vk.menuAction('', { d: 8 }), 'duration');
    assert.equal(vk.menuAction('', { s: '9:16' }), 'size');
    const catalog = require('./catalog');
    const banana = catalog.getModel('nano-banana');
    const priceStep = vk.nextChoice(banana, { quality: '', duration: 0, aspect: '' });
    assert.match(priceStep.text, /Режим/);
    assert.match(priceStep.rows.map(row => row[0].label).join(' '), /Эконом/);
    assert.match(priceStep.rows.map(row => row[0].label).join(' '), /кр/);
    const sizeStep = vk.nextChoice(banana, { quality: 'cheap', duration: 0, aspect: '' });
    assert.match(sizeStep.text, /Размер/);
    assert.ok(sizeStep.rows.flat().some(item => item.payload.s === '9:16'));
    assert.equal(vk.menuAction('', { command: 'start' }), 'hello');
    assert.equal(vk.menuAction('нарисуй кота'), '');
    assert.equal(vk.menuAction('Привет'), '');
    assert.equal(vk.isGreeting('Привет'), false);
    const event = vk.readEvent({
        type: 'message_event',
        object: { user_id: 10, peer_id: 10, event_id: 'e1', payload: '{"m":"flash"}' }
    });
    assert.equal(event.payload.m, 'flash');
});

test('кабинет ВК открывает рабочую страницу, а не пустое окно приложения', () => {
    process.env.VK_APP_ID = '54895627';
    process.env.WEBAPP_URL = 'https://bot.example';
    const personal = JSON.parse(vk.mainMenu(10));
    const action = personal.buttons.flat().find(button => button.action.label === 'Кабинет').action;
    assert.equal(action.type, 'open_link');
    assert.equal(action.app_id, undefined);
    assert.match(action.link, /^https:\/\/bot\.example\/vk\.html\?tk=-10\./);
    delete process.env.VK_APP_ID;
});
