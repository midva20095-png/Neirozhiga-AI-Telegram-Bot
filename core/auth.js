const crypto = require('crypto');

const INIT_DATA_MAX_AGE_SEC = 7 * 24 * 3600;
const ADMIN_TOKEN_TTL_SEC = 7 * 24 * 3600;

let fallbackSecret = null;

function botToken() {
    return process.env.BOT_TOKEN || '';
}

function secretBase() {
    const base = botToken() || process.env.ADMIN_PASSWORD;
    if (base) return base;
    if (!fallbackSecret) fallbackSecret = crypto.randomBytes(32).toString('hex');
    return fallbackSecret;
}

function hmac(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function adminIds() {
    return String(process.env.ADMIN_IDS || process.env.ADMIN_ID || '5943987954')
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function isAdminId(userId) {
    return userId !== undefined && userId !== null && adminIds().includes(String(userId));
}

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function validateInitData(initData) {
    const token = botToken();
    if (!initData || !token) return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const checkString = [...params.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
    const secret = hmac('WebAppData', token);
    const expected = hmac(secret, checkString).toString('hex');
    if (!safeEqual(expected, hash)) return null;
    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SEC) return null;
    try {
        const user = JSON.parse(params.get('user') || 'null');
        if (!user || !user.id) return null;
        return user;
    } catch (e) {
        return null;
    }
}

// Кнопка web_app в обычной клавиатуре открывает Mini App с пустым initData,
// поэтому в её ссылку кладём подписанный идентификатор пользователя.
function signUserId(userId) {
    const sig = hmac(`link:${secretBase()}`, String(userId)).toString('base64url').slice(0, 32);
    return `${userId}.${sig}`;
}

function verifyUserToken(token) {
    const m = /^(-?\d{1,20})\.([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
    if (!m) return null;
    return safeEqual(signUserId(m[1]), token) ? m[1] : null;
}

// Подпись параметров запуска мини-приложения ВК. Секрет — защищённый ключ приложения.
function verifyVkLaunch(input) {
    const secret = String(process.env.VK_APP_SECRET || '').trim();
    if (!secret || !input || typeof input !== 'object') return null;
    const sign = String(input.sign || '');
    if (!sign) return null;
    const pairs = Object.keys(input)
        .filter(key => key.startsWith('vk_'))
        .sort()
        .map(key => `${key}=${Array.isArray(input[key]) ? input[key][0] : input[key]}`);
    const expected = crypto.createHmac('sha256', secret).update(pairs.join('&')).digest('base64url');
    if (!safeEqual(expected, sign.replace(/=+$/, ''))) return null;
    const id = Number(input.vk_user_id);
    if (!Number.isInteger(id) || id <= 0) return null;
    return String(-id);
}

function issueAdminToken(subject) {
    const exp = Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL_SEC;
    const body = Buffer.from(JSON.stringify({ sub: String(subject), exp })).toString('base64url');
    const sig = hmac(`admin:${secretBase()}`, body).toString('base64url');
    return `${body}.${sig}`;
}

function verifyAdminToken(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = hmac(`admin:${secretBase()}`, body).toString('base64url');
    if (!safeEqual(expected, sig)) return null;
    try {
        const data = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (!data.exp || data.exp < Date.now() / 1000) return null;
        if (data.sub !== 'password' && !isAdminId(data.sub)) return null;
        return data;
    } catch (e) {
        return null;
    }
}

function checkAdminPassword(password) {
    const expected = process.env.ADMIN_PASSWORD || 'admin123';
    if (!expected || !password) return false;
    return safeEqual(hmac('pw', String(password)).toString('hex'), hmac('pw', expected).toString('hex'));
}

module.exports = {
    adminIds,
    isAdminId,
    validateInitData,
    signUserId,
    verifyUserToken,
    verifyVkLaunch,
    issueAdminToken,
    verifyAdminToken,
    checkAdminPassword
};
