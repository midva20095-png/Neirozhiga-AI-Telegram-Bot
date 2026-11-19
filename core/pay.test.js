const test = require('node:test');
const assert = require('node:assert/strict');
const pay = require('./pay');

test('кредиты начисляются только по подтверждённой оплате', () => {
    const real = {
        id: '2c5b8b3e-1d4a-4e3b-9c2a-0b1c2d3e4f50',
        status: 'succeeded',
        paid: true,
        amount: { value: '850.00', currency: 'RUB' },
        metadata: { userId: '-10', credits: '1000' }
    };
    assert.deepEqual(pay.acceptedPayment(real), {
        id: real.id,
        userId: '-10',
        credits: 1000
    });
    assert.equal(pay.acceptedPayment(Object.assign({}, real, { status: 'pending', paid: false })), null);
    assert.equal(pay.acceptedPayment(Object.assign({}, real, { amount: { value: '0.00' } })), null);
    assert.equal(pay.acceptedPayment(Object.assign({}, real, { metadata: { userId: '-10', credits: '0' } })), null);
    assert.equal(pay.acceptedPayment(null), null);
});
