// Каталог моделей, пакетов кредитов и общих настроек.
// Базовые значения заданы в коде, админка хранит поверх них правки в таблице settings.
// Бот строит клавиатуры синхронно, поэтому всё держится в памяти и перечитывается после сохранения.

const GROUPS = {
    text: '💬 Текст',
    audio: '🎵 Голос',
    image: '🎨 Картинки',
    fix: '✨ Улучшить фото',
    video: '🎬 Видео'
};

// provider: google | bratukha | giga
// image: 'no' — фото не принимается, 'optional' — можно приложить, 'required' — без фото не работает
// ratio: модель умеет соотношение сторон
// limit: бесплатная модель с дневным лимитом запросов
const BASE_MODELS = [
    { key: 'flash', name: 'Gemini 3.8 Flash', short: 'Flash', desc: 'Текст и код', group: 'text', provider: 'google', cost: 4, image: 'optional' },
    { key: 'flash_25', name: 'Gemini 2.5 Flash', short: 'Flash 2.5', desc: 'Быстрый текст', group: 'text', provider: 'google', cost: 4, image: 'optional' },
    { key: 'pro', name: 'Gemini 3.1 Pro', short: 'Pro', desc: 'Аналитика и код', group: 'text', provider: 'google', cost: 15, image: 'optional' },
    { key: 'giga-lite', name: 'GigaChat 2 Lite', short: 'Giga Lite', desc: 'Бесплатно, лимит в день', group: 'text', provider: 'giga', cost: 0, limit: 30, image: 'no' },
    { key: 'giga-pro', name: 'GigaChat 2 Pro', short: 'Giga Pro', desc: 'Бесплатно, лимит в день', group: 'text', provider: 'giga', cost: 0, limit: 10, image: 'no' },
    { key: 'giga-max', name: 'GigaChat 2 Max', short: 'Giga Max', desc: 'Бесплатно, лимит в день', group: 'text', provider: 'giga', cost: 0, limit: 5, image: 'no' },
    { key: 'giga-ultra', name: 'GigaChat 3 Ultra', short: 'Giga Ultra', desc: 'Бесплатно, лимит в день', group: 'text', provider: 'giga', cost: 0, limit: 5, image: 'no' },

    { key: 'qwen3-tts', name: 'Qwen3 TTS', short: 'Озвучка', desc: 'Озвучка текста', group: 'audio', provider: 'bratukha', cost: 100, image: 'no' },
    { key: 'qwen3-tts-flash', name: 'Qwen3 TTS Flash', short: 'Озвучка быстрая', desc: 'Быстрая озвучка', group: 'audio', provider: 'bratukha', cost: 100, image: 'no' },

    { key: 'nanobanana', name: 'Nano Banana 2', short: 'Nano Banana', desc: 'Генерация и правка фото', group: 'image', provider: 'google', cost: 20, image: 'optional' },
    { key: 'nanobanana_pro', name: 'Nano Banana Pro', short: 'Nano Pro', desc: 'Про-фото', group: 'image', provider: 'google', cost: 50, image: 'optional' },
    { key: 'qwen-image-2-1', name: 'Qwen Image 2.1', short: 'Qwen 2.1', desc: 'Арт и фото', group: 'image', provider: 'bratukha', cost: 40, image: 'optional', ratio: true },
    { key: 'qwen-image-3-0', name: 'Qwen Image 3.0', short: 'Qwen 3.0', desc: 'Арт и фото', group: 'image', provider: 'bratukha', cost: 45, image: 'optional', ratio: true },
    { key: 'recraft-v4', name: 'Recraft V4', short: 'Recraft 4', desc: 'Вектор и растр', group: 'image', provider: 'bratukha', cost: 15, image: 'optional', ratio: true },
    { key: 'recraft-v4-1', name: 'Recraft V4.1', short: 'Recraft 4.1', desc: 'Улучшенный V4', group: 'image', provider: 'bratukha', cost: 20, image: 'optional', ratio: true },
    { key: 'runway-gen4-image', name: 'Runway Gen4', short: 'Runway', desc: 'Реализм', group: 'image', provider: 'bratukha', cost: 80, image: 'optional', ratio: true },
    { key: 'seedream-4-0', name: 'Seedream 4.0', short: 'Seedream 4', desc: 'Генерация фото', group: 'image', provider: 'bratukha', cost: 15, image: 'optional', ratio: true },
    { key: 'seedream-4-5', name: 'Seedream 4.5', short: 'Seedream 4.5', desc: 'Продвинутый арт', group: 'image', provider: 'bratukha', cost: 20, image: 'optional', ratio: true },

    { key: 'phota-enhance', name: 'Phota Enhance', short: 'Улучшить фото', desc: 'Улучшение фото', group: 'fix', provider: 'bratukha', cost: 220, image: 'required' },
    { key: 'p-image-upscale', name: 'Pruna Upscale', short: 'Резкость', desc: 'Резкость фото', group: 'fix', provider: 'bratukha', cost: 10, image: 'required' },
    { key: 'recraft-creative-upscale', name: 'Recraft Creative', short: 'Апскейл креатив', desc: 'Креативный апскейл', group: 'fix', provider: 'bratukha', cost: 400, image: 'required' },
    { key: 'recraft-crisp-upscale', name: 'Recraft Crisp', short: 'Апскейл чёткий', desc: 'Чёткий апскейл', group: 'fix', provider: 'bratukha', cost: 10, image: 'required' },
    { key: 'sam-3d', name: 'SAM 3D', short: 'Фото в 3D', desc: 'Фото в 3D', group: 'fix', provider: 'bratukha', cost: 40, image: 'required' },

    { key: 'sora-2', name: 'Sora 2.0', short: 'Sora 2', desc: 'Анимация фото', group: 'video', provider: 'bratukha', cost: 150, image: 'required', ratio: true },
    { key: 'seedance-1-0', name: 'Seedance 1.0', short: 'Seedance 1', desc: 'Анимация тела', group: 'video', provider: 'bratukha', cost: 100, image: 'required', ratio: true },
    { key: 'seedance-1-5-pro', name: 'Seedance 1.5 Pro', short: 'Seedance 1.5', desc: 'Видео из фото', group: 'video', provider: 'bratukha', cost: 120, image: 'required', ratio: true },
    { key: 'seedance-2-0-apimart', name: 'Seedance 2.0', short: 'Seedance 2', desc: 'Быстрое видео', group: 'video', provider: 'bratukha', cost: 100, image: 'required', ratio: true },
    { key: 'pruna-ai-p-video-2-pro', name: 'Pruna Video 2 Pro', short: 'Pruna Video', desc: 'Генерация видео', group: 'video', provider: 'bratukha', cost: 70, image: 'required', ratio: true }
];

const RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21'];

const BASE_PACKAGES = [
    { id: 'pack_100', credits: 100, price: 100, title: '100 кредитов' },
    { id: 'pack_500', credits: 500, price: 500, title: '500 кредитов' },
    { id: 'pack_1000', credits: 1000, price: 1000, title: '1000 кредитов' },
    { id: 'pack_2500', credits: 2500, price: 2500, title: '2500 кредитов' }
];

const BASE_GENERAL = {
    start_bonus: 0,
    default_model: 'flash',
    help_text:
        'Здравствуйте! Я — универсальный ИИ-помощник.\n\n' +
        'Что я умею:\n' +
        '• Генерация текста, кодинг и аналитика\n' +
        '• Создание изображений, апскейл и 3D-моделирование\n' +
        '• Создание и анимация видеоклипов\n' +
        '• Озвучка текста\n\n' +
        'Выберите модель и отправьте запрос текстом или фото. Всё то же самое доступно в «Кабинете».',
    support_enabled: true,
    site_url: 'https://babayagaland.ru'
};

let overrides = { models: {}, packages: null, general: {} };

function defaultEnabled(m) {
    if (m.provider === 'giga') return !!process.env.GIGACHAT_AUTH_KEY;
    return true;
}

function listModels({ includeDisabled = false } = {}) {
    const out = BASE_MODELS.map((m, idx) => {
        const o = overrides.models[m.key] || {};
        return {
            ...m,
            order: idx,
            name: o.name || m.name,
            short: o.short || m.short,
            desc: o.desc !== undefined ? o.desc : m.desc,
            cost: Number.isFinite(Number(o.cost)) && o.cost !== '' && o.cost !== null ? Math.max(0, Math.round(Number(o.cost))) : m.cost,
            limit: m.provider === 'giga'
                ? (Number.isFinite(Number(o.limit)) && o.limit !== null && o.limit !== '' ? Math.max(0, Math.round(Number(o.limit))) : m.limit)
                : undefined,
            enabled: typeof o.enabled === 'boolean' ? o.enabled : defaultEnabled(m)
        };
    });
    return includeDisabled ? out : out.filter(m => m.enabled);
}

