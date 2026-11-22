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
        [{ user_id: 1, active: true }, { user_id: 2, active: true }, { user_id: 3, active: false }, { user_id: assistant.DEMO_OWNER, active: true }],
        [{ id: 2, name: 'Анна' }, { id: 4, name: 'Борис' }]
    );
    assert.deepEqual(plan.on.map(item => item.id), [2, 4]);
    assert.deepEqual(plan.off, [1]);
});

test('карточка ИП заполняет те же поля, что человек в кабинете', () => {
    const reply = assistant.demoReply('243561815');
    assert.ok(reply);
    assert.match(reply.greeting, /ИП Соколов/);
    assert.equal(/демонстрац|учебн/i.test(JSON.stringify(reply)), false);
    assert.equal(reply.services.every(item => item.link && item.text && item.price), true);
    assert.equal(reply.products.every(item => item.link && item.text && item.section), true);
    assert.equal(reply.products.filter(item => item.section === 'Расходники').length, 3);
    assert.equal(reply.products.filter(item => item.section === 'Хранение').length, 3);
    assert.match(reply.pickupMap, /yandex\.ru\/maps\/213\/moscow/);
    assert.match(reply.address, /Люблинская/);
    assert.equal(reply.buttons.find(item => item.label === 'Прайс').items[0].items.length, 2);
    assert.match(reply.buttons.find(item => item.label === 'Отзывы').link, /reviews-243561815/);
    assert.equal(reply.buttons.find(item => item.label === 'Как доехать').action, 'contact');
    assert.equal(reply.buttons.find(item => item.label === 'Запись онлайн').action, 'book');
    assert.ok(reply.guide);
    assert.equal(reply.schedule.places[0], 'Бокс');
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
    const tree = assistant.cleanReply({
        buttons: [{
            label: 'Меню',
            items: [
                { label: 'Прайс', text: 'Шиномонтаж 400 рублей.' },
                { label: 'Ещё', items: [{ label: 'Карта', link: 'https://vk.com/market-1' }] }
            ]
        }]
    });
    assert.equal(tree.buttons[0].items[0].text, 'Шиномонтаж 400 рублей.');
    assert.equal(tree.buttons[0].items[1].items[0].link, 'https://vk.com/market-1');
    assert.equal(assistant.cleanReply({ buttons: [{ label: 'Меню', items: [{ label: 'Назад', text: 'нет' }] }] }), null);
    const kinds = assistant.cleanReply({
        buttons: [
            { label: 'Запись онлайн', action: 'book' },
            { label: 'Как доехать', action: 'contact' },
            { label: 'Акция', text: 'Сезон', hidden: true }
        ]
    });
    assert.equal(kinds.buttons[0].action, 'book');
    assert.equal(kinds.buttons[1].action, 'contact');
    assert.equal(kinds.buttons[2].hidden, true);
    assert.equal(assistant.cleanReply({
        buttons: Array.from({ length: 11 }, (_, index) => ({ label: `Кнопка ${index + 1}`, text: 'Текст' }))
    }), null);
    const modes = assistant.cleanReply({
        buttons: [{ label: 'Витрина', goods: true }],
        goodsOn: false,
        bookingOn: false
    });
    assert.deepEqual(modes.buttons[0], { label: 'Витрина', goods: true });
    assert.equal(modes.goodsOn, false);
    assert.equal(modes.bookingOn, false);
    assert.equal(assistant.cleanReply({ scenario: 'info', bookingOn: true }).bookingOn, false);
    assert.equal(assistant.cleanReply({}).goodsOn, true);
    assert.equal(assistant.cleanReply({}).bookingOn, true);
    assert.equal(assistant.cleanReply({}).linkOn, true);
    assert.equal(assistant.cleanReply({}).orderOn, true);
    assert.equal(assistant.cleanReply({}).trade, 'shop');
    assert.deepEqual(assistant.cleanReply({}).services, []);
    assert.deepEqual(assistant.cleanReply({}).products, []);
    assert.deepEqual(assistant.cleanReply({ products: [{ name: 'Торт', price: '1500', link: 'https://vk.com/market-1' }] }).products, [
        { name: 'Торт', price: 1500, link: 'https://vk.com/market-1' }
    ]);
    assert.deepEqual(assistant.cleanReply({
        products: [
            { name: 'Торты', items: [{ name: 'Бенто', price: '900' }, { name: 'Бенто', price: 1 }] },
            { name: 'Напитки', items: [{ name: 'Лимонад', price: 200, link: 'https://vk.com/market-1' }] }
        ]
    }).products, [
        { name: 'Бенто', price: 900, link: '', section: 'Торты' },
        { name: 'Лимонад', price: 200, link: 'https://vk.com/market-1', section: 'Напитки' }
    ]);
    const tire = assistant.cleanReply({ trade: 'tire' });
    assert.equal(tire.trade, 'tire');
    assert.equal(tire.linkOn, false);
    assert.equal(tire.orderOn, false);
    assert.equal(tire.goodsOn, false);
    assert.deepEqual(tire.services.map(function (item) { return item.name; }), ['Шиномонтаж', 'Ремонт', 'Балансировка', 'Сезонная смена']);
    assert.equal(tire.services[0].price, 0);
    const priced = assistant.cleanReply({
        trade: 'hair',
        services: [
            { name: 'Стрижка', price: '700', link: 'https://vk.com/market-1' },
            { name: 'Мытьё', price: 300, extra: true, link: 'http://evil.test' }
        ]
    });
    assert.equal(priced.services[0].price, 700);
    assert.equal(priced.services[0].link, 'https://vk.com/market-1');
    assert.equal(priced.services[1].extra, true);
    assert.equal(priced.services[1].link, '');
    assert.equal(assistant.cleanReply({ goodsOn: false }).linkOn, false);
    assert.equal(assistant.cleanReply({ goodsOn: false, linkOn: true }).linkOn, true);
    const card = assistant.cleanReply({
        payment: 'Перевод после подтверждения.',
        booking: 'Бронь по дате в сообщениях.',
        contacts: 12
    });
    assert.equal(card, null);
    const shop = assistant.cleanReply({ payment: 'Перевод после подтверждения.', booking: 'Бронь по дате в сообщениях.' });
    assert.equal(shop.payment, 'Перевод после подтверждения.');
    assert.equal(shop.address, '');
    assert.deepEqual(shop.schedule.days, [1, 2, 3, 4, 5]);
    assert.equal(shop.schedule.places[0], 'На месте');
    const hours = assistant.cleanReply({ schedule: { days: [1, 7], start: 9, end: 12, slot: 30, horizon: 14, places: ['Зал', 'Выезд'] } });
    assert.deepEqual(hours.schedule, { days: [1, 7], start: 9, end: 12, slot: 30, horizon: 14, seats: 0, places: ['Зал', 'Выезд'] });
    assert.equal(assistant.cleanReply({ schedule: { seats: 3 } }).schedule.seats, 3);
    assert.equal(assistant.cleanReply({ schedule: { seats: 'нет' } }).schedule.seats, 0);
    assert.equal(shop.scenario, 'funnel');
    assert.equal(shop.handoff, true);
    assert.equal(shop.deliveryOn, false);
    const road = assistant.cleanReply({ deliveryOn: true, delivery: 'По городу', deliveryPrice: '400 рублей', pickupOn: false, handoff: false });
    assert.equal(road.delivery, 'По городу');
    assert.equal(road.deliveryPrice, '400 рублей');
    assert.equal(road.deliveryOn, true);
    assert.equal(road.handoff, false);
    assert.equal(assistant.setupNote('  включите самовывоз  '), 'включите самовывоз');
    assert.equal(assistant.setupNote('а'.repeat(600)).length, 500);
    const setupPack = assistant.setupCard({
        task: 'Включите самовывоз с Ленина',
        phone: '8 900 111-22-33',
        address: 'Ленина 5',
        map: 'https://yandex.ru/maps/-/CCUexample'
    });
    assert.equal(setupPack.phone, '+79001112233');
    assert.equal(setupPack.address, 'Ленина 5');
    assert.equal(setupPack.map, 'https://yandex.ru/maps/-/CCUexample');
    assert.throws(() => assistant.setupCard({ task: 'мало', phone: '+79001112233', address: 'Ленина 5', map: 'https://yandex.ru/maps/-/CCUexample' }), /что именно настроить/);
    assert.throws(() => assistant.setupCard({ task: 'Включите самовывоз', phone: '123', address: 'Ленина 5', map: 'https://yandex.ru/maps/-/CCUexample' }), /телефон/);
    assert.throws(() => assistant.setupCard({ task: 'Включите самовывоз', phone: '+79001112233', address: 'д', map: 'https://yandex.ru/maps/-/CCUexample' }), /адрес/);
    assert.throws(() => assistant.setupCard({ task: 'Включите самовывоз', phone: '+79001112233', address: 'Ленина 5', map: 'https://google.com/maps' }), /Яндекс/);
    assert.equal(assistant.HOLD_MS, 10 * 24 * 60 * 60 * 1000);
    assert.equal(assistant.cleanReply({ scenario: 'info' }).scenario, 'info');
    const longOrder = 'Правило заказа. '.repeat(120);
    assert.equal(assistant.cleanReply({ order: longOrder }).order.length, longOrder.trim().length);
    assert.equal(assistant.cleanReply({ order: 'а'.repeat(2501) }), null);
    assert.equal(assistant.cleanReply({ greeting: 'а'.repeat(2500) }).greeting.length, 2500);
    const people = assistant.publicPeople([{ peerId: 7, name: 'Анна', phone: '+7 999 111-22-33', note: 'хочу заказ', seen: 2, token: 'secret-token' }]);
    assert.equal(people[0].phone, '+79991112233');
    assert.equal(JSON.stringify(people).includes('secret-token'), false);
    const bookings = assistant.publicBookings([
        { peerId: 9, day: '2026-11-16', slot: '12:00', place: 'Зал', way: 'Доставка', address: 'улица Мира 4', phone: '+79001112233', map: 'https://yandex.ru/maps/-/CCUexample', token: 'secret-token' },
        { peerId: 0, day: '2026-11-16', slot: '13:00', place: 'Чужое' }
    ]);
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].when, 'Пн 16.11');
    assert.equal(bookings[0].address, 'улица Мира 4');
    assert.equal(bookings[0].phone, '+79001112233');
    assert.equal(bookings[0].map, 'https://yandex.ru/maps/-/CCUexample');
    assert.equal(JSON.stringify(bookings).includes('secret-token'), false);
    const orders = assistant.publicOrders([
        { peerId: 9, item: 'Наполеон', phone: '+79001112233', way: 'Доставка', token: 'secret-token' },
        { peerId: 0, item: 'Чужое' }
    ]);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].item, 'Наполеон');
    assert.equal(orders[0].way, 'Доставка');
    assert.equal(JSON.stringify(orders).includes('secret-token'), false);
    assert.equal(assistant.cleanReply({ pickupMap: 'https://google.com/maps' }), null);
    assert.equal(assistant.cleanReply({ pickupMap: 'https://yandex.ru/maps/-/CCUexample' }).pickupMap, 'https://yandex.ru/maps/-/CCUexample');
    assert.equal(assistant.cleanReply({ buttons: [{ label: 'Сайт', link: 'http://example.com' }] }), null);
    assert.equal(assistant.cleanReply({ buttons: [{ label: 'Два', link: 'https://vk.com/a', text: 'и текст' }] }), null);
    assert.equal(JSON.stringify(reply).includes('secret'), false);
});

