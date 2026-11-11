// Каталог моделей, пакетов кредитов и общих настроек.
// Базовые значения заданы в коде, админка хранит поверх них правки в таблице settings.
// Бот строит клавиатуры синхронно, поэтому всё держится в памяти и перечитывается после сохранения.

const GROUPS = {
    text: '💬 Текст',
    text_pro: '💬 Текст · сильнее',
    image: '🖼 Картинки',
    video: '🎬 Видео · недорого',
    video_mid: '🎬 Видео',
    video_top: '👑 Видео · качество',
    music: '🎵 Музыка и голос',
    free: '🎁 Бесплатные',
    fix: '✨ Улучшить фото'
};

// Цены моделей сайта не удваиваются: 1 кредит = 1 ₽, как на сайте.
// Google остаётся на своих ключах. Названия как на сайте: «Чат Flash», «Чат Pro», «Картинка».
// site: true — запрос в Братуху собирается так же, как на сайте.
// cost — цена запуска с режимом и длиной по умолчанию. rate — цена одной секунды.
const A = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const BASE_MODELS = [
    { key: 'flash', name: 'Чат Flash', short: 'Чат Flash', desc: 'Текст. Быстрые ответы, код и разбор фото', group: 'text', kind: 'text', provider: 'google', cost: 4, image: 'optional' },
    { key: 'flash_25', name: 'Чат Flash 2', short: 'Чат Flash 2', desc: 'Текст. Второй быстрый чат', group: 'text', kind: 'text', provider: 'google', cost: 4, image: 'optional' },
    { key: 'pro', name: 'Чат Pro', short: 'Чат Pro', desc: 'Текст. Длинные ответы, аналитика и код', group: 'text_pro', kind: 'text', provider: 'google', cost: 15, image: 'optional' },

    // Только low и 1024×1024. ~1,5–1,8 ₽ у ProxyAPI. 5 кредитов — запас на текст запроса; в админке цену можно сменить.
    { key: 'px-gpt-image-mini', name: 'GPT Image Mini', short: 'GPT Mini', desc: 'Картинка 1024, только дешёвый режим, без фото', group: 'image', kind: 'image', provider: 'proxyapi', upstream: 'openai/gpt-image-1-mini', cost: 5, apiRub: 3, maxChars: 600, image: 'forbidden' },
    { key: 'px-gpt-image-2-low', name: 'GPT Image 2 эконом', short: 'GPT 2 эконом', desc: 'Картинка 1024, только дешёвый режим, без фото', group: 'image', kind: 'image', provider: 'proxyapi', upstream: 'openai/gpt-image-2', cost: 5, apiRub: 3, maxChars: 600, image: 'forbidden' },

    { key: 'giga-lite', name: 'GigaChat 2 Lite', short: 'Giga Lite', desc: 'Бесплатно, лимит в день', group: 'free', kind: 'text', provider: 'giga', cost: 0, limit: 30, image: 'no' },
    { key: 'giga-pro', name: 'GigaChat 2 Pro', short: 'Giga Pro', desc: 'Бесплатно, лимит в день', group: 'free', kind: 'text', provider: 'giga', cost: 0, limit: 10, image: 'no' },
    { key: 'giga-max', name: 'GigaChat 2 Max', short: 'Giga Max', desc: 'Бесплатно, лимит в день', group: 'free', kind: 'text', provider: 'giga', cost: 0, limit: 5, image: 'no' },
    { key: 'giga-ultra', name: 'GigaChat 3 Ultra', short: 'Giga Ultra', desc: 'Бесплатно, лимит в день', group: 'free', kind: 'text', provider: 'giga', cost: 0, limit: 5, image: 'no' },

    { key: 'nano-banana', name: 'Nano Banana', short: 'Nano Banana', desc: 'Быстрые картинки и правка фото', group: 'image', kind: 'image', provider: 'bratukha', site: true, cost: 6, image: 'optional', ratio: true, aspects: ['1:1', '4:5', '3:4', '9:16', '4:3', '16:9'], qualities: [{ id: 'cheap', name: 'Эконом', desc: 'Дешевле, но медленнее', cost: 3 }, { id: 'normal', name: 'Быстро', desc: 'Обычный режим', cost: 6 }], quality: 'normal' },
    { key: 'gpt-image-2', name: 'GPT Image 2', short: 'GPT Image 2', desc: 'Точный текст на картинке', group: 'image', kind: 'image', provider: 'bratukha', site: true, cost: 30, image: 'optional', ratio: true, aspects: ['1:1', '4:5', '3:4', '9:16', '4:3', '16:9'], resolution: '1k', cheapFirst: true, qualities: [{ id: 'low', name: 'Быстро', desc: 'Черновик', cost: 6 }, { id: 'medium', name: 'Стандарт', desc: 'Точный текст', cost: 30 }, { id: 'high', name: 'Максимум', desc: 'Высокая детализация', cost: 90 }], quality: 'medium' },
    { key: 'grok-image', name: 'Grok Image', short: 'Grok Image', desc: 'Яркие картинки и правка фото', group: 'image', kind: 'image', provider: 'bratukha', site: true, cost: 12, image: 'optional', ratio: true, aspects: ['1:1', '9:16', '16:9'] },
    { key: 'seedream-4-0', name: 'Seedream 4.0', short: 'Seedream 4', desc: 'Генерация фото', group: 'image', kind: 'image', provider: 'bratukha', cost: 15, image: 'optional', ratio: true },
    { key: 'seedream-4-5', name: 'Seedream 4.5', short: 'Seedream 4.5', desc: 'Детальные картинки, до 4K', group: 'image', kind: 'image', provider: 'bratukha', site: true, cost: 15, image: 'optional', ratio: true, aspects: ['1:1', '3:4', '9:16', '4:3', '16:9'], qualities: [{ id: '2K', name: '2K', desc: 'Для экрана и соцсетей', cost: 15 }, { id: '4K', name: '4K', desc: 'Для печати', cost: 15 }], quality: '2K' },
    { key: 'wan-2-7-image', name: 'Wan 2.7 Image', short: 'Wan Image', desc: 'Точно следует описанию', group: 'image', kind: 'image', provider: 'bratukha', site: true, cost: 15, image: 'optional', ratio: true, aspects: ['1:1', '3:4', '9:16', '4:3', '16:9'], qualities: [{ id: 'standard', name: 'Обычная', desc: 'Хорошее качество', cost: 15 }, { id: 'pro', name: 'Pro', desc: 'Больше деталей', cost: 30 }], quality: 'standard' },
    { key: 'recraft-v4', name: 'Recraft V4', short: 'Recraft 4', desc: 'Вектор и растр', group: 'image', kind: 'image', provider: 'bratukha', cost: 15, image: 'optional', ratio: true },
    { key: 'grok-video-480', name: 'Grok Video 480p', short: 'Grok 480p', desc: 'Ролики 6–30 сек по тексту или из фото', group: 'video', kind: 'video', provider: 'bratukha', site: true, tool: 'grok-video', resolution: '480p', rate: 6, perSec: true, cost: 36, image: 'optional', ratio: true, aspects: ['16:9', '9:16', '1:1'], durations: [6, 10, 15, 20, 30] },
    { key: 'grok-video-720', name: 'Grok Video 720p', short: 'Grok 720p', desc: 'То же в 720p — чётче', group: 'video', kind: 'video', provider: 'bratukha', site: true, tool: 'grok-video', resolution: '720p', rate: 9, perSec: true, cost: 54, image: 'optional', ratio: true, aspects: ['16:9', '9:16', '1:1'], durations: [6, 10, 15, 20, 30] },
    { key: 'veo-3-1-lite', name: 'Veo 3.1 Lite', short: 'Veo Lite', desc: '8 сек по описанию, самая доступная', group: 'video', kind: 'video', provider: 'bratukha', site: true, tool: 'veo-3-1', vmodel: 'veo3.1-lite', cost: 30, image: 'forbidden', ratio: true, aspects: ['16:9', '9:16'] },

    { key: 'nanobanana', name: 'Картинка', short: 'Картинка', desc: 'Картинка и правка фото', group: 'image', kind: 'image', provider: 'google', cost: 20, image: 'optional' },
    { key: 'recraft-v4-1', name: 'Recraft V4.1', short: 'Recraft 4.1', desc: 'Улучшенный V4', group: 'image', kind: 'image', provider: 'bratukha', cost: 20, image: 'optional', ratio: true },
    { key: 'qwen-image-2-1', name: 'Qwen Image 2.1', short: 'Qwen 2.1', desc: 'Арт и фото', group: 'image', kind: 'image', provider: 'bratukha', cost: 40, image: 'optional', ratio: true },
    { key: 'qwen-image-3-0', name: 'Qwen Image 3.0', short: 'Qwen 3.0', desc: 'Арт и фото', group: 'image', kind: 'image', provider: 'bratukha', cost: 45, image: 'optional', ratio: true },
    { key: 'veo-3-1-fast', name: 'Veo 3.1 Fast', short: 'Veo Fast', desc: '8 сек со звуком, по тексту или из фото', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, tool: 'veo-3-1', vmodel: 'veo3.1-fast', cost: 60, image: 'optional', ratio: true, aspects: ['16:9', '9:16'] },
    { key: 'seedance-1-0', name: 'Seedance 1.0', short: 'Seedance 1', desc: 'Короткие ролики по описанию', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, cost: 60, image: 'optional', ratio: true, aspects: ['16:9', '9:16', '1:1'] },
    { key: 'wan-3-0-480', name: 'Wan 3.0 480p', short: 'Wan 480p', desc: 'Видео со звуком по тексту или из фото', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, tool: 'wan-3-0', resolution: '480P', rate: 15, perSec: true, cost: 75, image: 'optional', ratio: true, aspects: A, durations: [5, 10, 15] },
    { key: 'kling-2-1-standard', name: 'Kling 2.1 Standard', short: 'Kling Standard', desc: 'Оживляет фото — нужно прикрепить фото', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, tool: 'kling-2-1', kmodel: 'kling/v2-1-standard', cost: 75, image: 'required', noAspect: true, durations: [5, 10], durationPrices: { 5: 75, 10: 150 } },
    { key: 'seedance-2-0-apimart', name: 'Seedance 2.0', short: 'Seedance 2', desc: 'Только по тексту, без фото', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, rate: 18, perSec: true, cost: 90, image: 'forbidden', ratio: true, aspects: ['16:9', '9:16', '1:1'], durations: [5, 10] },
    { key: 'pika-720', name: 'Pika 2.2 720p', short: 'Pika 720p', desc: 'Яркая анимация, без звука', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, tool: 'pika', resolution: '720p', cost: 105, image: 'optional', ratio: true, aspects: ['16:9', '9:16', '1:1', '4:5'], durations: [5, 10], durationPrices: { 5: 105, 10: 240 } },
    { key: 'sora-2', name: 'Sora 2', short: 'Sora 2', desc: 'Видео со звуком, до 20 сек', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, rate: 30, perSec: true, cost: 120, image: 'optional', ratio: true, aspects: ['9:16', '16:9'], durations: [4, 8, 12, 16, 20] },
    { key: 'seedance-1-5-pro', name: 'Seedance 1.5 Pro', short: 'Seedance 1.5', desc: 'Видео из фото', group: 'video_mid', kind: 'video', provider: 'bratukha', cost: 120, image: 'required', ratio: true },
    { key: 'kling-2-1-pro', name: 'Kling 2.1 Pro', short: 'Kling Pro', desc: 'Оживляет фото качественнее', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, tool: 'kling-2-1', kmodel: 'kling/v2-1-pro', cost: 120, image: 'required', noAspect: true, durations: [5, 10], durationPrices: { 5: 120, 10: 270 } },
    { key: 'wan-3-0-prime-480', name: 'Wan 3.0 Prime 480p', short: 'Wan Prime 480', desc: 'Флагман Wan: лучше движение и звук', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, tool: 'wan-3-0-video-prime', resolution: '480P', rate: 27, perSec: true, cost: 135, image: 'optional', ratio: true, aspects: A, durations: [5, 10, 15] },
    { key: 'pruna-ai-p-video-2-pro', name: 'Pruna P-Video 2 Pro', short: 'Pruna Video', desc: 'Оживляет фото — нужно прикрепить фото', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, rate: 28, perSec: true, cost: 140, image: 'required', ratio: true, aspects: ['16:9', '9:16', '1:1'], durations: [5, 10] },
    { key: 'wan-2-2-avatar', name: 'Wan 2.2 Avatar', short: 'Говорящее фото', desc: 'Фото и голосовое: человек на фото произнесёт запись', group: 'video_mid', kind: 'video', provider: 'bratukha', site: true, tool: 'wan-2-2-avatar', cost: 18, rate: 18, unit: 'sec', image: 'required', audio: true, noAspect: true, qualities: [{ id: '480p', name: '480p', desc: 'Быстрее и дешевле', cost: 18, perSec: true }, { id: '720p', name: '720p', desc: 'Чётче', cost: 30, perSec: true }], quality: '480p' },

    { key: 'nanobanana_pro', name: 'Картинка Pro', short: 'Картинка Pro', desc: 'Детальная картинка и правка фото', group: 'image', kind: 'image', provider: 'google', cost: 50, image: 'optional' },
    { key: 'runway-gen4-image', name: 'Runway Gen4', short: 'Runway', desc: 'Реализм', group: 'image', kind: 'image', provider: 'bratukha', cost: 80, image: 'optional', ratio: true },
    { key: 'wan-3-0-720', name: 'Wan 3.0 720p', short: 'Wan 720p', desc: 'Видео со звуком в 720p', group: 'video_top', kind: 'video', provider: 'bratukha', site: true, tool: 'wan-3-0', resolution: '720P', rate: 30, perSec: true, cost: 150, image: 'optional', ratio: true, aspects: A, durations: [5, 10, 15] },
    { key: 'seedance-2-5-480', name: 'Seedance 2.5 480p', short: 'Seedance 2.5', desc: 'Новый Seedance со звуком', group: 'video_top', kind: 'video', provider: 'bratukha', site: true, tool: 'seedance-2-5', resolution: '480p', rate: 42, perSec: true, cost: 168, image: 'optional', ratio: true, aspects: A, durations: [4, 6, 8, 10] },
    { key: 'gemini-omni', name: 'Gemini Omni', short: 'Gemini Omni', desc: 'Видео со звуком и речью, до 10 сек', group: 'video_top', kind: 'video', provider: 'bratukha', site: true, cost: 180, image: 'optional', ratio: true, aspects: ['16:9', '9:16'], durations: [4, 6, 8, 10], durationPrices: { 4: 180, 6: 240, 8: 300, 10: 360 } },
    { key: 'pika-1080', name: 'Pika 2.2 1080p', short: 'Pika 1080p', desc: 'Pika в 1080p, без звука', group: 'video_top', kind: 'video', provider: 'bratukha', site: true, tool: 'pika', resolution: '1080p', cost: 210, image: 'optional', ratio: true, aspects: ['16:9', '9:16', '1:1', '4:5'], durations: [5, 10], durationPrices: { 5: 210, 10: 480 } },
    { key: 'wan-3-0-prime-720', name: 'Wan 3.0 Prime 720p', short: 'Wan Prime 720', desc: 'Флагман Wan в 720p', group: 'video_top', kind: 'video', provider: 'bratukha', site: true, tool: 'wan-3-0-video-prime', resolution: '720P', rate: 54, perSec: true, cost: 270, image: 'optional', ratio: true, aspects: A, durations: [5, 10, 15] },
    { key: 'veo-3-1-quality', name: 'Veo 3.1 Quality', short: 'Veo Quality', desc: 'Максимальное качество, 8 сек', group: 'video_top', kind: 'video', provider: 'bratukha', site: true, tool: 'veo-3-1', vmodel: 'veo3.1-quality', cost: 300, image: 'optional', ratio: true, aspects: ['16:9', '9:16'] },
    { key: 'seedance-2-5-720', name: 'Seedance 2.5 720p', short: 'Seedance 2.5 720', desc: 'Seedance 2.5 в 720p', group: 'video_top', kind: 'video', provider: 'bratukha', site: true, tool: 'seedance-2-5', resolution: '720p', rate: 84, perSec: true, cost: 336, image: 'optional', ratio: true, aspects: A, durations: [4, 6, 8, 10] },
    { key: 'kling-2-1-master', name: 'Kling 2.1 Master', short: 'Kling Master', desc: 'Топ-качество Kling, по тексту или из фото', group: 'video_top', kind: 'video', provider: 'bratukha', site: true, tool: 'kling-2-1', kmodel: 'master', cost: 420, image: 'optional', ratio: true, aspects: ['16:9', '9:16', '1:1'], durations: [5, 10], durationPrices: { 5: 420, 10: 840 } },

    { key: 'suno', name: 'Suno', short: 'Suno', desc: 'Песня, музыка или звуки — два варианта', group: 'music', kind: 'audio', provider: 'bratukha', site: true, cost: 30, image: 'forbidden', noAspect: true, qualities: [{ id: 'song', name: 'Песня', desc: 'Текст и музыку напишет сама', cost: 30 }, { id: 'instrumental', name: 'Инструментал', desc: 'Музыка без слов', cost: 30 }, { id: 'sounds', name: 'Звуки', desc: 'Дождь, город, костёр', cost: 30 }], quality: 'song' },
    { key: 'qwen3-tts-flash', name: 'Озвучка быстрая', short: 'Озвучка быстрая', desc: 'Быстрая озвучка текста', group: 'music', kind: 'audio', provider: 'bratukha', cost: 100, image: 'no' },
    { key: 'qwen3-tts', name: 'Озвучка', short: 'Озвучка', desc: 'Озвучка текста', group: 'music', kind: 'audio', provider: 'bratukha', cost: 100, image: 'no' },

    { key: 'p-image-upscale', name: 'Pruna Upscale', short: 'Резкость', desc: 'Резкость фото', group: 'fix', kind: 'image', provider: 'bratukha', cost: 10, image: 'required' },
    { key: 'recraft-crisp-upscale', name: 'Recraft Crisp', short: 'Апскейл чёткий', desc: 'Чёткий апскейл', group: 'fix', kind: 'image', provider: 'bratukha', cost: 10, image: 'required' },
    { key: 'sam-3d', name: 'SAM 3D', short: 'Фото в 3D', desc: 'Фото в 3D', group: 'fix', kind: 'image', provider: 'bratukha', cost: 40, image: 'required' },
    { key: 'phota-enhance', name: 'Phota Enhance', short: 'Улучшить фото', desc: 'Улучшение фото', group: 'fix', kind: 'image', provider: 'bratukha', cost: 220, image: 'required' },
    { key: 'recraft-creative-upscale', name: 'Recraft Creative', short: 'Апскейл креатив', desc: 'Креативный апскейл', group: 'fix', kind: 'image', provider: 'bratukha', cost: 400, image: 'required' }
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
        '• Текст — Чат Flash и Чат Pro, картинки — Картинка и Картинка Pro\n' +
        '• Картинки, видео, песни и озвучка — те же модели и цены, что на сайте\n' +
        '• Разделы отдельно: текст, картинки, видео, музыка\n\n' +
        'Выберите модель и отправьте запрос текстом или фото. То же самое есть в «Кабинете».',
    support_enabled: true,
    site_url: 'https://babayagaland.ru'
};

