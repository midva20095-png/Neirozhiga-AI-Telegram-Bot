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
    const id = String(env.VK_APP_ID || '54901511').trim();
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

function row(kind, title, link, price) {
    const name = snippet(title).slice(0, 80);
    if (!name) return null;
    return { kind, title: name, text: '', link: link || '', price: price || '' };
}

function priceBits(line) {
    const cleaned = String(line || '').replace(/\s+/g, ' ').trim();
    const match = cleaned.match(/^(.*?)(\d[\d\s]{0,8})\s*(?:₽|руб\.?|р\.)\s*$/i)
        || cleaned.match(/^(.*?)[—–-]\s*(\d[\d\s]{1,6})\s*$/);
    if (!match) return null;
    const digits = String(match[2] || '').replace(/\D/g, '');
    if (!digits || Number(digits) < 50) return null;
    const name = String(match[1] || '').replace(/[:—–-]\s*$/, '').trim();
    if (name.length < 2 || name.length > 80) return null;
    return { name, price: digits };
}

function textRows(text, link) {
    const rows = [];
    let pending = '';
    String(text || '').split(/\n/).forEach((raw) => {
        const line = raw.replace(/https:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!line) {
            pending = '';
            return;
        }
        const priced = priceBits(line);
        if (priced) {
            rows.push(row('product', priced.name, link, priced.price));
            pending = '';
            return;
        }
        pending = line.length <= 60 ? line : '';
    });
    if (pending && /торт|капкейк|бенто|пирож|десерт|медовик|наполеон|услуг/i.test(pending)) {
        rows.push(row('service', pending, link, ''));
    }
    return rows.filter(Boolean);
}

async function tryCall(call, method, params) {
    try {
        return await call(method, params);
    } catch (error) {
        return null;
    }
}

function listOf(pack) {
    if (!pack) return [];
    if (Array.isArray(pack)) return pack;
    if (Array.isArray(pack.items)) return pack.items;
    return [];
}

async function readAlbums(id, call) {
    const items = [];
    const albums = listOf(await tryCall(call, 'photos.getAlbums', { owner_id: -id, count: 20 }));
    const queue = albums.filter((album) => album && !/фотографии со стены|сохранен|аватар/i.test(String(album.title || ''))).slice(0, 4);
    for (const album of queue) {
        const title = snippet(album.title).slice(0, 80);
        const link = `https://vk.com/album-${id}_${Number(album.id)}`;
        if (title) items.push(row('service', title, link, ''));
        const photos = listOf(await tryCall(call, 'photos.get', { owner_id: -id, album_id: album.id, count: 30, rev: 1 }));
        photos.forEach((photo) => items.push(...textRows(photo && photo.text, photoLink(photo, id))));
    }
    for (const albumId of ['wall', 'profile']) {
        const photos = listOf(await tryCall(call, 'photos.get', { owner_id: -id, album_id: albumId, count: 40, rev: 1 }));
        photos.forEach((photo) => items.push(...textRows(photo && photo.text, photoLink(photo, id))));
    }
    return dedupeRows(items).slice(0, 40);
}

async function readWall(id, call) {
    const wall = await tryCall(call, 'wall.get', { owner_id: -id, count: 20, filter: 'owner' });
    const items = [];
    listOf(wall).forEach((post) => {
        const page = `https://vk.com/wall-${id}_${Number(post && post.id)}`;
        items.push(...textRows(post && post.text, page));
        (post && post.attachments || []).forEach((attachment) => {
            if (!attachment || typeof attachment !== 'object') return;
            if (attachment.type === 'market' && attachment.market) {
                const market = attachment.market;
                const productId = Number(market.id);
                if (productId > 0) items.push(row('product', market.title || market.name, `https://vk.com/product-${id}_${productId}`, priceText(market.price).replace(/[^\d]/g, '')));
            }
            if (attachment.type === 'photo' && attachment.photo) {
                items.push(...textRows(attachment.photo.text, photoLink(attachment.photo, id)));
            }
        });
    });
    return dedupeRows(items).slice(0, 40);
}

async function readDocs(id, call) {
    const docs = listOf(await tryCall(call, 'docs.get', { owner_id: -id, count: 30 }));
    return dedupeRows(docs.map((doc) => {
        const title = snippet(doc && doc.title).slice(0, 80);
        if (!title) return null;
        const priced = priceBits(title);
        return row(priced ? 'product' : 'service', priced ? priced.name : title, `https://vk.com/doc-${id}_${Number(doc.id)}`, priced ? priced.price : '');
    })).slice(0, 40);
}

async function readMarket(id, call) {
    const market = await tryCall(call, 'market.get', { owner_id: -id, count: 50 });
    return dedupeRows(listOf(market).map((item) => row(
        'product',
        item && (item.title || item.name),
        `https://vk.com/product-${id}_${Number(item && item.id)}`,
        priceText(item && item.price).replace(/[^\d]/g, '')
    ))).slice(0, 40);
}

function photoLink(photo, groupId) {
    const photoId = Number(photo && photo.id);
    const owner = Math.abs(Number(photo && photo.owner_id) || Number(groupId));
    if (!photoId || !owner) return '';
    return `https://vk.com/photo-${owner}_${photoId}`;
}

function dedupeRows(items) {
    const seen = new Set();
    const rows = [];
    items.filter(Boolean).forEach((item) => {
        const mark = `${item.kind}|${item.title}|${item.link}`;
        if (seen.has(mark)) return;
        seen.add(mark);
        rows.push(item);
    });
    return rows;
}

async function openSection(groupId, phase, deps = {}) {
    const id = Number(groupId);
    if (!Number.isSafeInteger(id) || id <= 0) return [];
    const call = deps.call || await liveCall(deps);
    if (!call) return [];
    if (phase === 'albums') return readAlbums(id, call);
    if (phase === 'wall') return readWall(id, call);
    if (phase === 'docs') return readDocs(id, call);
    if (phase === 'market') return readMarket(id, call);
    return [];
}

module.exports = { communityGoods, openSection };