function getModel(key, { includeDisabled = false } = {}) {
    return listModels({ includeDisabled }).find(m => m.key === key) || null;
}

function modelsByGroup(group) {
    return listModels().filter(m => m.group === group);
}

function listPackages() {
    const list = Array.isArray(overrides.packages) ? overrides.packages : BASE_PACKAGES;
    return list.filter(p => p && p.id && Number(p.credits) > 0 && Number(p.price) > 0);
}

function getPackage(id) {
    return listPackages().find(p => p.id === id) || null;
}

function getGeneral() {
    return { ...BASE_GENERAL, ...overrides.general };
}

function defaultModelKey() {
    const wanted = getGeneral().default_model;
    if (getModel(wanted)) return wanted;
    const first = listModels()[0];
    return first ? first.key : 'flash';
}

async function load(db) {
    try {
        const rows = await db.getSettings(['models', 'packages', 'general']);
        overrides = {
            models: rows.models && typeof rows.models === 'object' ? rows.models : {},
            packages: Array.isArray(rows.packages) ? rows.packages : null,
            general: rows.general && typeof rows.general === 'object' ? rows.general : {}
        };
    } catch (e) {
        console.error('⚠️ Не удалось загрузить настройки каталога:', e.message);
    }
}

function sanitizeModelOverrides(input) {
    const known = new Set(BASE_MODELS.map(m => m.key));
    const out = {};
    for (const [key, o] of Object.entries(input || {})) {
        if (!known.has(key) || !o || typeof o !== 'object') continue;
        const item = {};
        if (typeof o.enabled === 'boolean') item.enabled = o.enabled;
        if (o.cost !== undefined && o.cost !== '' && Number.isFinite(Number(o.cost))) item.cost = Math.max(0, Math.round(Number(o.cost)));
        if (o.limit !== undefined && o.limit !== '' && Number.isFinite(Number(o.limit))) item.limit = Math.max(0, Math.round(Number(o.limit)));
        if (typeof o.name === 'string' && o.name.trim()) item.name = o.name.trim().slice(0, 60);
        if (typeof o.short === 'string' && o.short.trim()) item.short = o.short.trim().slice(0, 30);
        if (typeof o.desc === 'string') item.desc = o.desc.trim().slice(0, 80);
        out[key] = item;
    }
    return out;
}

function sanitizePackages(input) {
    if (!Array.isArray(input)) return null;
    const seen = new Set();
    const out = [];
    for (const p of input) {
        const credits = Math.round(Number(p && p.credits));
        const price = Math.round(Number(p && p.price));
        if (!(credits > 0) || !(price > 0)) continue;
        let id = String((p.id || `pack_${credits}`)).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `pack_${credits}`;
        while (seen.has(id)) id += '_x';
        seen.add(id);
        out.push({ id, credits, price, title: String(p.title || `${credits} кредитов`).trim().slice(0, 60) });
    }
    return out;
}

function sanitizeGeneral(input) {
    const g = input || {};
    const out = {};
    if (g.start_bonus !== undefined && Number.isFinite(Number(g.start_bonus))) out.start_bonus = Math.max(0, Math.round(Number(g.start_bonus)));
    if (typeof g.default_model === 'string' && BASE_MODELS.some(m => m.key === g.default_model)) out.default_model = g.default_model;
    if (typeof g.help_text === 'string' && g.help_text.trim()) out.help_text = g.help_text.trim().slice(0, 3500);
    if (typeof g.support_enabled === 'boolean') out.support_enabled = g.support_enabled;
    if (typeof g.site_url === 'string') out.site_url = g.site_url.trim().slice(0, 200);
    return out;
}

async function saveModels(db, input) {
    const value = sanitizeModelOverrides(input);
    await db.setSetting('models', value);
    overrides.models = value;
    return listModels({ includeDisabled: true });
}

async function savePackages(db, input) {
    const value = sanitizePackages(input);
    await db.setSetting('packages', value);
    overrides.packages = value;
    return listPackages();
}

async function saveGeneral(db, input) {
    const value = { ...overrides.general, ...sanitizeGeneral(input) };
    await db.setSetting('general', value);
    overrides.general = value;
    return getGeneral();
}

module.exports = {
    GROUPS,
    RATIOS,
    BASE_MODELS,
    listModels,
    getModel,
    modelsByGroup,
    listPackages,
    getPackage,
    getGeneral,
    defaultModelKey,
    load,
    saveModels,
    savePackages,
    saveGeneral
};
