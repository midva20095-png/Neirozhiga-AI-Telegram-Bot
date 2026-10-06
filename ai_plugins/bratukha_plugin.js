const axios = require('axios');

const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

async function uploadBuffer(apiKey, buf, mimeType = 'image/jpeg', filename = 'input_file.jpg') {
    const contentType = mimeType || 'image/jpeg';
    const directLimit = 10 * 1024 * 1024; // прямой /uploads — до 10 МБ

    // 1. Файл до 10 МБ: отправляем через JSON с base64 в поле data
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

    // 2. Больший файл: получаем параметры presigned upload
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

    // Используем встроенные в Node.js глобальные FormData и Blob (без npm-пакетов)
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

    // Загрузка файлов
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

    // Создание операции через POST /api/v1/operations
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

    // Периодический опрос через GET /api/v1/operations/{id}
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
            } else if (result && (result.text || typeof result === 'string')) {
                return {
                    type: 'text',
                    text: typeof result === 'string' ? result : result.text
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

module.exports = { processRequest };