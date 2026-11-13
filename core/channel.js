const db = require('./db');
const auth = require('./auth');

const CHANNEL = '@neuroyaga_AI';
const CHANNEL_URL = 'https://t.me/neuroyaga_AI';
const CACHE_MS = 3 * 60 * 1000;

const cache = new Map();
let brokenNoted = false;

function memberOk(member) {
    if (!member) return false;
    const status = member.status;
    if (status === 'creator' || status === 'administrator' || status === 'member') return true;
    if (status === 'restricted') return !!member.is_member;
    return false;
}

async function subscribed(telegram, userId) {
    if (auth.isAdminId(userId)) return { ok: true };
    const key = String(userId);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit;
    try {
        const member = await telegram.getChatMember(CHANNEL, userId);
        const result = { ok: memberOk(member), at: Date.now() };
        cache.set(key, result);
        return result;
    } catch (e) {
        if (!brokenNoted) {
            brokenNoted = true;
            db.note('sys', 'Проверка канала не сработала. Бот должен быть администратором @neuroyaga_AI.').catch(() => {});
        }
        return { ok: true, broken: true };
    }
}

function clear(userId) {
    cache.delete(String(userId));
}

module.exports = { CHANNEL, CHANNEL_URL, memberOk, subscribed, clear };
