const activity = require('./activity');

const PERCENT = 15;
const BONUS_RATE = 10;

function database() {
    return require('./db');
}

function catalog() {
    return require('./catalog');
}

function groupOf(groupId) {
    return String(groupId || '').replace(/\D/g, '');
}

function accountOf(userId) {
    const raw = String(userId || '').trim();
    if (!/^-?\d+$/.test(raw) || raw === '0' || raw === '-0') return '';
    return raw;
}

function discountOf(price) {
    const full = Math.round(Number(price) || 0);
    if (full < 2) return null;
    const save = Math.round(full * PERCENT / 100);
    const pay = full - save;
    if (save < 1 || pay < 1) return null;
    return { percent: PERCENT, full, pay, save, bonuses: save * BONUS_RATE };
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

function makeCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = 'NY';
    for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
}

function decide(row, userId, packageId) {
    const left = Number(row && (row.uses_left != null ? row.uses_left : row.usesLeft));
    if (!row || row.status !== 'open' || !(left > 0)) return { ok: false, error: 'Промокод уже использован.' };
    if (Number(row.percent) !== PERCENT) return { ok: false, error: 'Промокод не подходит.' };
    const ownerRaw = row.owner_id != null ? row.owner_id : row.ownerId;
    const owner = ownerRaw == null || ownerRaw === '' ? '' : String(ownerRaw);
    if (owner && owner !== String(userId)) return { ok: false, error: 'Этот промокод выдан другому человеку.' };
    const pack = String(row.package_id != null ? row.package_id : (row.packageId || ''));
    if (pack && pack !== String(packageId || '')) return { ok: false, error: 'Промокод действует на другой пакет.' };
    return { ok: true };
}

async function withTx(work) {
    const client = await database().pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (e) {}
        throw error;
    } finally {
        client.release();
    }
}

function shopError(message) {
    const error = new Error(message);
    error.shop = true;
    return error;
}

async function spendLots(client, userId, group, amount) {
    const lots = await client.query(
        `SELECT month, points, spent FROM vk_bonus
         WHERE user_id = $1 AND group_id = $2 AND points > spent
         ORDER BY month
         FOR UPDATE`,
        [userId, group]
    );
    const takes = activity.planSpend(lots.rows, amount);
    if (!takes) return null;
    for (const take of takes) {
        const updated = await client.query(
            `UPDATE vk_bonus SET spent = spent + $4
             WHERE user_id = $1 AND group_id = $2 AND month = $3::date AND points - spent >= $4`,
            [userId, group, take.month, take.amount]
        );
        if (!updated.rowCount) return null;
    }
    return takes;
}

function mapRow(row) {
    if (!row) return null;
    return {
        id: Number(row.id),
        code: row.code,
        ownerId: row.owner_id == null ? '' : String(row.owner_id),
        packageId: row.package_id || '',
        percent: Number(row.percent) || 0,
        usesLeft: Number(row.uses_left) || 0,
        source: row.source,
        price: Number(row.shop_price) || 0,
        stock: Number(row.shop_stock) || 0,
        status: row.status
    };
}

async function findCode(code) {
    const res = await database().pool.query(
        `SELECT id, code, owner_id::text AS owner_id, package_id, percent, uses_left, source, shop_price, shop_stock, status
         FROM vk_promo WHERE code = $1`,
        [normalizeCode(code)]
    );
    return mapRow(res.rows[0]);
}

function preview(row, userId, packageId) {
    if (!row) return { ok: false, error: 'Такого промокода нет.' };
    const decision = decide(row, userId, packageId);
    if (!decision.ok) return decision;
    const pkg = catalog().getPackage(packageId);
    const quote = pkg && discountOf(pkg.price);
    if (!quote) return { ok: false, error: 'Скидка на этот пакет не считается.' };
    return Object.assign({ ok: true, id: row.id, code: row.code }, quote);
}

async function hasGrant(client, codeId, userId) {
    const found = await client.query(
        `SELECT 1 FROM vk_promo_grant WHERE code_id = $1 AND user_id = $2`,
        [codeId, userId]
    );
    return !!found.rows.length;
}

async function canUse(raw, userId, packageId) {
    const account = accountOf(userId);
    const row = await findCode(raw);
    const shown = preview(row, account, packageId);
    if (!shown.ok || !(row.price > 0)) return shown;
    const allowed = await hasGrant(database().pool, row.id, account);
    if (!allowed) return { ok: false, error: 'Сначала купите этот промокод в магазине.' };
    return shown;
}

