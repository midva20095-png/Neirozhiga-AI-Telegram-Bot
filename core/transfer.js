const crypto = require('crypto');
const axios = require('axios');
const db = require('./db');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function siteBase() {
    return String(process.env.SITE_API_URL || 'https://neiroyaga-backend-production.up.railway.app').replace(/\/$/, '');
}

function transferKey() {
    return String(process.env.SITE_TRANSFER_KEY || '').trim();
}

function configured() {
    return !!transferKey();
}

function acceptKey(given) {
    const expected = transferKey();
    const got = String(given || '');
    if (!expected || got.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

async function postTransfer(body, key) {
    return axios.post(`${siteBase()}/api/telegram/transfer`, body, {
        timeout: 20000,
        validateStatus: () => true,
        headers: {
            'Content-Type': 'application/json',
            'X-Transfer-Key': key
        }
    });
}

function accepted(res) {
    return !!(res && res.status >= 200 && res.status < 300 && res.data && res.data.ok);
}

function siteError(res) {
    const data = res && res.data && typeof res.data === 'object' ? res.data : {};
    if (res && res.status === 404) return 'Сайт пока не принимает перенос. Кредиты возвращены в бот.';
    if (res && (res.status === 401 || res.status === 403)) return 'Перенос на сайт не включён. Кредиты возвращены в бот.';
    return data.error || 'Сайт не принял перевод. Кредиты возвращены в бот.';
}

async function callSite(body, key) {
    let res = null;
    try {
        res = await postTransfer(body, key);
        if (!accepted(res) && (!res || res.status >= 500)) res = await postTransfer(body, key);
        return res;
    } catch (e) {
        try { return await postTransfer(body, key); }
        catch (err) { return null; }
    }
}

// Списывает кредиты в боте и просит сайт начислить их на почту.
// Если сайт не подтвердил перевод, сумма возвращается на баланс бота.
async function transfer({ userId, email, credits }) {
    const mail = String(email || '').trim().toLowerCase().slice(0, 120);
    if (!EMAIL.test(mail)) return { ok: false, error: 'Укажите почту, с которой вы входите на сайте' };
    const amount = Math.round(Number(credits));
    if (!(amount > 0) || amount > 1000000) return { ok: false, error: 'Укажите, сколько кредитов перенести' };
    const key = transferKey();
    if (!key) {
        console.error('Перенос на сайт выключен: задайте одинаковый SITE_TRANSFER_KEY на боте и на сайте');
        return { ok: false, error: 'Перенос на сайт ещё не включён. Напишите в поддержку.' };
    }

    const transferId = crypto.randomUUID();
    const debit = await db.debitBalance(userId, amount, `Перенос на сайт · ${mail}`);
    if (!debit.ok) return { ok: false, error: 'Недостаточно кредитов' };

    const res = await callSite({
        email: mail,
        credits: amount,
        transferId,
        telegramUserId: String(userId)
    }, key);

    if (accepted(res)) {
        return {
            ok: true,
            balance: debit.balance,
            siteCredits: res.data.credits,
            email: mail,
            credits: amount
        };
    }

    const back = await db.updateBalance(userId, amount, `Возврат переноса · ${mail}`);
    return {
        ok: false,
        error: res ? siteError(res) : 'Сайт не ответил. Кредиты возвращены в бот.',
        balance: back
    };
}

const PENDING_GRACE_MS = 2 * 60 * 1000;
const inflight = new Set();

function postJson(path, body, key) {
    return axios.post(`${siteBase()}${path}`, body, {
        timeout: 20000,
        validateStatus: () => true,
        headers: {
            'Content-Type': 'application/json',
            'X-Transfer-Key': key
        }
    });
}

function sitePullError(res) {
    const data = res && res.data && typeof res.data === 'object' ? res.data : {};
    if (res && res.status === 404) return 'Сайт пока не отдаёт кредиты в бот. На сайте ничего не списано.';
    if (res && (res.status === 401 || res.status === 403)) return 'Перенос с сайта не включён. На сайте ничего не списано.';
    return data.error || 'Сайт не отдал кредиты. На сайте ничего не списано.';
}

async function callJson(path, body) {
    const key = transferKey();
    if (!key) return null;
    let res = null;
    try {
        res = await postJson(path, body, key);
        if (!accepted(res) && (!res || res.status >= 500)) res = await postJson(path, body, key);
        return res;
    } catch (e) {
        try { return await postJson(path, body, key); }
        catch (err) { return null; }
    }
}

async function siteBalance({ email, password }) {
    const mail = String(email || '').trim().toLowerCase().slice(0, 120);
    if (!EMAIL.test(mail)) return { ok: false, error: 'Укажите почту, с которой вы входите на сайте' };
    const secret = String(password || '');
    if (secret.length < 4 || secret.length > 200) return { ok: false, error: 'Введите пароль от кабинета на сайте' };
    if (!transferKey()) return { ok: false, error: 'Перенос с сайта ещё не включён. Напишите в поддержку.' };
    const res = await callJson('/api/telegram/balance', { email: mail, password: secret });
    if (accepted(res)) return { ok: true, credits: Number(res.data.credits) || 0 };
    return { ok: false, error: res ? sitePullError(res) : 'Сайт не ответил. Попробуйте ещё раз.' };
}

// Дозавершает списание, которое сайт уже подтвердил, а бот не успел начислить.
// Новый перевод при этом не создаётся.
async function resumePending(userId) {
    let rows = [];
    try {
        rows = await db.listPendingPulls(userId);
    } catch (e) {
        console.error('Перенос с сайта, список незавершённых:', e.message);
        return { credited: false, blocked: true };
    }
    let credited = null;
    for (const row of rows) {
        if (inflight.has(row.id)) return credited ? { credited: true, ...credited } : { credited: false, blocked: true };
        if (row.status === 'refunding') {
            const refund = await callJson('/api/telegram/pull/refund', { transferId: row.id });
            if (accepted(refund)) {
                await db.markSitePull(row.id, 'refunded', 'refunding');
                continue;
            }
            return credited ? { credited: true, ...credited } : { credited: false, blocked: true };
        }
        const res = await callJson('/api/telegram/pull', {
            email: row.email,
            credits: Number(row.credits),
            transferId: row.id,
            telegramUserId: String(row.user_id)
        });
        if (accepted(res)) {
            const done = await db.creditSitePull({
                id: row.id,
                userId: row.user_id,
                credits: Number(row.credits),
                email: row.email
            });
            if (done && done.ok) {
                credited = {
                    balance: done.balance,
                    email: row.email,
                    credits: Number(row.credits),
                    siteCredits: res.data.credits
                };
                continue;
            }
            const claimed = await db.markSitePull(row.id, 'refunding');
            if (!claimed) continue;
            const refund = await callJson('/api/telegram/pull/refund', { transferId: row.id });
            if (accepted(refund)) {
                await db.markSitePull(row.id, 'refunded', 'refunding');
                continue;
            }
            await db.markSitePull(row.id, 'pending', 'refunding');
            return credited ? { credited: true, ...credited } : { credited: false, blocked: true };
        }
        if (!res || res.status >= 500) {
            return credited ? { credited: true, ...credited } : { credited: false, blocked: true };
        }
        const data = res.data && typeof res.data === 'object' ? res.data : {};
        if (data.refunded) {
            await db.markSitePull(row.id, 'failed');
            continue;
        }
        if (data.missing) {
            const created = row.created_at ? new Date(row.created_at).getTime() : 0;
            if (!created || Date.now() - created < PENDING_GRACE_MS) {
                return credited ? { credited: true, ...credited } : { credited: false, blocked: true };
            }
            await db.markSitePull(row.id, 'failed');
            continue;
        }
        await db.markSitePull(row.id, 'failed');
    }
    if (credited) return { credited: true, ...credited };
    return { credited: false, blocked: false };
}

// Списывает кредиты на сайте и начисляет их в боте.
// Пароль нужен, чтобы с чужой почты нельзя было забрать баланс. Бот его не хранит.
// Если сайт списал, а бот не начислил — повтор того же перевода доначислит без второго списания.
async function transferFromSite({ userId, email, password, credits }) {
    const mail = String(email || '').trim().toLowerCase().slice(0, 120);
    if (!EMAIL.test(mail)) return { ok: false, error: 'Укажите почту, с которой вы входите на сайте' };
    const secret = String(password || '');
    if (secret.length < 4 || secret.length > 200) return { ok: false, error: 'Введите пароль от кабинета на сайте' };
    const amount = Math.round(Number(credits));
    if (!(amount > 0) || amount > 1000000) return { ok: false, error: 'Укажите, сколько кредитов перенести' };
    if (!transferKey()) {
        console.error('Перенос с сайта выключен: задайте одинаковый SITE_TRANSFER_KEY на боте и на сайте');
        return { ok: false, error: 'Перенос с сайта ещё не включён. Напишите в поддержку.' };
    }

    const resumed = await resumePending(userId);
    if (resumed.credited) {
        return {
            ok: true,
            balance: resumed.balance,
            siteCredits: resumed.siteCredits,
            email: resumed.email,
            credits: resumed.credits
        };
    }
    if (resumed.blocked) {
        return { ok: false, error: 'Прошлый перенос ещё подтверждается. Повторите через минуту — второй раз ту же сумму не спишем.' };
    }

    const transferId = crypto.randomUUID();
    inflight.add(transferId);
    try {
        const saved = await db.insertSitePull({ id: transferId, userId, email: mail, credits: amount });
        if (!saved || !saved.ok) return { ok: false, error: 'Не удалось начать перенос. Попробуйте ещё раз.' };

        const res = await callJson('/api/telegram/pull', {
            email: mail,
            password: secret,
            credits: amount,
            transferId,
            telegramUserId: String(userId)
        });
        if (!accepted(res)) {
            if (!res || res.status >= 500) {
                return { ok: false, error: 'Сайт не ответил. Если кредиты уже списались, повторите перенос — начислим их без второго списания.' };
            }
            await db.markSitePull(transferId, 'failed');
            return { ok: false, error: res ? sitePullError(res) : 'Сайт не ответил. На сайте ничего не списано.' };
        }

        const done = await db.creditSitePull({ id: transferId, userId, credits: amount, email: mail });
        if (!done || !done.ok) {
            const claimed = await db.markSitePull(transferId, 'refunding');
            if (!claimed) {
                const again = await db.creditSitePull({ id: transferId, userId, credits: amount, email: mail });
                if (again && again.ok) {
                    return {
                        ok: true,
                        balance: again.balance,
                        siteCredits: res.data.credits,
                        email: mail,
                        credits: amount
                    };
                }
                return { ok: false, error: 'Кредиты списаны на сайте, но в бот пока не пришли. Повторите перенос — начислим без второго списания.' };
            }
            const refund = await callJson('/api/telegram/pull/refund', { transferId });
            if (accepted(refund)) {
                await db.markSitePull(transferId, 'refunded', 'refunding');
                return { ok: false, error: 'Не удалось начислить кредиты в бот. Сумма возвращена на сайт.' };
            }
            await db.markSitePull(transferId, 'pending', 'refunding');
            return { ok: false, error: 'Кредиты списаны на сайте, но в бот пока не пришли. Повторите перенос — начислим без второго списания.' };
        }
        return {
            ok: true,
            balance: done.balance,
            siteCredits: res.data.credits,
            email: mail,
            credits: amount
        };
    } finally {
        inflight.delete(transferId);
    }
}

module.exports = { transfer, transferFromSite, siteBalance, resumePending, configured, acceptKey, siteBase };
