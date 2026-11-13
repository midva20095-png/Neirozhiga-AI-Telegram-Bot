const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('./bridge');

test('номер ВК становится отдельным счётом, чужой текст не проходит', () => {
    assert.equal(bridge.vkAccount('462733829'), -462733829);
    assert.equal(bridge.vkAccount('id462733829'), -462733829);
    assert.equal(bridge.vkAccount('https://vk.com/id462733829'), -462733829);
    assert.equal(bridge.vkAccount('нет'), null);
    assert.equal(bridge.vkAccount('-5'), -5);
    assert.equal(bridge.amountOf('100'), 100);
    assert.equal(bridge.amountOf('0'), null);
    assert.equal(bridge.amountOf('много'), null);
});

test('перенос не создаёт чужой аккаунт и возвращает кредиты, если зачисление сорвалось', async () => {
    const missing = await bridge.moveCredits({
        findUser: async () => null,
        debitBalance: async () => { throw new Error('не должны списывать'); }
    }, { fromId: '5', toId: '-9', amount: 10 });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /Начать/);

    let refund = 0;
    const failed = await bridge.moveCredits({
        findUser: async () => ({ user_id: '-9', blocked: false }),
        debitBalance: async () => ({ ok: true, balance: 40 }),
        updateBalance: async (id, amount) => {
            if (amount > 0 && id === '-9') return null;
            refund += amount;
            return 50;
        }
    }, { fromId: '5', toId: '-9', amount: 10, takeReason: 'a', giveReason: 'b' });
    assert.equal(failed.ok, false);
    assert.equal(refund, 10);
});
