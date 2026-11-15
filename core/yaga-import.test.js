const test = require('node:test');
const assert = require('node:assert/strict');
const sheet = require('./yaga-balances');

test('перенос ЯгаГенератора не трогает чужие номера и берёт больший повтор', () => {
    const rows = sheet.balanceRows();
    const ids = rows.map(row => row.vkId);
    assert.equal(new Set(ids).size, rows.length);
    assert.equal(rows.length, sheet.RAW.length - 1);
    const twice = rows.find(row => row.vkId === 390221833);
    assert.equal(twice.balance, 140);
    assert.equal(twice.accountId, -390221833);
    rows.forEach(row => {
        assert.equal(row.accountId, -row.vkId);
        assert.ok(row.accountId < 0);
        assert.ok(row.balance >= 0);
    });
    assert.equal(sheet.GROUP_ID, '236645486');
});