test('после перезапуска помощника касса снова шлёт живых донов и их сообщества', () => {
    const calls = assistant.replayPlan(
        [{ user_id: 5, active: true }, { user_id: 6, active: false }],
        [{ owner_id: 5, group_id: 50, token: 'community-token-value', title: '', reply: { greeting: 'Здравствуйте', about: 'Торты', guide: '', buttons: [] } }, { owner_id: 6, group_id: 60, token: 'other-token-value', title: 'Чужое' }]
    );
    assert.equal(calls.length, 3);
    assert.equal(calls[0].body.active, true);
    assert.equal(calls[1].path, '/community');
    assert.equal(calls[1].body.groupId, 50);
    assert.equal(calls[1].body.title, 'Сообщество 50');
    assert.equal(calls[1].body.reply.about, 'Торты');
    assert.equal(calls[2].body.active, false);
    assert.equal(calls.some(call => call.body.groupId === 60), false);
});

test('адрес помощника понимает хост без https и сам подставляет постоянного помощника', () => {
    const cfg = assistant.assistantConfig({
        ASSISTANT_URL: 'vkdonutassistantbot-production.up.railway.app/',
        ASSISTANT_SECRET: ' secret '
    });
    assert.equal(cfg.url, 'https://vkdonutassistantbot-production.up.railway.app');
    assert.equal(cfg.secret, 'secret');
    const previous = process.env.ASSISTANT_URL;
    delete process.env.ASSISTANT_URL;
    try {
        assert.equal(assistant.assistantConfig().url, 'https://vkdonutassistantbot-production.up.railway.app');
    } finally {
        if (previous === undefined) delete process.env.ASSISTANT_URL;
        else process.env.ASSISTANT_URL = previous;
    }
});

test('без адреса второго бота здоровье показывает, что он не подключён', async () => {
    const health = await assistant.readHealth(async () => { throw new Error('нет сети'); }, {});
    assert.equal(health.configured, false);
    assert.match(health.error, /Адрес/);
});
