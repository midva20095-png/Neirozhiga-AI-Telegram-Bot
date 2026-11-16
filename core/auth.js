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

function decodeLaunchPart(value) {
    try { return decodeURIComponent(String(value || '').replace(/\+/g, '%20')); }
    catch (e) { return String(value || ''); }
}

const VK_APP_ID = '54901511';

function sameApp(value) {
    return String(value || '') === VK_APP_ID;
}

// Строка запуска как в адресе мини-приложения: vk_user_id=1&sign=...
function verifyVkLaunchString(search) {
    const secret = String(process.env.VK_APP_SECRET || '').trim();
    const query = String(search || '').replace(/^\?/, '');
    if (!secret || !query) return null;
    let sign = '';
    const params = [];
    for (const part of query.split('&')) {
        if (!part) continue;
        const eq = part.indexOf('=');
        const key = decodeLaunchPart(eq < 0 ? part : part.slice(0, eq));
        const rawValue = eq < 0 ? '' : part.slice(eq + 1);
        if (key === 'sign') sign = decodeLaunchPart(rawValue);
        else if (key.startsWith('vk_')) params.push({ key, value: decodeLaunchPart(rawValue) });
    }
    if (!sign) return null;
    params.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const expected = crypto.createHmac('sha256', secret).update(params.map(item => `${item.key}=${item.value}`).join('&')).digest('base64url');
    const actual = sign.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (!safeEqual(expected, actual)) return null;
    const app = params.find(item => item.key === 'vk_app_id');
    if (!app || !sameApp(app.value)) return null;
    const user = params.find(item => item.key === 'vk_user_id');
    const id = Number(user && user.value);
    if (!Number.isInteger(id) || id <= 0) return null;
    return String(-id);
}

// Подпись параметров запуска мини-приложения ВК. Секрет — защищённый ключ приложения.
function verifyVkLaunch(input) {
    if (typeof input === 'string') return verifyVkLaunchString(input);
    if (!input || typeof input !== 'object') return null;
    if (typeof input.launch === 'string' && input.launch.indexOf('sign=') >= 0) return verifyVkLaunchString(input.launch);
    const secret = String(process.env.VK_APP_SECRET || '').trim();
    if (!secret) return null;
    const sign = String(input.sign || '');
    if (!sign) return null;
    const pairs = Object.keys(input)
        .filter(key => key.startsWith('vk_'))
        .sort()
        .map(key => {
            const raw = Array.isArray(input[key]) ? input[key][0] : input[key];
            return `${key}=${raw == null ? '' : String(raw)}`;
        });
    const expected = crypto.createHmac('sha256', secret).update(pairs.join('&')).digest('base64url');
    const actual = sign.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (!safeEqual(expected, actual)) return null;
    if (!sameApp(input.vk_app_id)) return null;
    const id = Number(input.vk_user_id);
    if (!Number.isInteger(id) || id <= 0) return null;
    return String(-id);
}

let vkServiceCache = { token: '', until: 0 };

async function vkServiceToken(fetchImpl) {
    const secret = String(process.env.VK_APP_SECRET || '').trim();
    if (!secret) return '';
    if (!fetchImpl && vkServiceCache.token && vkServiceCache.until > Date.now()) return vkServiceCache.token;
    const fetchFn = fetchImpl || fetch;
    const body = new URLSearchParams({
        client_id: VK_APP_ID,
        client_secret: secret,
        grant_type: 'client_credentials',
        v: '5.199'
    });
    for (const url of ['https://oauth.vk.ru/access_token', 'https://oauth.vk.com/access_token']) {
        try {
            const res = await fetchFn(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString()
            });
            const data = await res.json();
            const token = data && data.access_token ? String(data.access_token) : '';
            if (!token) continue;
            if (!fetchImpl) {
                const expires = Number(data.expires_in);
                const ttl = expires > 60 ? (expires - 60) * 1000 : 12 * 3600 * 1000;
                vkServiceCache = { token, until: Date.now() + ttl };
            }
            return token;
        } catch (error) {}
    }
    return '';
}

// Пользовательский ключ принимается только если его выпустило приложение 54901511.
async function vkUserForAppToken(access, fetchImpl) {
    const service = await vkServiceToken(fetchImpl);
    if (!service) return null;
    const fetchFn = fetchImpl || fetch;
    try {
        const url = 'https://api.vk.ru/method/secure.checkToken?' + new URLSearchParams({
            token: String(access || ''),
            access_token: service,
            v: '5.199'
        });
        const data = await (await fetchFn(url)).json();
        const row = data && data.response;
        const id = Number(row && row.user_id);
        if (!row || Number(row.success) !== 1 || !Number.isInteger(id) || id <= 0) return null;
        return String(-id);
    } catch (error) {
        return null;
    }
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
    vkUserForAppToken,
    issueAdminToken,
    verifyAdminToken,
    checkAdminPassword
};
