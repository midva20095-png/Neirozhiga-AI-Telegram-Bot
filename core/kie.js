// Сборка запросов в Kie.ai. Сеть здесь не вызывается: плагин только отправляет готовое тело.
// Размер и режим берутся из каталога. Чужой quality в запрос не попадает, чтобы не уехать в дорогой тариф.

const IDEOGRAM_SIZE = {
    '1:1': 'square_hd',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '4:3': 'landscape_4_3',
    '3:4': 'portrait_4_3'
};

function allowedSize(spec, quality) {
    const list = spec.qualities || [];
    if (!list.length) return spec.kieSizeValue || null;
    const found = list.find(q => q.id === quality) || list.find(q => q.id === spec.quality) || list[0];
    return found ? found.id : null;
}

function aspectOf(spec, aspect) {
    const list = spec.aspects || [];
    if (aspect && list.includes(aspect)) return aspect;
    return list[0] || '1:1';
}

function buildImageTask(spec, opts) {
    const o = opts || {};
    const images = (Array.isArray(o.imageUrls) ? o.imageUrls : []).filter(u => typeof u === 'string' && u.startsWith('https://')).slice(0, 1);
    if (images.length && !spec.kieEdit) {
        const err = new Error('Эта модель рисует только по тексту, без фото.');
        err.code = 'user';
        throw err;
    }
    const model = images.length ? spec.kieEdit : spec.kieModel;
    const prompt = String(o.prompt || '').trim();
    const input = { prompt: prompt.slice(0, spec.maxChars || 4000) };
    const aspect = aspectOf(spec, o.aspect);

    if (spec.kieAspect === 'image_size') {
        input.image_size = IDEOGRAM_SIZE[aspect] || 'square_hd';
        input.rendering_speed = 'TURBO';
        input.style = 'AUTO';
        input.expand_prompt = true;
    } else if (spec.kieAspect) {
        input[spec.kieAspect] = aspect;
    }

    const size = allowedSize(spec, o.quality);
    if (size && spec.kieSize) input[spec.kieSize] = size;

    if (images.length && spec.kieImage) input[spec.kieImage] = [images[0]];
    if (spec.kieExtra) Object.assign(input, spec.kieExtra);

    return { model, input };
}

function buildChat(spec, prompt) {
    const chat = spec.kieChat || {};
    const text = String(prompt || '').trim().slice(0, chat.maxChars || 3500);
    if (chat.style === 'responses') {
        const body = {
            model: chat.model,
            stream: false,
            input: text,
            reasoning: { effort: 'none' },
            max_output_tokens: chat.maxTokens || 800
        };
        const retry = { model: chat.model, stream: false, input: text, reasoning: { effort: 'none' } };
        return { path: chat.path, body, retry };
    }
    if (chat.style === 'claude') {
        return {
            path: chat.path,
            body: {
                model: chat.model,
                stream: false,
                max_tokens: chat.maxTokens || 700,
                messages: [{ role: 'user', content: text }]
            }
        };
    }
    const body = {
        stream: false,
        reasoning_effort: 'low',
        include_thoughts: false,
        max_tokens: chat.maxTokens || 800,
        messages: [{ role: 'user', content: text }]
    };
    const retry = {
        stream: false,
        reasoning_effort: 'low',
        include_thoughts: false,
        messages: [{ role: 'user', content: text }]
    };
    return { path: chat.path, body, retry };
}

function textFromResponse(style, data) {
    if (!data || typeof data !== 'object') return '';
    if (style === 'responses') {
        const blocks = Array.isArray(data.output) ? data.output : [];
        const parts = [];
        for (const block of blocks) {
            if (!block || block.type === 'reasoning') continue;
            const content = Array.isArray(block.content) ? block.content : [];
            for (const part of content) {
                if (part && part.type === 'output_text' && part.text) parts.push(part.text);
            }
        }
        return parts.join('\n').trim();
    }
    if (style === 'claude') {
        const content = Array.isArray(data.content) ? data.content : [];
        return content.filter(p => p && p.type === 'text' && p.text).map(p => p.text).join('\n').trim();
    }
    const message = data.choices && data.choices[0] && data.choices[0].message;
    const content = message && message.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content.map(p => (p && (p.text || p.content)) || '').filter(Boolean).join('\n').trim();
    }
    return '';
}

function taskView(data) {
    const row = (data && data.data) || {};
    let urls = [];
    if (row.resultJson) {
        try {
            const parsed = typeof row.resultJson === 'string' ? JSON.parse(row.resultJson) : row.resultJson;
            if (parsed && Array.isArray(parsed.resultUrls)) urls = parsed.resultUrls.filter(u => typeof u === 'string');
        } catch (e) {}
    }
    return {
        state: row.state || '',
        urls,
        fail: String(row.failMsg || row.failCode || '').slice(0, 160)
    };
}

function explainFailure(text) {
    const raw = String(text || '');
    if (/content moderation|blocked by|safety|nsfw/i.test(raw)) {
        return 'Запрос не прошёл проверку. Измените описание или фото и попробуйте ещё раз.';
    }
    if (/input was rejected|different input/i.test(raw)) {
        return 'Модель не приняла этот запрос. Измените описание и попробуйте ещё раз.';
    }
    if (/internal error|try again later|unavailable|bad gateway|timeout/i.test(raw)) {
        return 'Модель сейчас не отвечает. Кредиты не списаны. Попробуйте через минуту.';
    }
    return '';
}

function promptTooLong(spec, prompt) {
    const chat = spec.kieChat;
    if (!chat) return false;
    return String(prompt || '').trim().length > (chat.maxChars || 3500);
}

module.exports = {
    IDEOGRAM_SIZE,
    allowedSize,
    buildImageTask,
    buildChat,
    textFromResponse,
    taskView,
    explainFailure,
    promptTooLong
};
