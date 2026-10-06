const axios = require('axios');

const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

// Список текстовых моделей (OpenAI-совместимый эндпоинт /chat/completions)
const TEXT_MODELS = [
    'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-terra', 'claude-fable-5.1', 
    'claude-opus-5-5', 'kimi-k3', 'gemini-3.8-flash', 'qwen3.8-max', 
    'gemini-3.1-flash-lite-preview', 'minimax-m3', 
    'claude-sonnet-5', 'gpt-6-luna', 'qwen3.5-9b', 'deepseek-v3.2', 'seed-2.0-mini'
];

// Вспомогательная функция для полного удаления ссылок из текста
function stripUrls(text) {
    if (!text) return '';
    return text
        .replace(/https?:\/\/\S+/gi, '') // Удаляем прямые ссылки http/https
        .replace(/\[([^\]]+)\]\(\s*https?:\/\/\S+\s*\)/gi, '$1') // Превращаем markdown-ссылки [Текст](url) в чистый Текст
        .trim();
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

    // Нормализуем имя модели
    if (toolSlug === 'qwen-3-5-9b') toolSlug = 'qwen3.5-9b';
    if (toolSlug === 'deepseek-v3-2') toolSlug = 'deepseek-v3.2';

    // Собираем все буферы изображений
    const allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
    }

    // 1. Если это текстовая/мультимодальная чат-модель — отправляем в /chat/completions
    if (TEXT_MODELS.includes(toolSlug)) {
        console.log(`💬 [Bratukha Chat] Запрос к текстовой модели: ${toolSlug}`);

        const messages = [{ role: 'user', content: prompt || '' }];

        if (allBuffers.length > 0) {
            const contentParts = [{ type: 'text', text: prompt || 'Что на этом изображении?' }];
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

            let replyText = chatRes.data?.choices?.[0]?.message?.content || 'Пустой ответ от модели';
            replyText = stripUrls(replyText);

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

    // 2. Иначе — асинхронный эндпоинт операций (/operations) для медиа и картинок
    const inputData = {};
    if (prompt) {
        inputData.prompt = prompt;
    }

    if (allBuffers.length > 0) {
        const firstBase64 = `data:${mimeType || 'image/jpeg'};base64,${allBuffers[0].toString('base64')}`;
        const fileUrls = allBuffers.map(buf => `data:${mimeType || 'image/jpeg'};base64,${buf.toString('base64')}`);

        // Передаем изображение во все распространенные поля, которые может запрашивать API Братухи
        inputData.image = firstBase64;
        inputData.image_url = firstBase64;
        inputData.init_image = firstBase64;
        inputData.input_image = firstBase64;
        inputData.images = fileUrls;
        inputData.image_urls = fileUrls;
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
                    
                    if (result && result.images && result.images.length > 0) {
                        const mediaUrl = result.images[0];
                        const mediaRes = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
                        return {
                            type: 'image',
                            buffer: Buffer.from(mediaRes.data),
                            text: '' // Убраны любые подписи и ссылки на скачивание
                        };
                    } else if (result && result.videos && result.videos.length > 0) {
                        const mediaUrl = result.videos[0];
                        const mediaRes = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
                        return {
                            type: 'video',
                            buffer: Buffer.from(mediaRes.data),
                            text: ''
                        };
                    } else if (result && (result.text || typeof result === 'string')) {
                        const rawText = typeof result === 'string' ? result : result.text;
                        return {
                            type: 'text',
                            text: stripUrls(rawText)
                        };
                    } else {
                        return {
                            type: 'text',
                            text: stripUrls(JSON.stringify(result, null, 2))
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