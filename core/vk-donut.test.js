const test = require('node:test');
const assert = require('node:assert/strict');
const club = require('./vk-club');
const donut = require('./vk-donut');

test('опрос доната покрывает каждый урок один раз', () => {
    const seen = new Set();
    donut.QUESTIONS.forEach(item => {
        assert.match(item.ask, /Умеете/);
        item.lessons.forEach(index => {
            assert.equal(seen.has(index), false);
            assert.ok(club.LESSONS[index]);
            seen.add(index);
        });
    });
    assert.equal(seen.size, club.LESSONS.length);
});

test('после подписки сначала навигация, потом вопрос', () => {
    const hello = donut.welcomeText();
    assert.match(hello, /Навигация по урокам/);
    assert.match(hello, /https:\/\/vk\.com\/@neuroyaga-/);
    assert.match(hello, /Кредиты за опрос не списываются/);
    assert.match(donut.prompt(0), /1 из \d+\. Умеете создавать сообщество/);
    assert.match(donut.prompt(1), /обложки и аватарки/i);
    assert.match(donut.prompt(2), /товары/i);
});

test('в конце приходят уроки только по ответу нет', () => {
    const text = donut.resultText([0, 1]);
    assert.match(text, /Создание сообщества ВК/);
    assert.match(text, /Обложки сообщества с помощью ИИ/);
    assert.match(text, /Аватар и обложка с помощью ИИ/);
    assert.match(text, /Живая и статическая обложка/);
    assert.doesNotMatch(text, /Прайс с помощью ИИ/);
    assert.match(text, /Кредиты не списаны/);
    const known = donut.resultText([]);
    assert.match(known, /уже умеете/);
    assert.doesNotMatch(known, /https:\/\/vk\.com\/@neuroyaga-/);
    assert.doesNotMatch(`${text}\n${known}\n${donut.welcomeText()}`, /vk1\.a\.|00368ab5|access_token/);
});

test('да и нет читаются с кнопки и текстом', () => {
    assert.equal(donut.parseAnswer('Да', null), 'yes');
    assert.equal(donut.parseAnswer('нет!', null), 'no');
    assert.equal(donut.parseAnswer('не умею', null), 'no');
    assert.equal(donut.parseAnswer('', { a: 'survey', y: 1 }), 'yes');
    assert.equal(donut.parseAnswer('', { a: 'survey', y: 0 }), 'no');
    assert.equal(donut.parseAnswer('хочу картинку', null), null);
    assert.equal(donut.readSubscription({ type: 'donut_subscription_create', object: { user_id: 7 } }).userId, 7);
    assert.equal(donut.readSubscription({ type: 'donut_subscription_create', object: { user_id: -1 } }), null);
    assert.equal(donut.readSubscription({ type: 'message_new', object: { user_id: 7 } }), null);
    assert.deepEqual(donut.readDonutEvent({ type: 'donut_subscription_cancelled', object: { user_id: 9, amount: 50 } }), { userId: 9, kind: 'cancel', amount: 50 });
    assert.equal(donut.readDonutEvent({ type: 'donut_subscription_expired', object: { user_id: 3 } }).kind, 'expire');
    assert.equal(donut.readDonutEvent({ type: 'wall_reply_new', object: { user_id: 3 } }), null);
});
