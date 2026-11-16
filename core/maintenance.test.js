const test = require('node:test');
const assert = require('node:assert/strict');
const maintenance = require('./maintenance');

test('закрытие входа читается только из явного флага', () => {
    assert.equal(maintenance.isClosed(null), false);
    assert.equal(maintenance.isClosed({}), false);
    assert.equal(maintenance.isClosed({ maintenance: { on: false } }), false);
    assert.equal(maintenance.isClosed({ maintenance: { on: true } }), true);
    assert.match(maintenance.NOTICE, /обновление/);
});
