const test = require('node:test');
const assert = require('node:assert/strict');
const promo = require('./promo');

test('скидка 15% на пакет 1000 оставляет 850 рублей и 1500 бонусов', () => {
    const quote = promo.discountOf(1000);
    assert.equal(quote.percent, 15);
    assert.equal(quote.pay, 850);
    assert.equal(quote.save, 150);
    assert.equal(quote.bonuses, 1500);
    assert.equal(promo.discountOf(100).pay, 85);
    assert.equal(promo.discountOf(100).bonuses, 150);
    assert.equal(promo.discountOf(1), null);
});

test('свой код подходит один раз, чужой и чужой пакет не подходят', () => {
    const open = { status: 'open', uses_left: 1, percent: 15, owner_id: '-10', package_id: 'pack_1000', source: 'shop' };
    assert.equal(promo.decide(open, '-10', 'pack_1000').ok, true);
    assert.equal(promo.decide(open, '-11', 'pack_1000').ok, false);
    assert.equal(promo.decide(open, '-10', 'pack_100').ok, false);
    assert.equal(promo.decide(Object.assign({}, open, { status: 'used', uses_left: 0 }), '-10', 'pack_1000').ok, false);
    const shared = { status: 'open', uses_left: 3, percent: 15, owner_id: '', package_id: '', source: 'admin' };
    assert.equal(promo.decide(shared, '20', 'pack_500').ok, true);
    assert.equal(promo.normalizeCode(' ny-12 ab '), 'NY12AB');
});