let overrides = { models: {}, packages: null, general: {} };

function defaultEnabled(m) {
    if (m.provider === 'giga') return !!process.env.GIGACHAT_AUTH_KEY;
    if (m.provider === 'proxyapi') return !!(process.env.PROXYAPI_KEY || process.env.PROXYAPI_API_KEY || process.env.PROXY_API_KEY);
    return true;
}

// null — лимит снят, число (включая 0) — жёсткий дневной потолок, отсутствие ключа — значение по умолчанию.
function resolvedLimit(model, override) {
    if (model.provider !== 'giga') return undefined;
    if (!override || !Object.prototype.hasOwnProperty.call(override, 'limit')) return model.limit;
    if (override.limit === null || override.limit === '') return null;
    const n = Number(override.limit);
    if (!Number.isFinite(n)) return model.limit;
    return Math.max(0, Math.round(n));
}

function chosenQuality(model, quality) {
    const list = model.qualities || [];
    if (!list.length) return null;
    return list.find(q => q.id === quality) || list.find(q => q.id === model.quality) || list[0];
}

function fromPrice(model) {
    if (!model) return 0;
    if (model.provider === 'giga') return 0;
    if (model.durationPrices) return Math.min(...Object.values(model.durationPrices).map(Number));
    const list = model.qualities || [];
    if (list.length) {
        return Math.min(...list.map(q => q.perSec ? q.cost : q.cost));
    }
    if (model.perSec) return (model.rate || model.cost) * ((model.durations && model.durations[0]) || 1);
    return model.cost;
}

