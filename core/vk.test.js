const test = require('node:test');
const assert = require('node:assert/strict');
const vk = require('./vk');

test('аккаунт ВК не совпадает с числом Telegram', () => {
    assert.equal(vk.accountId(236645486), -236645486);
    assert.equal(vk.accountId(0), null);
    assert.equal(vk.accountId(-5), null);
    assert.equal(vk.accountId('нет'), null);
});

test('из события ВК берётся только входящий текст человека', () => {
    const update = {
        type: 'message_new',
        object: { message: { from_id: 10, peer_id: 10, text: '  нарисуй кота ', out: 0 } }
    };
    assert.deepEqual(vk.readIncoming(update), { fromId: 10, peerId: 10, text: 'нарисуй кота' });
    assert.equal(vk.readIncoming({ type: 'message_new', object: { message: { from_id: 10, text: 'я', out: 1 } } }), null);
    assert.equal(vk.readIncoming({ type: 'message_reply' }), null);
    assert.equal(vk.isGreeting('Начать'), true);
    assert.equal(vk.isGreeting('нарисуй кота'), false);
});
