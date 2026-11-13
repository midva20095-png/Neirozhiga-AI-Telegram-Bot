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

// Nano Banana у Братухи отвечает «нейросеть временно недоступна».
// Banana Lite на Kie в тот же день картинку отдала, цена шаблона не меняется.
const STEADY_IMAGE = 'kie-banana-lite';

function kieReady() {
    return !!String(process.env.KIE_API_KEY || '').trim();
}

function mapModel(raw) {
    const key = String(raw || '').trim();
    if (key === 'nano-banana' && kieReady() && catalog.getModel(STEADY_IMAGE)) return STEADY_IMAGE;
    if (key && catalog.getModel(key, { includeDisabled: true })) return key;
    const fallback = (process.env.TEMPLATE_MODEL || 'nanobanana').trim();
    if (catalog.getModel(fallback, { includeDisabled: true })) return fallback;
    return 'nanobanana';
}

function serviceDown(error) {
    const message = String((error && error.message) || '');
    return /временно недоступна|internal error|try again later|bad gateway|service unavailable/i.test(message);
}

// Запасной запуск только для картинки, если выбранная модель молчит.
function fallbackModel(modelKey, error) {
    const message = String((error && error.message) || '');
    const current = catalog.getModel(modelKey, { includeDisabled: true });
    if (!current || current.kind !== 'image') return null;
    if (/Фото не загрузилось/.test(message) && current.provider === 'kie') {
        const google = catalog.getModel('nanobanana');
        return google ? google.key : null;
    }
    if (!serviceDown(error) || !kieReady()) return null;
    if (current.provider === 'kie' || current.key === STEADY_IMAGE) return null;
    const next = catalog.getModel(STEADY_IMAGE);
    return next ? next.key : null;
}

function isPhotoModel(key) {
    const model = catalog.getModel(key, { includeDisabled: true });
    if (!model) return true;
    return model.kind === 'image' || model.image === 'required';
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
        formats: catalog.templateFormats(catalog.getModel(model, { includeDisabled: true }), row.formats),
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

module.exports = { listPublic, getFull, fromDb, toPublic, fallbackModel, serviceDown };
