// Готовые промпты из таблицы шаблонов. Добавляются только отсутствующие названия.
const fs = require('fs');
const path = require('path');
const catalog = require('./catalog');

const VIDEO_ONLY = new Set(['video', 'seedance']);
const SPLIT = new Set(['chain', 'chainsd']);
const FILE = path.join(__dirname, '..', 'data', 'foreign-templates.json');

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (quoted) {
            if (ch === '"') {
                if (source[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                } else quoted = false;
            } else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') {
            row.push(cell);
            cell = '';
        } else if (ch === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows.filter(item => item.some(value => String(value || '').trim()));
}

function sheetObjects(text) {
    const table = parseCsv(text);
    if (!table.length) return [];
    const head = table[0];
    return table.slice(1).map(row => {
        const item = {};
        head.forEach((name, index) => {
            item[String(name || '').trim()] = row[index] || '';
        });
        return item;
    });
}

function fieldsToLines(text) {
    const lines = [];
    String(text || '').split(/\r?\n/).forEach(line => {
        if (!line.includes(';')) return;
        const parts = line.split(';').map(part => part.trim());
        const key = parts[0];
        if (!key || !parts[1]) return;
        let type = parts[1].toLowerCase();
        const label = parts[2] || key;
        const options = String(parts[3] || '').split(',').map(part => part.trim()).filter(Boolean);
        if (type === 'длинный') type = 'текст';
        if (type === 'фото') {
            lines.push('фото | ' + label);
            return;
        }
        if (!['текст', 'выбор', 'дата', 'число'].includes(type)) type = 'текст';
        const row = [type, key, label];
        if (type === 'выбор' && options.length) row.push(options.join('; '));
        lines.push(row.join(' | '));
    });
    return lines.join('\n');
}

function previewUrl(url) {
    const source = String(url || '').trim();
    const drive = source.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
    if (drive) return 'https://drive.google.com/thumbnail?id=' + drive[1] + '&sz=w800';
    return source.startsWith('https://') ? source : '';
}

function fixPrompt(text) {
    return String(text || '').replace(/\{знако зодиака\}/g, '{знак зодиака}').trim();
}

function nearest(list, want) {
    const target = Number(want);
    return list.slice().sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0];
}

const NAMED_PRICE = { standard: 5, super: 9, nano2: 9, nanopro: 18, seedream: 11 };
const GPT_COST = {
    low: { '1k': 2, '2k': 2, '4k': 4 },
    medium: { '1k': 4, '2k': 4, '4k': 8 },
    high: { '1k': 16, '2k': 12, '4k': 31 },
    xhigh: { '1k': 29, '2k': 22, '4k': 54 },
    max: { '1k': 64, '2k': 48, '4k': 121 }
};
const IMAGE_CHOICES = {
    gpt: [
        { model: 'gpt-image-2', quality: 'low' },
        { model: 'gpt-image-2', quality: 'medium' },
        { model: 'gpt-image-2', quality: 'high' },
        { model: 'kie-gpt', quality: '1K' },
        { model: 'kie-gpt', quality: '2K' },
        { model: 'kie-gpt', quality: '4K' }
    ],
    banana: [
        { model: 'kie-banana-21', quality: '1K' },
        { model: 'kie-banana-21', quality: '2K' },
        { model: 'kie-banana-21', quality: '4K' }
    ],
    nanopro: [
        { model: 'kie-banana-pro', quality: '1K' },
        { model: 'kie-banana-pro', quality: '2K' }
    ],
    seedream: [
        { model: 'kie-seedream', quality: '' },
        { model: 'seedream-4-5', quality: '2K' }
    ]
};

// Цена для клиента в чужом боте: именованный режим или себестоимость GPT × 2,25.
function customerPrice(mode) {
    const value = String(mode || '').trim().toLowerCase();
    if (NAMED_PRICE[value]) return NAMED_PRICE[value];
    const gpt = value.match(/^gpt:(?:flare|sunburst):(low|medium|high|xhigh|max):(1k|2k|4k):([nc])$/);
    if (!gpt) return NAMED_PRICE.super;
    const quality = gpt[1];
    const cost = gpt[3] === 'c' && quality !== 'low' ? 4 : GPT_COST[quality][gpt[2]];
    return Math.ceil(cost * 2.25);
}

function choiceFamily(mode) {
    const value = String(mode || '').toLowerCase();
    if (value === 'nanopro') return 'nanopro';
    if (value === 'nano2' || value.startsWith('nano2')) return 'banana';
    if (value === 'seedream') return 'seedream';
    return 'gpt';
}

function fitsAspect(modelKey, size) {
    const model = catalog.getModel(modelKey, { includeDisabled: true });
    const aspect = String(size || '').trim();
    if (!aspect || !model || !model.aspects || !model.aspects.length) return true;
    return model.aspects.includes(aspect);
}

