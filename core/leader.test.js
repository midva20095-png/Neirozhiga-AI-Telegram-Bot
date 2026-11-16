const test = require('node:test');
const assert = require('node:assert/strict');
const leader = require('./leader');

test('409 узнаётся по коду и по тексту Telegram', () => {
    assert.equal(leader.telegramConflict({ response: { error_code: 409 } }), true);
    assert.equal(leader.telegramConflict({ message: '409: Conflict: terminated by other getUpdates request' }), true);
    assert.equal(leader.telegramConflict({ message: '401: Unauthorized' }), false);
    assert.equal(leader.telegramConflict(null), false);
});

test('ожидание лидера идёт по одной цепочке и не зависает без базы', async () => {
    leader.resetForTests();
    let calls = 0;
    const ready = leader.hold(async () => {
        calls += 1;
        return calls >= 3;
    }, async () => {});
    await leader.hold(async () => {
        throw new Error('второй вызов не должен проверять блокировку');
    }, async () => {});
    await ready;
    assert.equal(calls, 3);

    leader.resetForTests();
    let failures = 0;
    await leader.hold(async () => {
        failures += 1;
        throw new Error('db down');
    }, async () => {});
    assert.equal(failures, 3);
});
