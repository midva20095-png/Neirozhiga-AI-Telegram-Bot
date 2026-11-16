const db = require('./db');
const sheet = require('./yaga-balances');

const KEY = 'vk_yaga_balance_import_236645486';
const CLEAR_KEY = 'vk_yaga_balance_cleared_236645486';
const ACCOUNT_KEY = 'vk_yaga_accounts_cleared_236645486';
const IMPORT_REASON = 'Перенос баланса ЯгаГенератор';
const CLEAR_REASON = 'Обнуление переноса ЯгаГенератор';

function isImportedLeftover(user, reasons) {
    if (!user || Number(user.balance) !== 0) return false;
    if (Number(user.gens) > 0 || Number(user.spent) > 0) return false;
    if (user.works || user.tickets || user.mail) return false;
    const list = Array.isArray(reasons) ? reasons : [];
    const other = list.some(reason => reason !== IMPORT_REASON && reason !== CLEAR_REASON);
    if (other) return false;
    if (list.includes(IMPORT_REASON)) return true;
    return String(user.vk_group) === sheet.GROUP_ID && String(user.username || '').startsWith('vk:');
}

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

async function clearImportedAccounts() {
    const saved = await db.getSettings([ACCOUNT_KEY]);
    if (saved && saved[ACCOUNT_KEY]) return { done: true };
    const removed = await db.pool.query(
        `WITH junk AS (
            SELECT u.user_id
            FROM users u
            WHERE u.balance = 0
              AND COALESCE(u.gens, 0) = 0
              AND COALESCE(u.spent, 0) = 0
              AND COALESCE(u.mail_ok, false) = false
              AND NOT EXISTS (SELECT 1 FROM works w WHERE w.user_id = u.user_id)
              AND NOT EXISTS (SELECT 1 FROM support_tickets t WHERE t.user_id = u.user_id)
              AND NOT EXISTS (
                SELECT 1 FROM history h
                WHERE h.user_id = u.user_id AND h.reason <> $1 AND h.reason <> $2
              )
              AND (
                EXISTS (SELECT 1 FROM history h WHERE h.user_id = u.user_id AND h.reason = $1)
                OR (u.vk_group = $3 AND u.username LIKE 'vk:%')
              )
        ),
        gone_history AS (
            DELETE FROM history h USING junk j WHERE h.user_id = j.user_id
        )
        DELETE FROM users u USING junk j WHERE u.user_id = j.user_id
        RETURNING u.user_id`,
        [IMPORT_REASON, CLEAR_REASON, Number(sheet.GROUP_ID)]
    );
    const cleared = removed.rows.length;
    await db.setSetting(ACCOUNT_KEY, { cleared, at: new Date().toISOString() });
    return { done: false, cleared };
}

module.exports = {
    importYagaBalances,
    clearImportedBalances,
    clearImportedAccounts,
    balanceAfterImport,
    isImportedLeftover,
    KEY,
    CLEAR_KEY,
    ACCOUNT_KEY,
    IMPORT_REASON
};