function priceLabel(model) {
    if (!model || model.provider === 'giga' || model.cost === 0) return 'бесплатно';
    if (model.unit === 'sec') {
        const min = Math.min(...(model.qualities || []).map(q => q.cost).concat(model.rate || model.cost));
        return ((model.qualities || []).length > 1 ? 'от ' : '') + min + ' кр/сек';
    }
    const min = fromPrice(model);
    const prices = new Set();
    if (model.durationPrices) Object.values(model.durationPrices).forEach(v => prices.add(Number(v)));
    (model.qualities || []).forEach(q => prices.add(q.cost));
    if (model.perSec && model.durations) model.durations.forEach(d => prices.add((model.rate || model.cost) * d));
    if (prices.size > 1 || model.perSec) return 'от ' + min + ' кр';
    return min + ' кр';
}

// Цена конкретного запуска. seconds — длина голосовой записи для говорящего фото.
function quote(model, opts) {
    const o = opts || {};
    if (!model || model.provider === 'giga') return 0;
    if (model.durationPrices) {
        const d = String(o.duration || (model.durations && model.durations[0]) || '');
        if (model.durationPrices[d] != null) return Number(model.durationPrices[d]);
        return fromPrice(model);
    }
    const q = chosenQuality(model, o.quality);
    if (q && q.perSec) {
        const seconds = Number(o.seconds || o.duration) || 1;
        return q.cost * seconds;
    }
    if (q) return q.cost;
    if (model.perSec) {
        const seconds = Number(o.duration) || (model.durations && model.durations[0]) || 1;
        return (model.rate || model.cost) * seconds;
    }
    if (model.unit === 'sec') return (model.rate || model.cost) * (Number(o.seconds) || 1);
    return model.cost;
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
            limit: resolvedLimit(m, Object.prototype.hasOwnProperty.call(overrides.models, m.key) ? overrides.models[m.key] : null),
            enabled: typeof o.enabled === 'boolean' ? o.enabled : defaultEnabled(m)
        };
    });
    return includeDisabled ? out : out.filter(m => m.enabled);
}

