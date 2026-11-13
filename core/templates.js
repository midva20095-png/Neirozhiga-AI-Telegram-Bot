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

// В шаблоне остаётся ровно та модель, которую выбрали в админке.
// Другой сервис сам не подставляется: иначе запрос не попадает в журнал этого сервиса.
function mapModel(raw) {
    return String(raw || '').trim();
}

function wantsPhoto(model) {
    if (!model) return false;
    if (model.image === 'forbidden' || model.image === 'no') return false;
    if (model.image === 'required') return true;
    return model.kind === 'image';
}

function fromDb(row) {
    const model = mapModel(row.model);
    return {
        id: 'local:' + row.id,
        title: row.title,
        prompt: row.prompt,
        desc: row.description || '',
        image: safeImage(row.image),
        cost: Number(row.cost) || 0,
        model,
        category: row.category || 'image',
        formats: catalog.templateFormats(catalog.getModel(model, { includeDisabled: true }), row.formats),
        hidePrompt: true,
        active: row.active !== false,
        photo: wantsPhoto(catalog.getModel(model, { includeDisabled: true })),
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
        hidePrompt: true
    };
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

module.exports = { listPublic, getFull, fromDb, toPublic, mapModel, wantsPhoto };
