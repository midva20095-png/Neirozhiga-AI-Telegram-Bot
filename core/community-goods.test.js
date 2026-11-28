const test = require('node:test');
const assert = require('node:assert/strict');
const { communityGoods, openSection } = require('./community-goods');

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

test('закрытый для ключа сообщества альбом читается списком фотографий', async () => {
    const calls = [];
    const items = await openSection(9, 'albums', {
        call: async (method, params) => {
            calls.push(method);
            if (method === 'photos.getAlbums') {
                return { items: [{ id: 3, title: 'Торты' }] };
            }
            if (method === 'photos.get' && params.album_id === 3) {
                return { items: [{ id: 8, owner_id: -9, text: 'Наполеон 1800 руб' }] };
            }
            return { items: [] };
        }
    });
    assert.ok(calls.includes('photos.getAlbums'));
    assert.ok(items.some((item) => item.kind === 'service' && item.title === 'Торты'));
    assert.ok(items.some((item) => item.kind === 'product' && item.title === 'Наполеон' && item.price === '1800' && item.link === 'https://vk.com/photo-9_8'));
});