function getModel(key, { includeDisabled = false } = {}) {
    return listModels({ includeDisabled }).find(m => m.key === key) || null;
}

function modelsByGroup(group) {
    return listModels()
        .filter(m => m.group === group)
        .sort((a, b) => fromPrice(a) - fromPrice(b) || a.order - b.order);
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

function asJson(value) {
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch (e) { return null; }
    }
    return value;
}

async function load(db) {
    try {
        const rows = await db.getSettings(['models', 'packages', 'general']);
        const models = asJson(rows.models);
        const packages = asJson(rows.packages);
        const general = asJson(rows.general);
        overrides = {
            models: models && typeof models === 'object' && !Array.isArray(models) ? models : {},
            packages: Array.isArray(packages) ? packages : null,
            general: general && typeof general === 'object' && !Array.isArray(general) ? general : {}
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
        const base = BASE_MODELS.find(m => m.key === key);
        if (base && base.provider === 'giga' && Object.prototype.hasOwnProperty.call(o, 'limit')) {
            if (o.limit === null || o.limit === '') item.limit = null;
            else if (Number.isFinite(Number(o.limit))) item.limit = Math.max(0, Math.round(Number(o.limit)));
        }
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
    fromPrice,
    priceLabel,
    quote,
    listPackages,
    getPackage,
    getGeneral,
    defaultModelKey,
    load,
    saveModels,
    savePackages,
    saveGeneral
};
