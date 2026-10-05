const axios = require('axios');

const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

const TEXT_MODELS = [
    'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-terra', 'claude-fable-5.1', 
    'claude-opus-5-5', 'kimi-k3', 'gemini-3.8-flash', 'qwen3.8-max', 
    'gemini-3.1-flash-lite-preview', 'grok-4.7', 'minimax-m3', 
    'claude-sonnet-5', 'gpt-6-luna', 'qwen3.5-9b', 'deepseek-v3.2', 'seed-2.0-mini'
];

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, modelKey }) {
    const apiKey = process.env.BRATUKHA_API_KEY;
    if (!apiKey) {
        throw new Error('❌ BRATUKHA_API_KEY не задан в переменных окружения');
    }

    let toolSlug = modelKey;
    if (!toolSlug) {
        throw new Error('❌ Не указан slug модели для Братухи');
    }

    if (toolSlug === 'qwen-3-5-9b') toolSlug = 'qwen3.5-9b';
    if (toolSlug === 'deepseek-v3-2') toolSlug = 'deepseek-v3.2';

    // 1. Обработка текстовых моделей (OpenAI-совместимый эндпоинт)
    if (TEXT_MODELS.includes(toolSlug)) {
        console.log(`💬 [Bratukha Chat] Запрос к текстовой модели: ${toolSlug}`);

        const messages = [{ role: 'user', content: prompt || '' }];
        const allBuffers = [];
        if (fileBuffer) allBuffers.push(fileBuffer);
        if (fileBuffers && Array.isArray(fileBuffers)) allBuffers.push(...fileBuffers);

        if (allBuffers.length > 0) {
            const contentParts = [{ type: 'text', text: prompt || '' }];
            allBuffers.forEach(buf => {
                contentParts.push({
                    type: 'image_url',
                    image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${buf.toString('base64')}` }
                });
            });
            messages[0].content = contentParts;
        }

        try {
            const chatRes = await axios.post(`${BRATUKHA_API_URL}/chat/completions`, {
                model: toolSlug,
                messages: messages
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            return {
                type: 'text',
                text: chatRes.data?.choices?.[0]?.message?.content || 'Пустой ответ от модели'
            };
        } catch (err) {
            if (err.response) {
                console.error(`🚨 [Bratukha Chat Error] Status: ${err.response.status}`, JSON.stringify(err.response.data));
                throw new Error(err.response.data.error?.message || `Ошибка чат-апи: статус ${err.response.status}`);
            }
            throw err;
        }
    }

    // 2. Обработка генеративных операций (/operations) для медиа и видео
    const inputData = {
        prompt: prompt || 'Generate content'
    };

    const allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
    }

    if (allBuffers.length > 0) {
        const base64Data = allBuffers[0].toString('base64');
        const dataUri = `data:${mimeType || 'image/jpeg'};base64,${base64Data}`;
        const dataUriList = [dataUri];
        
        // Передаем все варианты полей, причем «Изображения» строго в виде массива
        inputData.images = dataUriList;
        inputData.image = dataUri;
        inputData.image_url = dataUri;
        inputData.Изображения = dataUriList; // Обязательный массив для валидатора Братухи
        inputData.Изображение = dataUri;     
        
        console.log(`📎 [Bratukha Operations] Картинка успешно прикреплена в виде массива, размер: ${allBuffers[0].length} байт`);
    } else {
        console.log(`⚠️ [Bratukha Operations] Внимание: запрос идет без изображений!`);
    }

    const payload = {
        tool: toolSlug,
        input: inputData
    };

    console.log(`🚀 [Bratukha Operations] Отправка запроса для инструмента: ${toolSlug}`);

    try {
        const createRes = await axios.post(`${BRATUKHA_API_URL}/operations`, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const operationId = createRes.data?.id;
        if (!operationId) {
            throw new Error('❌ Не удалось получить ID операции от Братухи');
        }

        console.log(`⏳ [Bratukha] Операция создана. ID: ${operationId}. Статус: ${createRes.data.status}`);

        const maxAttempts = 120;
        const intervalMs = 3000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, intervalMs));

            try {
                const statusRes = await axios.get(`${BRATUKHA_API_URL}/operations/${operationId}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });

                const opData = statusRes.data;
                console.log(`🔄 [Bratukha] Опрос [${operationId}]: статус — ${opData.status}`);

                if (opData.status === 'completed') {
                    const result = opData.result;
                    
                    const images = result?.images || (result?.image_url ? [result.image_url] : []) || (result?.image ? [result.image] : []);
                    const videos = result?.videos || (result?.video_url ? [result.video_url] : []) || (result?.video ? [result.video] : []);
                    const singleUrl = result?.url || (typeof result === 'string' && result.startsWith('http') ? result : null);

                    if (videos.length > 0) {
                        const mediaRes = await axios.get(videos[0], { responseType: 'arraybuffer' });
                        return {
                            type: 'video',
                            buffer: Buffer.from(mediaRes.data),
                            text: `🎬 Сгенерировано через ${toolSlug}`
                        };
                    } else if (images.length > 0) {
                        const mediaRes = await axios.get(images[0], { responseType: 'arraybuffer' });
                        return {
                            type: 'image',
                            buffer: Buffer.from(mediaRes.data),
                            text: `✨ Сгенерировано через ${toolSlug}`
                        };
                    } else if (singleUrl) {
                        const mediaRes = await axios.get(singleUrl, { responseType: 'arraybuffer' });
                        const isVideo = singleUrl.endsWith('.mp4') || singleUrl.includes('video');
                        return {
                            type: isVideo ? 'video' : 'image',
                            buffer: Buffer.from(mediaRes.data),
                            text: `${isVideo ? '🎬' : '✨'} Сгенерировано через ${toolSlug}`
                        };
                    } else if (result && (result.text || typeof result === 'string')) {
                        return {
                            type: 'text',
                            text: typeof result === 'string' ? result : result.text
                        };
                    } else {
                        return {
                            type: 'text',
                            text: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result || 'Готово')
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

    } catch (err) {
        if (err.response) {
            const errData = err.response.data;
            console.error(`🚨 [Bratukha API Error] Status: ${err.response.status}`, JSON.stringify(errData));
            throw new Error(errData.error?.message || `Ошибка API: статус ${err.response.status}`);
        } else {
            console.error(`🚨 [Bratukha Error]:`, err.message);
            throw err;
        }
    }
}

module.exports = { processRequest };