async function take(raw, userId, packageId) {
    const code = normalizeCode(raw);
    const account = accountOf(userId);
    if (!code || !account) return { ok: false, error: 'Промокод не подходит.' };
    try {
        return await withTx(async client => {
            const found = await client.query(
                `SELECT id, code, owner_id::text AS owner_id, package_id, percent, uses_left, source, shop_price, status
                 FROM vk_promo WHERE code = $1 FOR UPDATE`,
                [code]
            );
            const row = mapRow(found.rows[0]);
            const shown = preview(row, account, packageId);
            if (!shown.ok) throw shopError(shown.error);
            if (row.price > 0) {
                const grant = await client.query(
                    `DELETE FROM vk_promo_grant WHERE code_id = $1 AND user_id = $2 RETURNING code_id`,
                    [row.id, account]
                );
                if (!grant.rows.length) throw shopError('Сначала купите этот промокод в магазине.');
            }
            const left = row.usesLeft - 1;
            await client.query(
                `UPDATE vk_promo SET uses_left = $2, status = $3 WHERE id = $1`,
                [row.id, left, left > 0 ? 'open' : 'used']
            );
            return shown;
        });
    } catch (error) {
        return { ok: false, error: error && error.shop ? error.message : 'Промокод не применился.' };
    }
}

async function giveBack(id, userId) {
    const promoId = Math.round(Number(id) || 0);
    const account = accountOf(userId);
    if (!promoId) return;
    await database().pool.query(
        `UPDATE vk_promo SET uses_left = uses_left + 1, status = 'open' WHERE id = $1 AND status <> 'off'`,
        [promoId]
    );
    if (!account) return;
    await database().pool.query(
        `INSERT INTO vk_promo_grant (code_id, user_id)
         SELECT id, $2::bigint FROM vk_promo WHERE id = $1 AND shop_price > 0
         ON CONFLICT DO NOTHING`,
        [promoId, account]
    );
}

async function ownShopCode(userId) {
    const account = accountOf(userId);
    if (!account) return null;
    const res = await database().pool.query(
        `SELECT id, code, owner_id::text AS owner_id, package_id, percent, uses_left, source, shop_price, shop_stock, status
         FROM vk_promo WHERE source = 'shop' AND owner_id = $1`,
        [account]
    );
    return mapRow(res.rows[0]);
}

async function shopView(userId, groupId) {
    const account = accountOf(userId);
    const group = groupOf(groupId);
    const mine = await ownShopCode(account);
    const packs = catalog().listPackages();
    const offers = mine ? [] : packs.map(pkg => {
        const quote = discountOf(pkg.price);
        if (!quote) return null;
        return { packageId: pkg.id, title: pkg.title, credits: pkg.credits, bonuses: quote.bonuses, pay: quote.pay };
    }).filter(Boolean);
    const saleRes = await database().pool.query(
        `SELECT id, package_id, shop_price, shop_stock, uses_left
         FROM vk_promo
         WHERE group_id = $1 AND source = 'admin' AND shop_price > 0 AND shop_stock <> 0 AND status = 'open' AND uses_left > 0
         ORDER BY id DESC LIMIT 20`,
        [group]
    );
    const grantRes = account ? await database().pool.query(
        `SELECT p.id, p.code, p.package_id, p.status, p.uses_left
         FROM vk_promo_grant g
         JOIN vk_promo p ON p.id = g.code_id
         WHERE g.user_id = $1 AND p.group_id = $2
         ORDER BY p.id DESC LIMIT 20`,
        [account, group]
    ) : { rows: [] };
    const titleOf = id => {
        const pkg = id ? catalog().getPackage(id) : null;
        return pkg ? pkg.title : 'любой пакет';
    };
    return {
        mine: mine ? { code: mine.code, packageId: mine.packageId, title: titleOf(mine.packageId), status: mine.status, usesLeft: mine.usesLeft } : null,
        offers,
        sale: saleRes.rows.map(row => ({
            id: Number(row.id),
            title: titleOf(row.package_id),
            price: Number(row.shop_price) || 0,
            stock: Number(row.shop_stock)
        })),
        bought: grantRes.rows.map(row => ({
            id: Number(row.id),
            code: row.code,
            title: titleOf(row.package_id),
            status: row.status
        }))
    };
}

async function buyPersonal(userId, groupId, packageId) {
    const account = accountOf(userId);
    const group = groupOf(groupId);
    const pkg = catalog().getPackage(packageId);
    const quote = pkg && discountOf(pkg.price);
    if (!account || !group || !quote) return { ok: false, error: 'Этот пакет нельзя закрыть промокодом.' };
    const existing = await ownShopCode(account);
    if (existing) {
        if (existing.status === 'open' && existing.usesLeft > 0) {
            const owned = catalog().getPackage(existing.packageId);
            const kept = owned && discountOf(owned.price);
            return { ok: true, already: true, code: existing.code, title: owned ? owned.title : '', bonuses: 0, pay: kept ? kept.pay : 0 };
        }
        return { ok: false, error: 'Промокод из магазина уже был. Второй не выдаётся.' };
    }
    try {
        return await withTx(async client => {
            const again = await client.query(
                `SELECT code, status, uses_left FROM vk_promo WHERE source = 'shop' AND owner_id = $1 FOR UPDATE`,
                [account]
            );
            if (again.rows[0]) throw shopError('Промокод из магазина уже был. Второй не выдаётся.');
            const takes = await spendLots(client, account, group, quote.bonuses);
            if (!takes) throw shopError('Не хватает бонусов закрытых месяцев.');
            let inserted = null;
            for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
                const code = makeCode();
                const saved = await client.query(
                    `INSERT INTO vk_promo (group_id, code, owner_id, package_id, percent, uses_left, source, status)
                     VALUES ($1, $2, $3, $4, $5, 1, 'shop', 'open')
                     ON CONFLICT (code) DO NOTHING
                     RETURNING code`,
                    [group, code, account, pkg.id, PERCENT]
                );
                inserted = saved.rows[0];
            }
            if (!inserted) throw shopError('Код не собрался. Нажмите ещё раз.');
            return { ok: true, code: inserted.code, title: pkg.title, bonuses: quote.bonuses, pay: quote.pay };
        });
    } catch (error) {
        if (error && error.code === '23505') return { ok: false, error: 'Промокод из магазина уже был. Второй не выдаётся.' };
        return { ok: false, error: error && error.shop ? error.message : 'Промокод не оформился.' };
    }
}

