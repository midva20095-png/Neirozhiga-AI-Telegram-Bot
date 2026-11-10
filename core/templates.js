const axios = require('axios');
const db = require('./db');
const catalog = require('./catalog');

let cache = { at: 0, items: null, error: null };
let pending = null;

function cacheMs() {
    const sec = Number(process.env.TEMPLATES_CACHE_SEC);
    return (Number.isFinite(sec) && sec >= 0 ? sec : 300) * 1000;
}

function clearCache() {
    cache = { at: 0, items: null, error: null };
    pending = null;
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
    if (Buffer.isBuffer(data)) data = data.toString('utf8');
    if (data && typeof data === 'object') return data;
    if (typeof data !== 'string') return null;
    let text = data.trim().replace(/^\uFEFF/, '');
    if (text.startsWith(")]}'")) text = text.replace(/^\)\]\}',?\s*/, '');
    try { return JSON.parse(text); } catch (e) {}
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch (e) {}
    }
    return null;
}

function mergeCookies(previous, setCookie) {
    const jar = new Map();
    for (const part of String(previous || '').split(';')) {
        const pair = part.trim();
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const list = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
    for (const cookie of list) {
        const pair = String(cookie).split(';')[0];
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

// Apps Script на /exec отвечает 302. Обычный клиент превращает следующий шаг в GET
// и теряет тело, поэтому вместо JSON приходит HTML. Тело и cookie переносим сами.
async function postJson(url, body) {
    const payload = JSON.stringify(body);
    let current = url;
    let cookie = '';
    let last = null;
    for (let hop = 0; hop < 5; hop++) {
        const res = await axios.post(current, payload, {
            timeout: 20000,
            maxRedirects: 0,
            validateStatus: () => true,
            responseType: 'text',
            transformResponse: [value => value],
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
                'User-Agent': 'NeirozhigaBot/1.0',
                ...(cookie ? { Cookie: cookie } : {})
            }
        });
        last = res;
        cookie = mergeCookies(cookie, res.headers['set-cookie']);
        if (res.status >= 300 && res.status < 400 && res.headers.location) {
            current = new URL(res.headers.location, current).toString();
            continue;
        }
        return { status: res.status, data: res.data };
    }
    return { status: last ? last.status : 0, data: last ? last.data : '' };
}

function asList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        const parsed = parseBody(value);
        return parsed ? asList(parsed) : null;
    }
    if (value && typeof value === 'object') {
        if (Array.isArray(value.templates)) return value.templates;
        const values = Object.values(value);
        if (values.length && values.every(item => item && typeof item === 'object' && !Array.isArray(item))) return values;
    }
    return null;
}

function templateList(data) {
    if (!data || typeof data !== 'object') return null;
    return asList(data.templates) || asList(data.items) || asList(data.data) || asList(data.rows) || asList(data.result) || asList(data);
}

const ROW_ALIASES = {
    id: ['id', 'ид'],
    title: ['title', 'name', 'название', 'имя'],
    prompt: ['prompt', 'промпт'],
    desc: ['desc', 'description', 'описание'],
    image: ['image', 'preview', 'photo', 'картинка', 'фото', 'превью'],
    credits: ['credits', 'price', 'cost', 'цена', 'кредиты'],
    model: ['model', 'модель'],
    cats: ['cats', 'category', 'категории', 'категория'],
    formats: ['formats', 'format', 'форматы', 'формат'],
    active: ['active', 'активен', 'enabled'],
    vip: ['vip'],
    trend: ['trend', 'тренд']
};

function normalizeRow(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const lower = {};
    for (const [key, value] of Object.entries(raw)) lower[String(key).trim().toLowerCase()] = value;
    const out = { ...raw };
    for (const [canon, names] of Object.entries(ROW_ALIASES)) {
        if (out[canon] !== undefined && out[canon] !== '') continue;
        for (const name of names) {
            if (lower[name] !== undefined && lower[name] !== '') {
                out[canon] = lower[name];
                break;
            }
        }
    }
    return out;
}

function responsePreview(status, data) {
    const secret = String(process.env.TEMPLATES_KEY || '');
    let text = String(data || '').replace(/\s+/g, ' ');
    if (secret) text = text.split(secret).join('***');
    return `HTTP ${status}: ${text.slice(0, 220) || 'пустой ответ'}`;
}

function fromSheet(raw) {
    raw = normalizeRow(raw);
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
    if (!force && pending) return pending;
    pending = fetchRemote(url, key).finally(() => { pending = null; });
    return pending;
}

async function fetchRemote(url, key) {
    try {
        const response = await postJson(url, { action: 'templates', key });
        const data = parseBody(response.data);
        const failed = data && (data.ok === false || data.ok === 'false');
        const list = !failed && templateList(data);
        if (!data || failed || !Array.isArray(list)) {
            throw new Error((data && (data.error || data.message)) || `Некорректный ответ таблицы шаблонов (${responsePreview(response.status, response.data)})`);
        }
        const items = list.map(fromSheet).filter(Boolean);
        cache = { at: Date.now(), items, error: null };
        console.log(`✅ Шаблоны Apps Script: ${items.length}`);
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
