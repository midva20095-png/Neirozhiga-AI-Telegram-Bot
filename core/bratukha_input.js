// Сборка запроса в Братуху. Поля те же, что на сайте, чтобы модели и режимы совпадали.

const TEXT_WORDS = /надпис|текст|написа|подпис|титр|слоган|логотип/i;
const VOICE_WORDS = /говор|скаж|произн|озвуч|голос|поёт|поет|песн|диалог|реплик|кричит|шепч/i;
const QUOTE_RE = /[«"“„']([^«»"“”„']{1,120})[»"”']/g;
const ORIENT = {
    '16:9': 'Горизонтальное видео 16:9.',
    '9:16': 'Вертикальное видео 9:16.',
    '1:1': 'Квадратное видео 1:1.'
};

function quotes(prompt) {
    const out = [];
    const re = new RegExp(QUOTE_RE.source, 'g');
    let m;
    while ((m = re.exec(prompt || ''))) {
        if (m[1] && m[1].trim()) out.push(m[1].trim());
    }
    return out;
}

function textRule(prompt) {
    const quoted = quotes(prompt);
    if ((quoted.length && TEXT_WORDS.test(prompt || '')) || (quoted.length && !VOICE_WORDS.test(prompt || ''))) {
        return 'На экране крупная чёткая надпись ровно такая: ' + quoted.slice(0, 3).map(q => `«${q}»`).join('; ') + '. Других надписей нет.';
    }
    if (TEXT_WORDS.test(prompt || '')) return 'Надпись на экране сделай так, как описано выше, крупно и чётко. Других надписей и субтитров нет.';
    return 'Без надписей, букв, субтитров, логотипов и водяных знаков на экране.';
}

function soundRule(prompt) {
    if (VOICE_WORDS.test(prompt || '')) return 'Звук: речь и голоса только те, что описаны выше, плюс естественные звуки сцены.';
    return 'Звук: только атмосферная музыка и естественные звуки сцены, без речи и без закадрового голоса.';
}

function videoPrompt(prompt, hasImage, aspect) {
    let p = String(prompt || '').trim().replace(/\.+$/, '');
    if (hasImage) p = p.replace(/^\s*оживи(те)?\s+(эту\s+|мою\s+)?(картинку|изображение|фото|фотографию|фотку)\s*(,|и\s+)?\s*/i, '').trim();
    const parts = [];
    if (hasImage) {
        parts.push(p ? `Оживи изображение: ${p}.` : 'Оживи изображение.');
        parts.push('Сохрани тех же людей, их лица, предметы, композицию, цвета и стиль исходной картинки.');
        parts.push('Плавное естественное движение, кинематографичная камера.');
    } else {
        parts.push(p ? `${p}.` : '');
        parts.push('Плавное кинематографичное видео, детальная картинка.');
    }
    parts.push(ORIENT[aspect] || '', textRule(p), soundRule(p));
    return parts.filter(Boolean).join(' ');
}

function imagePrompt(prompt, imageUrl) {
    let text = String(prompt || '').trim().replace(/\.+$/, '') + '.';
    const quoted = quotes(prompt);
    if (quoted.length) text += ' Текст на изображении — дословно, без ошибок: ' + quoted.slice(0, 3).map(q => `«${q}»`).join('; ') + '.';
    else if (!TEXT_WORDS.test(prompt || '')) text += ' Без лишних надписей и водяных знаков.';
    if (imageUrl) text = 'Используй приложенное изображение: ' + text + ' Сохрани лица и узнаваемые детали с исходного фото.';
    return text;
}

