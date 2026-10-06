const axios = require('axios');

const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

// Полный каталог моделей с ценами x2 (без Google / Nano Banana)
const BRATUKHA_MODELS = [
    // 🎵 Аудио
    { slug: 'mureka-ai-v9-5', name: 'Mureka AI V9.5', category: 'audio', price: 60, unit: 'песня / трек' },
    { slug: 'qwen3-tts', name: 'Qwen3 TTS', category: 'audio', price: 20, unit: '1000 символов' },
    { slug: 'qwen3-tts-flash', name: 'Qwen3 TTS Flash', category: 'audio', price: 20, unit: '1000 символов' },
    
    // 🖼 Картинки и апскейл
    { slug: 'phota-enhance', name: 'Phota Enhance', category: 'image', price: 44, unit: 'запуск' },
    { slug: 'pixal3d', name: 'Pixal3D', category: 'image-3d', price: 90, unit: 'изображение' },
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

    // 🎬 Видео и анимация
    { slug: 'omnihuman-1-0', name: 'OmniHuman 1.0', category: 'video', price: 40, unit: 'сек. видео' },
    { slug: 'omnihuman-1-5', name: 'OmniHuman 1.5', category: 'video', price: 70, unit: 'сек. видео' },
    { slug: 'pika', name: 'Pika 2.2', category: 'video', price: 14, unit: 'сек. видео' },
    { slug: 'pixverse-5-5', name: 'PixVerse 5.5', category: 'video', price: 45, unit: 'генерация' },
    { slug: 'pixverse-5-6', name: 'PixVerse 5.6', category: 'video', price: 112, unit: 'видео' },
    { slug: 'pixverse-6-0', name: 'PixVerse 6.0', category: 'video', price: 10, unit: 'сек. видео' },
    { slug: 'pixverse-c1', name: 'PixVerse C1', category: 'video', price: 12, unit: 'сек. видео' },
    { slug: 'pixverse-lipsync', name: 'PixVerse Lipsync', category: 'video', price: 14, unit: 'сек. аудио' },
    { slug: 'pixverse-vibemv', name: 'PixVerse VibeMV', category: 'video', price: 20, unit: 'сек. видео' },
    { slug: 'pruna-ai-p-video', name: 'Pruna AI P-Video', category: 'video', price: 6, unit: 'сек. видео' },
    { slug: 'pruna-ai-p-video-animate', name: 'Pruna AI P-Video Animate', category: 'video', price: 10, unit: 'сек. видео' },
    { slug: 'p-video-avatar', name: 'PrunaAI P-Video Avatar', category: 'video', price: 8, unit: 'сек. видео' },
    { slug: 'pruna-ai-p-video-2', name: 'Pruna P-Video 2', category: 'video', price: 5, unit: 'сек. видео' },
    { slug: 'pruna-ai-p-video-2-pro', name: 'Pruna P-Video 2 Pro', category: 'video', price: 4, unit: 'сек. видео' },
    { slug: 'pruna-ai-p-video-edit', name: 'Pruna P-Video Edit', category: 'video', price: 10, unit: 'сек. видео' },
    { slug: 'runway-4-turbo', name: 'Runway 4 Turbo', category: 'video', price: 30, unit: 'видео' },
    { slug: 'seedance-1-0', name: 'Seedance 1.0', category: 'video', price: 20, unit: 'генерация' },
    { slug: 'seedance-1-5-pro', name: 'Seedance 1.5 Pro', category: 'video', price: 14, unit: 'видео' },
    { slug: 'seedance-2-0-apimart', name: 'Seedance 2.0', category: 'video', price: 10, unit: 'сек. видео' },
    { slug: 'seedance-2-0-mini', name: 'Seedance 2.0 Mini', category: 'video', price: 10, unit: 'сек. видео' },
    { slug: 'seedance-2-5', name: 'Seedance 2.5', category: 'video', price: 16, unit: 'сек. видео' }
];

async function uploadBuffer(apiKey, buf, mimeType = 'image/jpeg', filename = 'input_file.jpg') {
    const contentType = mimeType || 'image/jpeg';
    const directLimit = 10 * 1024 * 1024; // до 10 МБ через /uploads

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

    // Presigned upload для крупных файлов
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

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, modelKey }) {
    const apiKey = process.env.BRATUKHA_API_KEY;
    if (!apiKey) {
        throw new Error('❌ BRATUKHA_API_KEY не задан в переменных окружения');
    }

    let toolSlug = modelKey;
    if (!toolSlug) {
        throw new Error('❌ Не указан slug модели для Братухи');
    }

    const inputData = {};
    if (prompt) {
        inputData.prompt = prompt;
    }

    const allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
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

    console.log(`🚀 [Bratukha Operations] Создание операции для инструмента: ${toolSlug}`);

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

    const operationId = createRes.data?.id;
    if (!operationId) {
        throw new Error('❌ Не удалось получить ID операции от Братухи');
    }

    console.log(`⏳ [Bratukha] Операция создана. ID: ${operationId}. Статус: ${createRes.data.status}`);

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
            if (attempt === maxAttempts - 1) {
                throw pollErr;
            }
            continue;
        }

        const opData = statusRes.data;
        console.log(`🔄 [Bratukha] Опрос [${operationId}]: статус — ${opData.status}`);

        if (opData.status === 'completed') {
            const result = opData.result;
            console.log(`✅ [Bratukha Success] Результат:`, JSON.stringify(result));

            const imageUrl = result?.images?.[0] || result?.urls?.[0] || result?.image_url || (result?.type === 'image' ? result?.url : null);
            const videoUrl = result?.videos?.[0] || result?.video_url || (result?.type === 'video' ? result?.url : null);
            
            if (imageUrl) {
                const mediaRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                return {
                    type: 'image',
                    buffer: Buffer.from(mediaRes.data),
                    text: result?.caption || '' 
                };
            } else if (videoUrl) {
                const mediaRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
                return {
                    type: 'video',
                    buffer: Buffer.from(mediaRes.data),
                    text: result?.caption || '' 
                };
            } else {
                return {
                    type: 'text',
                    text: typeof result === 'object' ? (result.caption || JSON.stringify(result)) : String(result)
                };
            }
        } else if (opData.status === 'failed') {
            throw new Error(opData.error_message || opData.error?.message || 'Выполнение завершилось ошибкой на стороне нейросети');
        }
    }

    throw new Error('⏱️ Превышено время ожидания ответа от нейросети (таймаут операции)');
}

module.exports = {
    BRATUKHA_MODELS,
    processRequest
};