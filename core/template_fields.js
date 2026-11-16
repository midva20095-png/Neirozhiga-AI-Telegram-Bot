// Пустое поле не меняет старые шаблоны: одно фото и текст запроса как есть.

const MAX_PHOTOS = 6;
const TYPES = new Set(['фото', 'текст', 'выбор', 'дата', 'число']);
const ZODIAC = [
    [1, 20, 'Козерог'], [2, 19, 'Водолей'], [3, 21, 'Рыбы'], [4, 20, 'Овен'],
    [5, 21, 'Телец'], [6, 21, 'Близнецы'], [7, 23, 'Рак'], [8, 23, 'Лев'],
    [9, 23, 'Дева'], [10, 23, 'Весы'], [11, 22, 'Скорпион'], [12, 22, 'Стрелец'],
    [12, 32, 'Козерог']
];

function toInt(value, fallback) {
    const n = parseInt(String(value == null ? '' : value).replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? n : fallback;
}

function cleanField(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    let type = String(raw.type || 'текст').toLowerCase();
    if (!TYPES.has(type)) type = 'текст';
    const item = {
        type,
        key: String(raw.key || ('поле' + (index + 1))).slice(0, 40),
        label: String(raw.label || raw.key || 'Поле').slice(0, 80)
    };
    if (type === 'выбор') item.options = (Array.isArray(raw.options) ? raw.options : []).map(o => String(o).slice(0, 80)).filter(Boolean).slice(0, 20);
    if (type === 'фото' && raw.multi) item.multi = Math.max(1, Math.min(MAX_PHOTOS, toInt(raw.multi, 1)));
    if (raw.optional) item.optional = true;
    return item;
}

function parseLines(text) {
    const items = [];
    let photoN = 0;
    String(text || '').split(/\r?\n/).forEach(line => {
        const parts = line.split('|').map(part => part.trim());
        if (!parts[0]) return;
        const type = parts[0].toLowerCase();
        if (type === 'фото') {
            photoN += 1;
            const field = { type: 'фото', key: 'фото' + photoN, label: parts[1] || 'Ваше фото' };
            parts.slice(2).forEach(extra => {
                const low = extra.toLowerCase();
                if (low.startsWith('до')) field.multi = Math.max(1, Math.min(MAX_PHOTOS, toInt(low.slice(2), 1)));
                else if (low.startsWith('необяз')) field.optional = true;
            });
            items.push(field);
            return;
        }
        if (parts.length < 3) return;
        const field = { type, key: parts[1], label: parts[2] };
        if (type === 'выбор') {
            field.options = String(parts[3] || '').replace(/,/g, ';').split(';').map(s => s.trim()).filter(Boolean);
        }
        if (parts.slice(3).some(extra => extra.toLowerCase().startsWith('необяз'))) field.optional = true;
        items.push(field);
    });
    return items;
}

function parseFields(raw) {
    let items = [];
    if (Array.isArray(raw)) items = raw;
    else {
        const text = String(raw || '').trim();
        if (!text) return [];
        if (text.startsWith('[')) {
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) items = parsed;
            } catch (e) {}
        }
        if (!items.length) items = parseLines(text);
    }
    return items.map(cleanField).filter(Boolean);
}

function zodiacSign(dateStr) {
    const iso = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})/.exec(dateStr || '');
    const dot = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(dateStr || '');
    let month = 0;
    let day = 0;
    if (iso) {
        month = Number(iso[2]);
        day = Number(iso[3]);
    } else if (dot) {
        day = Number(dot[1]);
        month = Number(dot[2]);
    }
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return '';
    for (const row of ZODIAC) {
        if (month < row[0] || (month === row[0] && day < row[1])) return row[2];
    }
    return 'Козерог';
}

function buildPrompt(prompt, fields, answers) {
    let text = String(prompt || '');
    const map = answers && typeof answers === 'object' ? answers : {};
    const list = Array.isArray(fields) ? fields : [];
    if (text.includes('{знак}')) {
        const dateVal = list.filter(field => field.type === 'дата').map(field => String(map[field.key] || '')).find(Boolean) || '';
        text = text.split('{знак}').join(zodiacSign(dateVal) || 'знак зодиака по дате рождения');
    }
    const used = new Set();
    list.forEach(field => {
        if (field.type === 'фото') return;
        const value = String(map[field.key] || '').trim().slice(0, 600);
        const keys = [field.key, field.key.toLowerCase(), field.key.charAt(0).toUpperCase() + field.key.slice(1).toLowerCase()];
        keys.forEach(key => {
            const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const before = text;
            text = text.replace(new RegExp('\\{' + escaped + '\\s*([+-])\\s*(\\d+)\\}', 'gi'), (token, sign, amount) => {
                const base = Number(String(value).replace(',', '.'));
                if (!Number.isFinite(base)) return value;
                const next = sign === '-' ? base - Number(amount) : base + Number(amount);
                return String(next);
            });
            if (text !== before) used.add(field.key);
            const token = '{' + key + '}';
            if (!text.includes(token)) return;
            text = text.split(token).join(value);
            used.add(field.key);
        });
    });
    const rest = list.filter(field => field.type !== 'фото' && !used.has(field.key) && String(map[field.key] || '').trim())
        .map(field => field.label + ': ' + String(map[field.key]).trim().slice(0, 600));
    if (rest.length) text += '\n\nДанные от пользователя:\n' + rest.join('\n');
    return text;
}

function withAspect(text, aspect) {
    const ratio = String(aspect || '').trim();
    if (!ratio) return text;
    return String(text || '') + '\n\nФормат изображения: соотношение сторон ' + ratio + '. Композицию строй под этот формат.';
}

function missing(fields, answers, photoCount) {
    const map = answers && typeof answers === 'object' ? answers : {};
    for (const field of fields || []) {
        if (field.type === 'фото') continue;
        if (!field.optional && !String(map[field.key] || '').trim()) return 'Заполните: ' + field.label;
    }
    const needPhoto = (fields || []).some(field => field.type === 'фото' && !field.optional);
    if (needPhoto && !(Number(photoCount) > 0)) return 'Добавьте фото';
    return '';
}

module.exports = { parseFields, buildPrompt, withAspect, missing, zodiacSign, MAX_PHOTOS };
