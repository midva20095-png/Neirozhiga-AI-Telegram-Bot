const test = require('node:test');
const assert = require('node:assert/strict');
const { communityGoods } = require('./community-goods');

test('витрина читается ответом market.get', async () => {
    const calls = [];
    const text = await communityGoods(15, {
        call: async (method, params) => {
            calls.push(method);
            assert.equal(params.owner_id, -15);
            return {
                count: 1,
                items: [{ id: 4, owner_id: -15, title: 'Наполеон', price: { text: '1 500 ₽' }, availability: 0 }]
            };
        }
    });
    assert.deepEqual(calls, ['market.get']);
    assert.equal(text, 'Товар: Наполеон, 1 500 ₽ — https://vk.com/product-15_4');
});

test('если список товаров закрыт, берётся товар с записи стены', async () => {
    const text = await communityGoods(7, {
        call: async (method) => {
            if (method === 'market.get') {
                const error = new Error('vk');
                error.code = 27;
                throw error;
            }
            return {
                items: [{
                    attachments: [{
                        type: 'market',
                        market: { id: 3, owner_id: 7, name: 'Медовик', price: { amount: '200000' } }
                    }]
                }]
            };
        }
    });
    assert.equal(text, 'Товар: Медовик, 2000 ₽ — https://vk.com/product-7_3');
});
