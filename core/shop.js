const activity = require('./activity');

function database() {
    return require('./db');
}

function groupOf(groupId) {
    return String(groupId || '').replace(/\D/g, '');
}

function accountOf(userId) {
    return activity.ratingAccount(userId);
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

async function closeMonth(groupId, range, rows) {
    const group = groupOf(groupId);
    if (!group || !range || !(range.end instanceof Date) || range.end.getTime() > Date.now()) return { closed: false };
    const list = (Array.isArray(rows) ? rows : []).filter(row => Math.round(Number(row.points) || 0) > 0 && accountOf(row.userId || row.user_id));
    if (!list.length) return { closed: false };
    const month = range.start.toISOString().slice(0, 10);
    const pool = database().pool;
    for (let index = 0; index < Math.min(10, list.length); index++) {
        const row = list[index];
        await pool.query(
            `INSERT INTO vk_honor (group_id, month, place, user_id, name, points)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (group_id, month, place) DO NOTHING`,
            [group, month, index + 1, accountOf(row.userId || row.user_id), String(row.name || 'Ученик').slice(0, 80), Math.round(Number(row.points) || 0)]
        );
    }
    for (const row of list) {
        await pool.query(
            `INSERT INTO vk_bonus (user_id, group_id, month, points)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, group_id, month) DO NOTHING`,
            [accountOf(row.userId || row.user_id), group, month, Math.round(Number(row.points) || 0)]
        );
    }
    return { closed: true, month, people: list.length };
}

async function listHonor(groupId) {
    const res = await database().pool.query(
        `SELECT month, place, user_id::text AS user_id, name, points
         FROM vk_honor WHERE group_id = $1
         ORDER BY month DESC, place
         LIMIT 40`,
        [groupOf(groupId)]
    );
    return res.rows.map(row => ({
        place: Number(row.place),
        userId: String(row.user_id),
        name: row.name,
        points: Number(row.points) || 0,
        at: row.month instanceof Date ? row.month.toISOString().slice(0, 10) : String(row.month).slice(0, 10)
    }));
}

async function bonusBalance(userId, groupId, before) {
    const account = accountOf(userId);
    const group = groupOf(groupId);
    if (!account || !group || !(before instanceof Date)) return 0;
    const res = await database().pool.query(
        `SELECT COALESCE(SUM(points - spent), 0)::int AS free
         FROM vk_bonus
         WHERE user_id = $1 AND group_id = $2 AND month < $3::date`,
        [account, group, before.toISOString().slice(0, 10)]
    );
    return Number(res.rows[0] && res.rows[0].free) || 0;
}

async function listItems(groupId, onlyVisible) {
    const visible = onlyVisible ? 'AND visible = TRUE AND stock <> 0' : '';
    const res = await database().pool.query(
        `SELECT id, title, body, price, stock, photo, visible
         FROM vk_shop_item WHERE group_id = $1 ${visible}
         ORDER BY id DESC LIMIT 40`,
        [groupOf(groupId)]
    );
    return res.rows.map(row => ({
        id: Number(row.id),
        title: row.title,
        body: row.body || '',
        price: Number(row.price) || 0,
        stock: Number(row.stock),
        photo: row.photo || '',
        visible: !!row.visible
    }));
}

function cleanPhoto(photo) {
    const value = String(photo || '');
    if (!value) return '';
    if (/^https:\/\/\S+$/i.test(value) && value.length <= 400) return value;
    if (/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=\s]+$/.test(value) && value.length <= 550000) return value;
    const error = new Error('Картинка не подошла. Нужна ссылка https или снимок до 400 КБ.');
    error.code = 'photo';
    throw error;
}