function buildSiteInput(spec, opts) {
    const o = opts || {};
    const tool = spec.tool || spec.key;
    const imageUrl = o.imageUrl || null;
    const aspect = o.aspect && o.aspect !== 'auto' ? o.aspect : '';
    const duration = o.duration || (spec.durations && spec.durations[0]) || null;
    const quality = o.quality || spec.quality || null;
    const kind = spec.kind;

    if (kind === 'audio' && tool === 'suno') {
        if (quality === 'sounds') {
            return { tool, input: { suno_generation_type: 'sounds', sounds_model: 'V6', sounds_prompt: String(o.prompt || '').slice(0, 500) } };
        }
        return {
            tool,
            input: {
                suno_generation_type: 'create_track',
                customMode: 'false',
                suno_model: 'V6',
                instrumental: quality === 'instrumental' ? 'true' : 'false',
                prompt_simple: String(o.prompt || '').slice(0, 3000)
            }
        };
    }

    if (spec.audio) {
        const input = { image: imageUrl, audio: o.audioUrl, resolution: quality || '480p' };
        if (o.prompt) input.prompt = String(o.prompt).slice(0, 2000);
        return { tool, input };
    }

    if (kind === 'image') {
        const text = imagePrompt(o.prompt, imageUrl);
        let input;
        if (tool === 'nano-banana') input = { mode: quality || 'normal', prompt: text.slice(0, 20000), image_size: aspect || 'auto' };
        else if (tool === 'seedream-4-5') input = { prompt: text.slice(0, 3000), size: aspect || 'auto', resolution: quality || '2K', n: 1 };
        else if (tool === 'wan-2-7-image') {
            input = { prompt: text.slice(0, 5000), tier: quality || 'standard', aspect_ratio: aspect || 'auto' };
            if (imageUrl) input.input_urls = [imageUrl];
        } else if (tool === 'grok-image') {
            input = { prompt: text.slice(0, 5000) };
            if (!imageUrl && aspect) input.aspect_ratio = aspect;
        } else {
            input = {
                prompt: text.slice(0, 20000),
                quality: quality || spec.quality || 'medium',
                size: aspect || 'auto',
                resolution: spec.resolution || '1k',
                mode: o.mode || 'normal'
            };
        }
        if (imageUrl && tool !== 'wan-2-7-image') input.image_urls = [imageUrl];
        return { tool, input };
    }

    const full = videoPrompt(o.prompt, !!imageUrl, aspect || '16:9');
    const asp = aspect || '16:9';
    if (tool === 'wan-3-0' || tool === 'wan-3-0-video-prime') {
        const prime = tool === 'wan-3-0-video-prime';
        const tkey = prime ? 'wan_3_0_prime_generation_type' : 'wan_3_0_generation_type';
        const input = { resolution: spec.resolution, duration: Number(duration || 5), audio: true };
        input[prime ? 'aspect_ratio' : 'size'] = imageUrl ? 'adaptive' : asp;
        if (imageUrl) Object.assign(input, { [tkey]: 'first_frame', frame_prompt: full.slice(0, 20000), first_frame_url: imageUrl });
        else Object.assign(input, { [tkey]: 'text', text_prompt: full.slice(0, 20000) });
        return { tool, input };
    }
    if (tool === 'seedance-2-5') {
        const input = {
            seedance_2_5_generation_type: imageUrl ? 'image' : 'text',
            prompt: full.slice(0, 20000),
            size: imageUrl ? 'adaptive' : asp,
            resolution: spec.resolution,
            duration: Number(duration || 4),
            generate_audio: true,
            watermark: false,
            draft_mode: 'off',
            output_format: 'mp4'
        };
        if (imageUrl) input.image_urls = [imageUrl];
        return { tool, input };
    }
    if (tool === 'kling-2-1') {
        let km = spec.kmodel;
        if (km === 'master') km = imageUrl ? 'kling/v2-1-master-image-to-video' : 'kling/v2-1-master-text-to-video';
        const input = {
            mode: imageUrl ? 'image' : 'text',
            model: km,
            prompt: full.slice(0, 5000),
            duration: String(duration || 5),
            cfg_scale: 0.5,
            negative_prompt: 'blur, low quality, artifacts, text, watermark'
        };
        if (imageUrl) input.image_url = imageUrl;
        else input.aspect_ratio = asp;
        return { tool, input };
    }
    if (tool === 'veo-3-1') {
        const input = {
            generation_type: imageUrl ? 'image' : 'text',
            model: spec.vmodel,
            prompt: full.slice(0, 4000),
            aspect_ratio: asp === '9:16' ? '9:16' : '16:9',
            resolution: '1080p'
        };
        if (imageUrl) input.image_urls = imageUrl;
        return { tool, input };
    }
    if (tool === 'gemini-omni') {
        const input = {
            generation_type: 'video',
            prompt: full.slice(0, 4000),
            duration: String(duration || 4),
            aspect_ratio: asp === '9:16' ? '9:16' : '16:9',
            resolution: '1080p'
        };
        if (imageUrl) input.image_urls = [imageUrl];
        return { tool, input };
    }
    if (tool === 'pika') {
        const input = {
            pika_generation_type: imageUrl ? 'image_to_video' : 'text_to_video',
            prompt: full.slice(0, 4000),
            resolution: spec.resolution,
            duration_seconds_mode: String(duration || 5)
        };
        if (imageUrl) input.image_url = imageUrl;
        else input.aspect_ratio = asp;
        return { tool, input };
    }
    if (tool === 'grok-video') {
        const input = {
            model: imageUrl ? 'grok-imagine/image-to-video' : 'grok-imagine/text-to-video',
            prompt: full.slice(0, 5000),
            duration: Number(duration || 6),
            resolution: spec.resolution || '480p'
        };
        if (imageUrl) input.image_urls = [imageUrl];
        else input.aspect_ratio = aspect || '16:9';
        return { tool, input };
    }
    if (spec.key === 'sora-2' || tool === 'sora-2') {
        const input = {
            sora_ws_generation_type: imageUrl ? 'image' : 'text',
            sora_ws_model_tier: 'standard',
            prompt: full.slice(0, 5000),
            duration: String(duration || 4)
        };
        if (imageUrl) input.image = imageUrl;
        else input.size_std = aspect === '9:16' ? '720*1280' : '1280*720';
        return { tool: 'sora-2', input };
    }

    const input = { prompt: full, text: full };
    if (aspect) Object.assign(input, { aspect_ratio: aspect, ratio: aspect, ar: aspect, size: aspect });
    if (duration) Object.assign(input, { duration, seconds: duration });
    if (imageUrl) Object.assign(input, { image: imageUrl, image_url: imageUrl, images: [imageUrl], file_url: imageUrl, files: [imageUrl] });
    return { tool: spec.key, input };
}

function siteModes(spec, quality) {
    if (spec && spec.cheapFirst && quality !== 'low') return ['cheap', 'normal'];
    if (spec && spec.cheapFirst) return ['normal'];
    return [null];
}

module.exports = { buildSiteInput, siteModes, videoPrompt, imagePrompt };