function imageSpec(mode, size) {
    const target = customerPrice(mode);
    const priced = (IMAGE_CHOICES[choiceFamily(mode)] || IMAGE_CHOICES.gpt).map(choice => {
        const model = catalog.getModel(choice.model, { includeDisabled: true });
        return {
            model: choice.model,
            quality: choice.quality,
            category: 'image',
            cost: catalog.quote(model, { quality: choice.quality }),
            fits: fitsAspect(choice.model, size)
        };
    }).filter(choice => choice.cost > 0);
    const fitting = priced.filter(choice => choice.fits);
    const pool = fitting.length ? fitting : priced;
    pool.sort((a, b) => Math.abs(a.cost - target) - Math.abs(b.cost - target) || a.cost - b.cost);
    return pool[0];
}

function videoSpec(quality, seconds) {
    const model = String(quality || '').toLowerCase().includes('720') ? 'grok-video-720' : 'grok-video-480';
    const spec = catalog.getModel(model, { includeDisabled: true });
    const duration = nearest((spec && spec.durations) || [6, 10, 15, 20, 30], Number(seconds) || 6);
    return { model, quality: '', duration, category: 'video' };
}

function imageMode(row) {
    const chained = String(row.imgMode || '').trim();
    if (chained) return chained;
    const mode = String(row.mode || '').trim();
    if (['super', 'standard', 'nano2', 'nanopro', 'seedream'].includes(mode) || mode.startsWith('gpt:')) return mode;
    return 'super';
}

function priceOf(spec) {
    const model = catalog.getModel(spec.model, { includeDisabled: true });
    return catalog.quote(model, { quality: spec.quality, duration: spec.duration });
}

function knownFormat(modelKey, size) {
    const model = catalog.getModel(modelKey, { includeDisabled: true });
    const aspect = String(size || '').trim();
    if (!model || !aspect || !(model.aspects || []).includes(aspect)) return '';
    return aspect;
}

function takeTitle(title, used) {
    const clean = String(title || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    let next = clean.slice(0, 120);
    let n = 2;
    while (used.has(next.toLowerCase())) {
        next = (clean.slice(0, 110) + ' ' + n).slice(0, 120);
        n += 1;
    }
    used.add(next.toLowerCase());
    return next;
}

function record(row, title, prompt, spec, sort) {
    return {
        title,
        description: String(row.description || '').trim(),
        image: previewUrl(row.image),
        prompt,
        fields: fieldsToLines(row.fields),
        topics: String(row.topics || '').trim(),
        category: spec.category,
        model: spec.model,
        quality: spec.quality || '',
        duration: spec.duration || null,
        formats: knownFormat(spec.model, row.size),
        cost: priceOf(spec),
        audience: 'all',
        active: true,
        sort
    };
}

function buildRecords(rows) {
    const used = new Set();
    const out = [];
    (rows || []).forEach((row, index) => {
        if (String(row.show || '').trim().toLowerCase() === 'нет') return;
        const title = String(row.title || '').trim();
        if (!title) return;
        const mode = String(row.mode || '').trim().toLowerCase();
        const imagePrompt = fixPrompt(row.prompt);
        const videoPrompt = fixPrompt(row.vprompt) || (VIDEO_ONLY.has(mode) ? imagePrompt : '');
        const sort = 400 + index;
        if (VIDEO_ONLY.has(mode)) {
            if (!videoPrompt) return;
            out.push(record(row, takeTitle(title, used), videoPrompt, videoSpec(row.vres, row.seconds), sort));
            return;
        }
        if (imagePrompt) out.push(record(row, takeTitle(title, used), imagePrompt, imageSpec(imageMode(row), row.size), sort));
        if (SPLIT.has(mode) && videoPrompt) {
            out.push(record(row, takeTitle(title + ' · видео', used), videoPrompt, videoSpec(row.vres, row.seconds), sort + 1));
        }
    });
    return out;
}

function recordsFromCsv(text) {
    return buildRecords(sheetObjects(text).map(row => ({
        title: row['Название'],
        description: row['Описание'],
        image: row['Картинка-превью (ссылка)'],
        mode: row['Режим'],
        size: row['Размер'],
        prompt: row['Промпт (скрытый)'],
        fields: row['Вопросы'],
        show: row['Показывать'],
        seconds: row['Секунд (для видео)'],
        vres: row['Качество (для видео)'],
        vprompt: row['Промпт видео (для цепочки)'],
        imgMode: row['Режим картинки (для цепочки)'],
        topics: row['Тема']
    })));
}

function list() {
    try {
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        return Array.isArray(raw) ? raw : [];
    } catch (err) {
        return [];
    }
}

module.exports = { buildRecords, recordsFromCsv, fieldsToLines, list, customerPrice, imageSpec };
