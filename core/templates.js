const db = require('./db');
const catalog = require('./catalog');
const templateFields = require('./template_fields');

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

function topicList(value) {
    const seen = new Set();
    const out = [];
    splitList(value).forEach(name => {
        const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        const key = clean.toLowerCase();
        if (!clean || seen.has(key) || out.length >= 40) return;
        seen.add(key);
        out.push(clean);
    });
    return out;
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

function savedMode(modelKey, row) {
    const spec = catalog.getModel(modelKey, { includeDisabled: true });
    const qualities = (spec && spec.qualities) || [];
    const id = String((row && row.quality) || '').trim();
    const quality = qualities.some(item => item.id === id) ? id : '';
    const durations = ((spec && spec.durations) || []).map(Number);
    const duration = durations.includes(Number(row && row.duration)) ? Number(row.duration) : null;
    return { quality, duration };
}

function fromDb(row) {
    const model = mapModel(row.model);
    const mode = savedMode(model, row);
    const spec = catalog.getModel(model, { includeDisabled: true });
    const fields = templateFields.parseFields(row.fields);
    const photo = fields.length
        ? fields.some(field => field.type === 'фото' && !field.optional)
        : wantsPhoto(spec);
    return {
        id: 'local:' + row.id,
        title: row.title,
        prompt: row.prompt,
        desc: row.description || '',
        image: safeImage(row.image),
        cost: Number(row.cost) || 0,
        model,
        quality: mode.quality,
        duration: mode.duration,
        category: row.category || 'image',
        cats: topicList(row.topics),
        formats: catalog.templateFormats(spec, row.formats),
        fields,
        hidePrompt: true,
        active: row.active !== false,
        audience: ['tg', 'vk', 'all'].includes(row.audience) ? row.audience : 'all',
        photo,
        sort: Number(row.sort) || 0
    };
}

const share = require('./share');

function toPublic(item) {
    const out = {
        id: item.id,
        title: item.title,
        desc: item.desc || '',
        image: item.image || '',
        cost: item.cost,
        model: item.model,
        category: item.category,
        cats: item.cats || [],
        formats: item.formats || [],
        fields: item.fields || [],
        photo: !!item.photo,
        hidePrompt: true
    };
    return out;
}

function templateShareLink(item, username, audience, groupId) {
    const own = item && item.audience;
    const vk = own === 'vk' || (own !== 'tg' && audience === 'vk');
    if (vk) return share.vkTemplateLink(item && item.id, groupId);
    return share.templateLink(username, item && item.id);
}

function attachChannelLink(item, username, audience, groupId) {
    const link = templateShareLink(item, username, audience, groupId);
    if (!item || !link) return item;
    return Object.assign({}, item, { link });
}

function visibleFor(item, audience) {
    const place = item.audience || 'all';
    if (audience === 'vk') return place === 'vk' || place === 'all';
    if (audience === 'tg') return place === 'tg' || place === 'all';
    return true;
}

async function listPublic(audience) {
    const rows = await db.listTemplates(false, audience === 'vk' ? 'vk' : audience === 'tg' ? 'tg' : '');
    return rows.map(row => toPublic(fromDb(row)));
}

async function getFull(id, audience) {
    const sid = String(id || '');
    const dbId = sid.startsWith('local:') ? sid.slice(6) : sid;
    if (!/^\d+$/.test(dbId)) return null;
    const rows = await db.listTemplates(true);
    const row = rows.find(item => String(item.id) === dbId);
    if (!row || row.active === false) return null;
    const item = fromDb(row);
    if (audience && !visibleFor(item, audience)) return null;
    return item;
}

module.exports = { listPublic, getFull, fromDb, toPublic, attachChannelLink, templateShareLink, mapModel, wantsPhoto, savedMode, visibleFor, topicList };