async function buyListed(userId, groupId, codeId) {
    const account = accountOf(userId);
    const group = groupOf(groupId);
    const id = Math.round(Number(codeId) || 0);
    if (!account || !group || !id) return { ok: false, error: 'Промокод не найден.' };
    try {
        return await withTx(async client => {
            const found = await client.query(
                `SELECT id, code, package_id, shop_price, shop_stock, uses_left, status
                 FROM vk_promo
                 WHERE id = $1 AND group_id = $2 AND source = 'admin' FOR UPDATE`,
                [id, group]
            );
            const row = found.rows[0];
            if (!row || row.status !== 'open' || Number(row.uses_left) < 1 || !(Number(row.shop_price) > 0)) {
                throw shopError('Этого промокода нет в магазине.');
            }
            const owned = await client.query(
                `SELECT 1 FROM vk_promo_grant WHERE code_id = $1 AND user_id = $2`,
                [id, account]
            );
            if (owned.rows.length) return { ok: true, already: true, code: row.code, bonuses: 0 };
            if (Number(row.shop_stock) === 0) throw shopError('Промокоды закончились.');
            const takes = await spendLots(client, account, group, Number(row.shop_price));
            if (!takes) throw shopError('Не хватает бонусов закрытых месяцев.');
            if (Number(row.shop_stock) > 0) {
                const stock = await client.query(
                    `UPDATE vk_promo SET shop_stock = shop_stock - 1 WHERE id = $1 AND shop_stock > 0 RETURNING shop_stock`,
                    [id]
                );
                if (!stock.rows.length) throw shopError('Промокоды закончились.');
            }
            await client.query(
                `INSERT INTO vk_promo_grant (code_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [id, account]
            );
            return { ok: true, code: row.code, bonuses: Number(row.shop_price) };
        });
    } catch (error) {
        return { ok: false, error: error && error.shop ? error.message : 'Промокод не оформился.' };
    }
}

async function listAdmin(groupId) {
    const res = await database().pool.query(
        `SELECT id, code, owner_id::text AS owner_id, package_id, uses_left, source, shop_price, shop_stock, status
         FROM vk_promo WHERE group_id = $1
         ORDER BY id DESC LIMIT 40`,
        [groupOf(groupId)]
    );
    return res.rows.map(mapRow);
}

async function addAdmin(groupId, input) {
    const group = groupOf(groupId);
    const code = normalizeCode(input && input.code);
    const uses = Math.round(Number(input && input.uses) || 1);
    const price = Math.round(Number(input && input.price) || 0);
    const stockRaw = input && input.stock;
    const stock = price > 0 ? Math.round(Number(stockRaw) || uses) : 0;
    const packageId = String(input && input.packageId || '').trim();
    if (!group || code.length < 4) return { ok: false, error: 'Код — от 4 букв и цифр.' };
    if (uses < 1 || uses > 1000) return { ok: false, error: 'Укажите, сколько раз код можно применить.' };
    if (price < 0) return { ok: false, error: 'Цена в бонусах не подошла.' };
    if (packageId && !catalog().getPackage(packageId)) return { ok: false, error: 'Такого пакета нет.' };
    try {
        const saved = await database().pool.query(
            `INSERT INTO vk_promo (group_id, code, package_id, percent, uses_left, source, shop_price, shop_stock, status)
             VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, 'open')
             RETURNING id`,
            [group, code, packageId, PERCENT, uses, price, price > 0 ? stock : 0]
        );
        return { ok: true, id: Number(saved.rows[0].id), code };
    } catch (error) {
        if (error && error.code === '23505') return { ok: false, error: 'Такой код уже есть.' };
        return { ok: false, error: 'Код не сохранился.' };
    }
}

async function closeAdmin(groupId, id) {
    const res = await database().pool.query(
        `UPDATE vk_promo SET status = 'off', uses_left = 0
         WHERE id = $1 AND group_id = $2 AND status = 'open'
         RETURNING id`,
        [Math.round(Number(id) || 0), groupOf(groupId)]
    );
    return res.rows[0] ? { ok: true } : { ok: false, error: 'Код уже закрыт.' };
}

module.exports = {
    PERCENT, BONUS_RATE, discountOf, normalizeCode, decide, preview, canUse, take, giveBack,
    shopView, buyPersonal, buyListed, listAdmin, addAdmin, closeAdmin
};