async function saveItem(groupId, input) {
    const group = groupOf(groupId);
    const title = String(input && input.title || '').trim().slice(0, 80);
    const body = String(input && input.body || '').trim().slice(0, 400);
    const price = Math.round(Number(input && input.price) || 0);
    const stockRaw = input && input.stock;
    const stock = stockRaw === '' || stockRaw == null ? -1 : Math.round(Number(stockRaw));
    const photo = cleanPhoto(input && input.photo);
    const visible = !(input && input.visible === false);
    if (!group || !title || price <= 0 || !Number.isFinite(stock)) {
        return { ok: false, error: 'Нужны название и цена в бонусах.' };
    }
    const id = Math.round(Number(input && input.id) || 0);
    if (id > 0) {
        const res = await database().pool.query(
            `UPDATE vk_shop_item
             SET title = $3, body = $4, price = $5, stock = $6, photo = $7, visible = $8
             WHERE id = $1 AND group_id = $2
             RETURNING id`,
            [id, group, title, body, price, stock, photo, visible]
        );
        if (!res.rows.length) return { ok: false, error: 'Товар не найден.' };
        return { ok: true, id };
    }
    const res = await database().pool.query(
        `INSERT INTO vk_shop_item (group_id, title, body, price, stock, photo, visible)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [group, title, body, price, stock, photo, visible]
    );
    return { ok: true, id: Number(res.rows[0].id) };
}

async function spendLots(client, userId, groupId, amount) {
    const lots = await client.query(
        `SELECT month, points, spent FROM vk_bonus
         WHERE user_id = $1 AND group_id = $2 AND points > spent
         ORDER BY month
         FOR UPDATE`,
        [userId, groupId]
    );
    const takes = activity.planSpend(lots.rows, amount);
    if (!takes) return null;
    for (const take of takes) {
        const updated = await client.query(
            `UPDATE vk_bonus SET spent = spent + $4
             WHERE user_id = $1 AND group_id = $2 AND month = $3::date AND points - spent >= $4`,
            [userId, groupId, take.month, take.amount]
        );
        if (!updated.rowCount) return null;
    }
    return takes;
}

function shopError(message) {
    const error = new Error(message);
    error.shop = true;
    return error;
}

async function placeOrder(client, group, userId, item, kind, bonuses, credits, title) {
    const takes = await spendLots(client, userId, group, bonuses);
    if (!takes) throw shopError('Не хватает бонусов закрытых месяцев.');
    if (item && Number(item.stock) > 0) {
        const stock = await client.query(
            `UPDATE vk_shop_item SET stock = stock - 1 WHERE id = $1 AND group_id = $2 AND stock > 0 RETURNING stock`,
            [item.id, group]
        );
        if (!stock.rows.length) throw shopError('Товар закончился.');
    }
    const order = await client.query(
        `INSERT INTO vk_shop_order (group_id, user_id, item_id, title, kind, bonuses, credits, takes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id`,
        [group, userId, item ? item.id : null, title, kind, bonuses, credits, JSON.stringify(takes)]
    );
    return { ok: true, id: Number(order.rows[0].id), bonuses, credits, title };
}

async function buyItem(userId, groupId, itemId) {
    const group = groupOf(groupId);
    const account = accountOf(userId);
    const id = Math.round(Number(itemId) || 0);
    if (!group || !account || !id) return { ok: false, error: 'Товар не найден.' };
    return withTx(async client => {
        const found = await client.query(
            `SELECT id, title, price, stock, visible FROM vk_shop_item WHERE id = $1 AND group_id = $2 FOR UPDATE`,
            [id, group]
        );
        const item = found.rows[0];
        if (!item || !item.visible || Number(item.stock) === 0) throw shopError('Товара нет в магазине.');
        return placeOrder(client, group, account, item, 'good', Number(item.price), 0, item.title);
    }).catch(error => {
        if (error && error.shop) return { ok: false, error: error.message };
        return { ok: false, error: 'Заказ не оформился.' };
    });
}

async function askCredits(userId, groupId, bonuses) {
    const group = groupOf(groupId);
    const account = accountOf(userId);
    const quote = activity.quoteCredits(bonuses);
    if (!group || !account) return { ok: false, error: 'Магазин этого сообщества недоступен.' };
    if (quote.credits < 1) return { ok: false, error: 'Нужно не меньше 10 бонусов на 1 кредит.' };
    let result;
    try {
        result = await withTx(client => placeOrder(client, group, account, null, 'credit', quote.spend, quote.credits, 'Кредиты'));
    } catch (error) {
        return { ok: false, error: error && error.shop ? error.message : 'Заявка не оформилась.' };
    }
    if (result.ok) {
        database().note('shop', `Магазин ${group}: заявка ${quote.credits} кр., бонусы ${quote.spend}, человек ${account}`).catch(() => {});
        return Object.assign(result, quote);
    }
    return result;
}

async function listOrders(groupId) {
    const res = await database().pool.query(
        `SELECT id, user_id::text AS user_id, title, kind, bonuses, credits, status, created_at
         FROM vk_shop_order WHERE group_id = $1
         ORDER BY id DESC LIMIT 40`,
        [groupOf(groupId)]
    );
    return res.rows.map(row => ({
        id: Number(row.id),
        userId: String(row.user_id),
        title: row.title,
        kind: row.kind,
        bonuses: Number(row.bonuses) || 0,
        credits: Number(row.credits) || 0,
        status: row.status,
        at: row.created_at
    }));
}

async function cancelOrder(groupId, orderId) {
    const group = groupOf(groupId);
    const id = Math.round(Number(orderId) || 0);
    return withTx(async client => {
        const found = await client.query(
            `SELECT id, user_id, item_id, takes, status FROM vk_shop_order
             WHERE id = $1 AND group_id = $2 FOR UPDATE`,
            [id, group]
        );
        const order = found.rows[0];
        if (!order || order.status !== 'new') return { ok: false, error: 'Заявку уже закрыли.' };
        const takes = Array.isArray(order.takes) ? order.takes : [];
        for (const take of takes) {
            await client.query(
                `UPDATE vk_bonus SET spent = GREATEST(0, spent - $4)
                 WHERE user_id = $1 AND group_id = $2 AND month = $3::date`,
                [String(order.user_id), group, String(take.month).slice(0, 10), Math.round(Number(take.amount) || 0)]
            );
        }
        if (order.item_id) {
            await client.query(
                `UPDATE vk_shop_item SET stock = stock + 1 WHERE id = $1 AND group_id = $2 AND stock >= 0`,
                [order.item_id, group]
            );
        }
        await client.query(`UPDATE vk_shop_order SET status = 'cancelled' WHERE id = $1`, [id]);
        return { ok: true };
    });
}

async function finishOrder(groupId, orderId) {
    const res = await database().pool.query(
        `UPDATE vk_shop_order SET status = 'done'
         WHERE id = $1 AND group_id = $2 AND status = 'new' AND kind = 'good'
         RETURNING id, user_id::text AS user_id, title`,
        [Math.round(Number(orderId) || 0), groupOf(groupId)]
    );
    return res.rows[0] ? { ok: true, order: res.rows[0] } : { ok: false, error: 'Заказ уже закрыт.' };
}

async function takeCreditOrder(groupId, orderId) {
    const res = await database().pool.query(
        `UPDATE vk_shop_order SET status = 'done'
         WHERE id = $1 AND group_id = $2 AND status = 'new' AND kind = 'credit'
         RETURNING id, user_id::text AS user_id, credits, bonuses`,
        [Math.round(Number(orderId) || 0), groupOf(groupId)]
    );
    if (!res.rows[0]) return { ok: false, error: 'Заявку уже закрыли.' };
    return { ok: true, order: { id: Number(res.rows[0].id), userId: String(res.rows[0].user_id), credits: Number(res.rows[0].credits) || 0, bonuses: Number(res.rows[0].bonuses) || 0 } };
}

async function reopenOrder(orderId) {
    await database().pool.query(`UPDATE vk_shop_order SET status = 'new' WHERE id = $1 AND status = 'done'`, [Math.round(Number(orderId) || 0)]);
}

module.exports = {
    closeMonth, listHonor, bonusBalance, listItems, saveItem, buyItem, askCredits, listOrders,
    cancelOrder, finishOrder, takeCreditOrder, reopenOrder
};
