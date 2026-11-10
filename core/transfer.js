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

module.exports = { transfer, configured, siteBase };
