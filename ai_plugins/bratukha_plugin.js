const axios = require('axios');
const FormData = require('form-data');

const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

// Список текстовых моделей (OpenAI-совместимый эндпоинт /chat/completions)
const TEXT_MODELS = [
    'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-terra', 'claude-fable-5.1', 
    'claude-opus-5-5', 'kimi-k3', 'gemini-3.8-flash', 'qwen3.8-max', 
    'gemini-3.1-flash-lite-preview', 'minimax-m3', 
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

    // Нормализуем имя модели
    if (toolSlug === 'qwen-3-5-9b') toolSlug = 'qwen3.5-9b';
    if (toolSlug === 'deepseek-v3-2') toolSlug = 'deepseek-v3.2';

    // 1. Текстовые модели через /chat/completions
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

            const replyText = chatRes.data?.choices?.[0]?.message?.content || 'Пустой ответ от модели';
            return {
                type: 'text',
                text: replyText
            };
        } catch (err) {
            if (err.response) {
                console.error(`🚨 [Bratukha Chat Error] Status: ${err.response.status}`, JSON.stringify(err.response.data));
                throw new Error(err.response.data.error?.message || `Ошибка чат-апи: статус ${err.response.status}`);
            }
            throw err;
        }
    }

    // 2. Медиа и видео модели через асинхронный эндпоинт /operations
    const inputData = {};
    if (prompt) {
        inputData.prompt = prompt;
    }

    const allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
    }

    // Загружаем файлы через официальный эндпоинт /uploads для получения внешних URL
    if (allBuffers.length > 0) {
        const uploadedUrls = [];
        for (const buf of allBuffers) {
            try {
                const form = new FormData();
                form.append('file', buf, {
                    filename: 'input_media.jpg',
                    contentType: mimeType || 'image/jpeg'
                });

                console.ℓ?.(`📤 [Bratukha Upload] Загрузка файла на сервер...`);
                const uploadRes = await axios.post(`${BRATUKHA_API_URL}/uploads`, form, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        ...form.getHeaders()
                    }
                });

                const fileUrl = uploadRes.data?.url || uploadRes.data?.file_url || uploadRes.data?.link;
                if (fileUrl) {
                    uploadedUrls.push(fileUrl);
                    console.log(`✅ [Bratukha Upload] Файл успешно загружен: ${fileUrl}`);
                }
            } catch (uploadErr) {
                console.error(`🚨 [Bratukha Upload Error]:`, uploadErr.response?.data || uploadErr.message);
                throw new Error('Не удалось загрузить входной файл на сервер Братухи');
            }
        }

        if (uploadedUrls.length > 0) {
            inputData.images = uploadedUrls;
            inputData.image_url = uploadedUrls[0];
            inputData.image = uploadedUrls[0];
            inputData.init_image = uploadedUrls[0];
        }
    }

    // Обязательные параметры для видео-моделей (Veo, Kling, Sora и др.)
    if (toolSlug.includes('veo') || toolSlug.includes('video') || toolSlug.includes('sora') || toolSlug.includes('kling') || toolSlug.includes('luma')) {
        inputData.aspect_ratio = inputData.aspect_ratio || '16:9';
        inputData.duration = inputData.duration || 5;
    }

    const payload = {
        tool: toolSlug,
        input: inputData
    };

    console.log(`🚀 [Bratukha Operations] Создание операции для инструмента: ${toolSlug}`);

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

        const maxAttempts = 120; // Таймаут для тяжелых задач (видео/генерации)
        const intervalMs = 3000; // Интервал опроса 3 секунды (соблюдаем лимит > 1 сек)

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
                            text: '' 
                        };
                    } else if (videoUrl) {
                        const mediaRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
                        return {
                            type: 'video',
                            buffer: Buffer.from(mediaRes.data),
                            text: '' 
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

    } catch (err) {
        if (err.response) {
            const errData = err.response.data;
            console.error(`🚨 [Bratukha API Error] Status: ${err.response.status}`, JSON.stringify(errData));
            throw new Error(errData.error?.message || errData.message || `Ошибка API: статус ${err.response.status}`);
        } else {
            console.error(`🚨 [Bratukha Error]:`, err.message);
            throw err;
        }
    }
}

module.exports = { processRequest };