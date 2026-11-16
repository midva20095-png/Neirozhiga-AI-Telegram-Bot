const test = require('node:test');
const assert = require('node:assert/strict');
const sheet = require('./yaga-balances');
const yaga = require('./yaga-import');

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
    assert.equal(yaga.balanceAfterImport(140, ['Перенос баланса ЯгаГенератор']), 0);
    assert.equal(yaga.balanceAfterImport(500, ['ЮKassa']), 500);
    assert.equal(yaga.balanceAfterImport(80, []), 80);
    assert.equal(yaga.isImportedLeftover({ balance: 0, gens: 0, spent: 0, vk_group: '236645486', username: 'vk:1' }, ['Перенос баланса ЯгаГенератор']), true);
    assert.equal(yaga.isImportedLeftover({ balance: 500, gens: 0, spent: 0, vk_group: '236645486', username: 'vk:1' }, ['Перенос баланса ЯгаГенератор', 'ЮKassa']), false);
    assert.equal(yaga.isImportedLeftover({ balance: 0, gens: 2, spent: 10, vk_group: '230706467', username: 'vk:2' }, []), false);
});
