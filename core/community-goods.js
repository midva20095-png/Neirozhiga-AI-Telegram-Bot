const cache = new Map();
const tokenCache = { token: '', until: 0 };

function snippet(value) {
    if (typeof value !== 'string') return '';
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text || /access_token|vk1\./i.test(text)) return '';
    return text.slice(0, 160);
}

function priceText(price) {
    if (!price || typeof price !== 'object') return '';
    if (typeof price.text === 'string' && price.text.trim()) return snippet(price.text).slice(0, 40);
    const amount = Number(price.amount);
    if (!Number.isFinite(amount)) return '';
    const value = amount / 100;
    return `${Number.isInteger(value) ? String(value) : value.toFixed(2)} ₽`;
}

function productLine(item, groupId) {
    if (!item || typeof item !== 'object') return '';
    const id = Number(item.id ?? item.item_id);
    if (!Number.isSafeInteger(id) || id <= 0) return '';
    const rawOwner = Number(item.owner_id);
    const own = !Number.isSafeInteger(rawOwner) || rawOwner === -groupId || rawOwner === groupId;
    if (!own) return '';
    const title = snippet(item.title) || snippet(item.name);
    if (!title) return '';
    const price = priceText(item.price);
    const stock = item.availability === 2 ? 'нет в наличии' : '';
    const bits = [title, price, stock].filter(Boolean).join(', ');
    return `Товар: ${bits} — https://vk.com/product-${groupId}_${id}`;
}

function linesFrom(items, groupId) {
    const lines = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
        const line = productLine(item, groupId);
        if (!line || seen.has(line)) continue;
        seen.add(line);
        lines.push(line);
        if (lines.length >= 8) break;
    }
    return lines.join('\n').slice(0, 1200);
}

function packOf(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.response && typeof data.response === 'object') return data.response;
    return data;
}

async function read(id, call) {
    let market = null;
    try {
        market = packOf(await call('market.get', { owner_id: -id, count: 50 }));
    } catch (error) {
        market = null;
    }
    const direct = linesFrom(market && market.items, id);
    if (direct) return direct;
    let wall = null;
    try {
        wall = packOf(await call('wall.get', { owner_id: -id, count: 20, filter: 'owner' }));
    } catch (error) {
        wall = null;
    }
    const attached = [];
    for (const post of (wall && wall.items) || []) {
        for (const item of (post && post.attachments) || []) {
            if (item && item.type === 'market' && item.market) attached.push(item.market);
        }
    }
    return linesFrom(attached, id);
}

async function appToken(env, post) {
    if (tokenCache.token && tokenCache.until > Date.now()) return tokenCache.token;
    const id = String(env.VK_APP_ID || '').trim();
    const secret = String(env.VK_APP_SECRET || '').trim();
    if (!id || !secret) return '';
    const body = new URLSearchParams({
        client_id: id,
        client_secret: secret,
        grant_type: 'client_credentials',
        v: '5.199'
    });
    for (const url of ['https://oauth.vk.com/access_token', 'https://oauth.vk.ru/access_token']) {
        try {
            const data = await post(url, body);
            const token = data && data.access_token;
            if (!token) continue;
            const expires = Number(data.expires_in);
            const ttl = expires > 60 ? expires - 60 : 12 * 3600;
            tokenCache.token = token;
            tokenCache.until = Date.now() + ttl * 1000;
            return token;
        } catch (error) {}
    }
    return '';
}

async function vkMethod(method, params, token) {
    const body = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value != null) body.set(key, String(value));
    });
    body.set('access_token', token);
    body.set('v', '5.199');
    const response = await fetch(`https://api.vk.com/method/${method}`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (data && data.error) {
        const error = new Error('vk');
        error.code = data.error.error_code;
        throw error;
    }
    return data && data.response;
}

async function communityGoods(groupId, deps = {}) {
    const id = Number(groupId);
    if (!Number.isSafeInteger(id) || id <= 0) return '';
    const now = typeof deps.now === 'function' ? deps.now() : Date.now();
    if (!deps.call) {
        const hit = cache.get(id);
        if (hit && now - hit.at < 45_000) return hit.text;
    }
    const call = deps.call || await liveCall(deps);
    if (!call) return '';
    const text = await read(id, call);
    if (!deps.call) cache.set(id, { at: now, text });
    return text;
}

async function liveCall(deps) {
    const env = deps.env || process.env;
    const post = deps.post || (async (url, body) => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            signal: AbortSignal.timeout(15000)
        });
        return response.json();
    });
    const token = await appToken(env, post);
    if (!token) return null;
    return (method, params) => vkMethod(method, params, token);
}

module.exports = { communityGoods };
