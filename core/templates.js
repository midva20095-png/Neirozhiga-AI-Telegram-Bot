const axios = require('axios');
const db = require('./db');
const catalog = require('./catalog');

let cache = { at: 0, items: null, error: null };

function cacheMs() {
    const sec = Number(process.env.TEMPLATES_CACHE_SEC);
    return (Number.isFinite(sec) && sec >= 0 ? sec : 300) * 1000;
}

function clearCache() {
    cache = { at: 0, items: null, error: null };
}

function truthy(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const s = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'да'].includes(s)) return true;
    if (['0', 'false', 'no', 'n', 'нет'].includes(s)) return false;
    return fallback;
}

function splitList(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    if (value === undefined || value === null || value === '') return [];
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) return splitList(parsed);
            } catch (e) {}
        }
        return trimmed.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
    }
    return [String(value)];
}

function firstNumber(...values) {
    for (const value of values) {
        if (value === undefined || value === null || value === '') continue;
        const n = Number(String(value).replace(',', '.'));
        if (Number.isFinite(n) && n >= 0) return Math.round(n);
    }
    return 0;
}

function safeHttp(url) {
    const s = String(url || '').trim();
    return /^https?:\/\//i.test(s) ? s.slice(0, 2000) : '';
}

function mapModel(raw) {
    const key = String(raw || '').trim();
    if (key === 'pro') return 'nanobanana_pro';
    if (key && catalog.getModel(key, { includeDisabled: true })) return key;
    const fallback = (process.env.TEMPLATE_MODEL || 'nanobanana').trim();
    if (catalog.getModel(fallback, { includeDisabled: true })) return fallback;
    return 'nanobanana';
}

function isPhotoModel(key) {
    const model = catalog.getModel(key, { includeDisabled: true });
    if (!model) return true;
    return model.group === 'image' || model.group === 'fix' || model.image === 'required';
}

function parseBody(data) {
    if (data && typeof data === 'object') return data;
    if (typeof data !== 'string') return null;
    let text = data.trim();
    if (text.startsWith(")]}'")) text = text.replace(/^\)\]\}',?\s*/, '');
    try { return JSON.parse(text); } catch (e) { return null; }
}

async function postJson(url, body) {
    const first = await axios.post(url, body, {
        timeout: 20000,
        maxRedirects: 0,
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json' }
    });
    if (first.status >= 300 && first.status < 400 && first.headers.location) {
        const next = new URL(first.headers.location, url).toString();
        const second = await axios.post(next, body, {
            timeout: 20000,
            maxRedirects: 5,
            validateStatus: () => true,
            headers: { 'Content-Type': 'application/json' }
        });
        return second.data;
    }
    return first.data;
}

function fromSheet(raw) {
    if (!raw || raw.id === undefined || raw.id === null || raw.id === '') return null;
    const model = mapModel(raw.model);
    return {
        id: 'sheet:' + String(raw.id),
        title: String(raw.title || 'Шаблон').trim().slice(0, 120),
        prompt: String(raw.prompt || '').trim(),
        desc: String(raw.desc || raw.description || '').trim().slice(0, 500),
        image: safeHttp(raw.image || raw.preview || raw.example),
        cost: firstNumber(raw.credits, raw.price, raw.cost),
        model,
        category: splitList(raw.cats)[0] || 'image',
        formats: splitList(raw.formats),
        hidePrompt: true,
        active: truthy(raw.active, true),
        photo: isPhotoModel(model),
        source: 'sheet',
        vip: truthy(raw.vip, false),
        trend: truthy(raw.trend, false)
    };
}

function fromDb(row) {
    const model = mapModel(row.model);
    const hidePrompt = !!row.hide_prompt;
    return {
        id: 'local:' + row.id,
        title: row.title,
        prompt: row.prompt,
        desc: row.description || '',
        image: safeHttp(row.image),
        cost: Number(row.cost) || 0,
        model,
        category: row.category || 'image',
        formats: splitList(row.formats),
        hidePrompt,
        active: row.active !== false,
        photo: hidePrompt && isPhotoModel(model),
        source: 'local',
        vip: false,
        trend: false
    };
}

function toPublic(item) {
    const out = {
        id: item.id,
        title: item.title,
        desc: item.desc || '',
        image: item.image || '',
        cost: item.cost,
        model: item.model,
        category: item.category,
        formats: item.formats || [],
        photo: !!item.photo,
        hidePrompt: !!item.hidePrompt,
        vip: !!item.vip,
        trend: !!item.trend,
        source: item.source
    };
    if (!item.hidePrompt) out.prompt = item.prompt;
    return out;
}

async function loadRemote(force) {
    const url = String(process.env.TEMPLATES_SCRIPT_URL || '').trim();
    const key = String(process.env.TEMPLATES_KEY || '').trim();
    if (!url || !key) return { configured: false, items: [], error: null };
    const fresh = cache.items && Date.now() - cache.at < cacheMs();
    if (!force && fresh) return { configured: true, items: cache.items, error: null };
    if (!force && cache.error && Date.now() - cache.at < 15000) return { configured: true, items: [], error: cache.error };
    try {
        const data = parseBody(await postJson(url, { action: 'templates', key }));
        const list = data && (Array.isArray(data.templates) ? data.templates : (Array.isArray(data) ? data : null));
        if (!data || data.ok === false || !Array.isArray(list)) {
            throw new Error((data && (data.error || data.message)) || 'Некорректный ответ таблицы шаблонов');
        }
        const items = list.map(fromSheet).filter(Boolean);
        cache = { at: Date.now(), items, error: null };
        return { configured: true, items, error: null };
    } catch (e) {
        const message = e.message || 'Не удалось получить шаблоны';
        cache = { at: Date.now(), items: null, error: message };
        console.error('⚠️ Шаблоны Apps Script:', message);
        return { configured: true, items: [], error: message };
    }
}

async function listPublic() {
    const remote = await loadRemote(false);
    const localRows = await db.listTemplates(false);
    return [
        ...remote.items.filter(item => item.active).map(toPublic),
        ...localRows.map(row => toPublic(fromDb(row)))
    ];
}

async function getFull(id) {
    const sid = String(id || '');
    if (sid.startsWith('sheet:')) {
        const remote = await loadRemote(false);
        return remote.items.find(item => item.id === sid && item.active) || null;
    }
    const dbId = sid.startsWith('local:') ? sid.slice(6) : sid;
    if (!/^\d+$/.test(dbId)) return null;
    const rows = await db.listTemplates(true);
    const row = rows.find(item => String(item.id) === dbId);
    if (!row || row.active === false) return null;
    return fromDb(row);
}

async function listAdminRemote() {
    const remote = await loadRemote(false);
    return {
        configured: remote.configured,
        error: remote.error,
        items: remote.items.map(item => ({ ...toPublic(item), prompt: item.prompt, active: item.active }))
    };
}

module.exports = { listPublic, getFull, listAdminRemote, clearCache, loadRemote };
