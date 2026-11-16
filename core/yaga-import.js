const db = require('./db');
const sheet = require('./yaga-balances');

const KEY = 'vk_yaga_balance_import_236645486';
const CLEAR_KEY = 'vk_yaga_balance_cleared_236645486';
const IMPORT_REASON = 'Перенос баланса ЯгаГенератор';
const CLEAR_REASON = 'Обнуление переноса ЯгаГенератор';

function balanceAfterImport(current, reasons) {
    const list = Array.isArray(reasons) ? reasons : [];
    if (!list.includes(IMPORT_REASON)) return Number(current) || 0;
    return 0;
}

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

async function clearImportedBalances() {
    const saved = await db.getSettings([CLEAR_KEY]);
    if (saved && saved[CLEAR_KEY]) return { done: true };
    const updated = await db.pool.query(
        `WITH targets AS (
            SELECT u.user_id, u.balance
            FROM users u
            WHERE EXISTS (
                SELECT 1 FROM history h
                WHERE h.user_id = u.user_id AND h.reason = $1
            )
        ), updated AS (
            UPDATE users u
            SET balance = 0
            FROM targets t
            WHERE u.user_id = t.user_id AND u.balance <> 0
            RETURNING u.user_id, t.balance AS old_balance
        )
        INSERT INTO history (user_id, delta, balance, reason)
        SELECT user_id, -old_balance, 0, $2 FROM updated
        RETURNING user_id`,
        [IMPORT_REASON, CLEAR_REASON]
    );
    const cleared = updated.rows.length;
    await db.setSetting(CLEAR_KEY, { cleared, at: new Date().toISOString() });
    return { done: false, cleared };
}

module.exports = { importYagaBalances, clearImportedBalances, balanceAfterImport, KEY, CLEAR_KEY, IMPORT_REASON };
