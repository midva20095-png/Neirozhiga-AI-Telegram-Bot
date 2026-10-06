const axios = require('axios');
const FormData = require('form-data');

const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

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

    // 1. Загрузка файлов через /api/v1/uploads (согласно документации)
    if (allBuffers.length > 0) {
        const uploadedUrls = [];
        for (const buf of allBuffers) {
            try {
                const form = new FormData();
                form.append('file', buf, {
                    filename: 'input_file.jpg',
                    contentType: mimeType || 'image/jpeg'
                });

                console.log(`📤 [Bratukha Upload] Загрузка файла на сервер...`);
                const uploadRes = await axios.post(`${BRATUKHA_API_URL}/uploads`, form, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        ...form.getHeaders()
                    }
                });

                const fileUrl = uploadRes.data?.url || uploadRes.data?.file_url || uploadRes.data?.link || uploadRes.data?.path;
                if (fileUrl) {
                    uploadedUrls.push(fileUrl);
                    console.log(`✅ [Bratukha Upload] Файл успешно загружен: ${fileUrl}`);
                } else {
                    console.warn(`⚠ [Bratukha Upload] Ответ сервера не содержал URL файла:`, JSON.stringify(uploadRes.data));
                }
            } catch (uploadErr) {
                const errorDetails = uploadErr.response?.data ? JSON.stringify(uploadErr.response.data) : uploadErr.message;
                console.error(`🚨 [Bratukha Upload Error Details]:`, errorDetails);
                throw new Error(`Ошибка загрузки файла на сервер Братухи: ${errorDetails}`);
            }
        }

        if (uploadedUrls.length > 0) {
            inputData.image_url = uploadedUrls[0];
            inputData.images = uploadedUrls;
            inputData.file_url = uploadedUrls[0];
            inputData.files = uploadedUrls;
        }
    }

    // 2. Создание асинхронной операции через POST /api/v1/operations
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
            }
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

    // 3. Периодический опрос через GET /api/v1/operations/{id} (интервал 3 сек, согласно правилам API)
    const maxAttempts = 120;
    const intervalMs = 3000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));

        try {
            const statusRes = await axios.get(`${BRATUKHA_API_URL}/operations/${operationId}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

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
                throw new Error(opData.error_message || 'Выполнение завершилось ошибкой на стороне нейросети');
            }
        } catch (pollErr) {
            if (pollErr.response?.status === 429 || pollErr.response?.status === 503) {
                const retryAfter = pollErr.response.headers['retry-after'] || 2;
                await new Promise(r => setTimeout(r, retryAfter * 1000));
                continue;
            }
            if (attempt === maxAttempts - 1) {
                throw pollErr;
            }
        }
    }

    throw new Error('⏱️ Превышено время ожидания ответа от нейросети (таймаут операции)');
}

module.exports = { processRequest };