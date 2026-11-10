const db = require('./db');
const catalog = require('./catalog');

// Шаблоны живут только в админке и Postgres.
// Google-таблица больше не источник: там другая цена, и кабинет расходился с ботом.

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

function safeImage(url) {
    const s = String(url || '').trim();
    if (/^https?:\/\//i.test(s)) return s.slice(0, 2000);
    if (/^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(s) && s.length <= 1500000) return s;
    return '';
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

function fromDb(row) {
    const model = mapModel(row.model);
    const hidePrompt = !!row.hide_prompt;
    return {
        id: 'local:' + row.id,
        title: row.title,
        prompt: row.prompt,
        desc: row.description || '',
        image: safeImage(row.image),
        cost: Number(row.cost) || 0,
        model,
        category: row.category || 'image',
        formats: splitList(row.formats),
        hidePrompt,
        active: row.active !== false,
        photo: hidePrompt && isPhotoModel(model),
        sort: Number(row.sort) || 0
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
        hidePrompt: !!item.hidePrompt
    };
    if (!item.hidePrompt) out.prompt = item.prompt;
    return out;
}

async function listPublic() {
    const rows = await db.listTemplates(false);
    return rows.map(row => toPublic(fromDb(row)));
}

async function getFull(id) {
    const sid = String(id || '');
    const dbId = sid.startsWith('local:') ? sid.slice(6) : sid;
    if (!/^\d+$/.test(dbId)) return null;
    const rows = await db.listTemplates(true);
    const row = rows.find(item => String(item.id) === dbId);
    if (!row || row.active === false) return null;
    return fromDb(row);
}

module.exports = { listPublic, getFull, fromDb, toPublic };
