const db = require('./db');
const sheet = require('./yaga-balances');

const KEY = 'vk_yaga_balance_import_236645486';

async function importYagaBalances() {
    const saved = await db.getSettings([KEY]);
    if (saved && saved[KEY]) return { done: true };
    const rows = sheet.balanceRows();
    let created = 0;
    let existed = 0;
    for (const row of rows) {
        if (!(row.accountId < 0)) continue;
        const inserted = await db.pool.query(
            `INSERT INTO users (user_id, balance, current_model, username, vk_group)
             VALUES ($1, $2, 'flash', $3, $4)
             ON CONFLICT (user_id) DO NOTHING
             RETURNING user_id`,
            [String(row.accountId), row.balance, `vk:${row.vkId}`, sheet.GROUP_ID]
        );
        if (!inserted.rows.length) {
            existed += 1;
            continue;
        }
        created += 1;
        if (row.balance > 0) {
            await db.pool.query(
                'INSERT INTO history (user_id, delta, balance, reason) VALUES ($1,$2,$3,$4)',
                [String(row.accountId), row.balance, row.balance, 'Перенос баланса ЯгаГенератор']
            );
        }
    }
    await db.setSetting(KEY, {
        created,
        existed,
        total: rows.length,
        at: new Date().toISOString()
    });
    return { done: false, created, existed, total: rows.length };
}

module.exports = { importYagaBalances, KEY };
