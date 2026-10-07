require('dotenv').config();
const axios = require('axios');

// Берем URL из переменных Railway или ставим рабочий дефолт
const BRATUKHA_API_URL = process.env.BRATUKHA_API_URL || 'https://bratuha.ru/api/v1';

// Каталог актуальных моделей (видео строго ограничены вашим списком)
const BRATUKHA_MODELS = [
    // 🎵 Аудио
    { slug: 'qwen3-tts', name: 'Qwen3 TTS', category: 'audio', price: 20, unit: '1000 символов' },
    { slug: 'qwen3-tts-flash', name: 'Qwen3 TTS Flash', category: 'audio', price: 20, unit: '1000 символов' },
    
    // 🖼 Картинки и апскейл
    { slug: 'phota-enhance', name: 'Phota Enhance', category: 'image', price: 44, unit: 'запуск' },
    { slug: 'p-image-upscale', name: 'Pruna AI P-ImageUpscale', category: 'image', price: 1.5, unit: 'МП' },
    { slug: 'qwen-image-2-1', name: 'Qwen Image 2.1', category: 'image', price: 8, unit: 'изображение' },
    { slug: 'qwen-image-3-0', name: 'Qwen Image 3.0', category: 'image', price: 9, unit: 'изображение' },
    { slug: 'recraft-creative-upscale', name: 'Recraft Creative Upscale', category: 'image', price: 80, unit: 'изображение' },
    { slug: 'recraft-crisp-upscale', name: 'Recraft Crisp Upscale', category: 'image', price: 2, unit: 'изображение' },
    { slug: 'recraft-v4', name: 'Recraft V4', category: 'image', price: 14, unit: 'запрос' },
    { slug: 'recraft-v4-1', name: 'Recraft V4.1', category: 'image', price: 12, unit: 'запрос' },
    { slug: 'runway-gen4-image', name: 'Runway Gen4 Image', category: 'image', price: 16, unit: 'изображение' },
    { slug: 'sam-3d', name: 'SAM 3D', category: 'image-3d', price: 8, unit: 'изображение' },
    { slug: 'seedream-4-0', name: 'Seedream 4.0', category: 'image', price: 8, unit: 'изображение' },
    { slug: 'seedream-4-5', name: 'Seedream 4.5', category: 'image', price: 10, unit: 'изображение' },

    // 🎬 Видео и анимация (строго ваш список)
    { slug: 'veo', name: 'Veo 3.1 Видео', category: 'video', price: 400, unit: 'генерация' },
    { slug: 'sora-2', name: 'Sora 2.0', category: 'video', price: 50, unit: 'генерация' },
    { slug: 'seedance-1-0', name: 'Seedance 1.0', category: 'video', price: 20, unit: 'генерация' },
    { slug: 'seedance-1-5-pro', name: 'Seedance 1.5 Pro', category: 'video', price: 14, unit: 'видео' },
    { slug: 'seedance-2-0-apimart', name: 'Seedance 2.0', category: 'video', price: 10, unit: 'сек. видео' },
    { slug: 'pruna-ai-p-video-2-pro', name: 'Pruna P-Video 2 Pro', category: 'video', price: 4, unit: 'сек. видео' }
];

// Модели, которые требуют картинку на вход
const MODELS_REQUIRING_IMAGE = [
    'phota-enhance',
    'p-image-upscale',
    'recraft-creative-upscale',
    'recraft-crisp-upscale'
];

