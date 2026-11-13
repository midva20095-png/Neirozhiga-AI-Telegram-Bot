const test = require('node:test');
const assert = require('node:assert/strict');
const channel = require('./channel');

test('подписка на канал считается только для участника', () => {
    assert.equal(channel.CHANNEL, '@neuroyaga_AI');
    assert.equal(channel.CHANNEL_URL, 'https://t.me/neuroyaga_AI');
    assert.equal(channel.memberOk({ status: 'member' }), true);
    assert.equal(channel.memberOk({ status: 'creator' }), true);
    assert.equal(channel.memberOk({ status: 'administrator' }), true);
    assert.equal(channel.memberOk({ status: 'restricted', is_member: true }), true);
    assert.equal(channel.memberOk({ status: 'restricted', is_member: false }), false);
    assert.equal(channel.memberOk({ status: 'left' }), false);
    assert.equal(channel.memberOk({ status: 'kicked' }), false);
    assert.equal(channel.memberOk(null), false);
});