async function uploadBuffer(apiKey, buf, mimeType = 'image/jpeg', filename = 'input_file.jpg') {
    const contentType = mimeType || 'image/jpeg';
    const directLimit = 10 * 1024 * 1024;

    if (buf.length <= directLimit) {
        const res = await axios.post(
            `${BRATUKHA_API_URL}/uploads`,
            {
                filename,
                content_type: contentType,
                data: buf.toString('base64'),
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 60_000,
            }
        );

        if (!res.data?.url) {
            throw new Error(`В ответе /uploads нет url: ${JSON.stringify(res.data)}`);
        }
        return res.data.url;
    }

    const presignRes = await axios.post(
        `${BRATUKHA_API_URL}/uploads/presign`,
        {
            filename,
            content_type: contentType,
            size: buf.length,
        },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 30_000,
        }
    );

    const { url, fields, publicUrl } = presignRes.data || {};
    if (!url || !fields || !publicUrl) {
        throw new Error(`Неполный ответ /uploads/presign: ${JSON.stringify(presignRes.data)}`);
    }

    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
        form.append(key, String(value));
    }

    const blob = new Blob([buf], { type: contentType });
    form.append('file', blob, filename);

    const uploadRes = await fetch(url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
    });

    if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`Ошибка загрузки на presigned URL: ${uploadRes.status} ${errText}`);
    }

    return publicUrl;
}

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, modelKey, size }) {
    const apiKey = process.env.BRATUKHA_API_KEY || process.env.BRATUKHA_TOKEN;
    if (!apiKey) {
        throw new Error('❌ BRATUKHA_API_KEY не задан в переменных окружения Railway');
    }

    let toolSlug = modelKey;
    if (!toolSlug) {
        throw new Error('❌ Не указан slug модели для Братухи');
    }

    const allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
    }

    if (MODELS_REQUIRING_IMAGE.includes(toolSlug) && allBuffers.length === 0) {
        throw new Error('⚠️ Для выбранной модели обязательно требуется прикрепить изображение.');
    }

    const inputData = {};
    if (prompt) {
        inputData.prompt = prompt;
        inputData.text = prompt; // Обязательный параметр для TTS
    }

    // Передаем выбранный размер/соотношение сторон в API
    if (size) {
        inputData.aspect_ratio = size;
        inputData.size = size;
    }

    if (allBuffers.length > 0) {
        const uploadedUrls = [];
        for (let i = 0; i < allBuffers.length; i++) {
            const url = await uploadBuffer(
                apiKey,
                allBuffers[i],
                mimeType || 'image/jpeg',
                `input_${i + 1}.jpg`
            );
            uploadedUrls.push(url);
        }

        if (uploadedUrls.length > 0) {
            inputData.image = uploadedUrls[0];
            inputData.image_url = uploadedUrls[0];
            inputData.images = uploadedUrls;
            inputData.file_url = uploadedUrls[0];
            inputData.files = uploadedUrls;
        }
    }

    const payload = {
        tool: toolSlug,
        input: inputData
    };

    console.log(`🚀 [Bratukha Operations] Создание операции: ${toolSlug} (размер: ${size || 'default'})`);

    let createRes;
    try {
        createRes = await axios.post(`${BRATUKHA_API_URL}/operations`, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30_000,
        });
    } catch (err) {
        if (err.response) {
            const errData = err.response.data;
            console.error(`🚨 [Bratukha API Error] Status: ${err.response.status}`, JSON.stringify(errData));
            throw new Error(errData.error?.message || errData.message || `Ошибка API: статус ${err.response.status}`);
        }
        throw err;
    }

    const operationId = createRes.data?.id || createRes.data?.operation_id;
    if (!operationId) {
        throw new Error('❌ Не удалось получить ID операции от Братухи');
    }

    const maxAttempts = 120;
    const intervalMs = 3000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));

        let statusRes;
        try {
            statusRes = await axios.get(`${BRATUKHA_API_URL}/operations/${operationId}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                timeout: 15_000,
            });
        } catch (pollErr) {
            if (pollErr.response?.status === 429 || pollErr.response?.status === 503) {
                const retryAfter = pollErr.response.headers['retry-after'] || 2;
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                continue;
            }
            if (attempt === maxAttempts - 1) throw pollErr;
            continue;
        }

        const opData = statusRes.data;

        if (opData.status === 'completed') {
            const result = opData.result || opData;
            const resType = result?.type || '';
            const urls = result?.urls || result?.files || result?.images || result?.videos || [];
            const primaryUrl = urls[0] || result?.image_url || result?.video_url || result?.audio_url || result?.url;

            const isVideo = resType === 'video' || primaryUrl?.match(/\.(mp4|webm|mov)(\?.*)?$/i);
            const isAudio = resType === 'audio' || primaryUrl?.match(/\.(mp3|wav|ogg|m4a)(\?.*)?$/i);
            const isImage = resType === 'image' || primaryUrl?.match(/\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i) || (!isVideo && !isAudio && primaryUrl);

            if (primaryUrl && isVideo) {
                const mediaRes = await axios.get(primaryUrl, { responseType: 'arraybuffer' });
                return { type: 'video', buffer: Buffer.from(mediaRes.data), text: result?.caption || '' };
            } else if (primaryUrl && isAudio) {
                const mediaRes = await axios.get(primaryUrl, { responseType: 'arraybuffer' });
                return { type: 'audio', buffer: Buffer.from(mediaRes.data), text: result?.caption || '' };
            } else if (primaryUrl && isImage) {
                const mediaRes = await axios.get(primaryUrl, { responseType: 'arraybuffer' });
                return { type: 'image', buffer: Buffer.from(mediaRes.data), text: result?.caption || '' };
            } else {
                return { type: 'text', text: typeof result === 'object' ? (result.caption || JSON.stringify(result)) : String(result) };
            }
        } else if (opData.status === 'failed') {
            throw new Error(opData.error_message || opData.error?.message || 'Выполнение завершилось ошибкой на стороне нейросети');
        }
    }

    throw new Error('⏱️ Превышено время ожидания ответа от нейросети');
}

class BratukhaPlugin {
    constructor(config = {}) {
        this.config = config;
    }

    async handleMessage(context) {
        return await processRequest(context);
    }
}

module.exports = BratukhaPlugin;
module.exports.BratukhaPlugin = BratukhaPlugin;
module.exports.processRequest = processRequest;
module.exports.BRATUKHA_MODELS = BRATUKHA_MODELS;