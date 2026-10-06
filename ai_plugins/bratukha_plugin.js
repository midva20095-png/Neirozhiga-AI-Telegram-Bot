const axios = require('axios');

const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

// Список текстовых моделей (OpenAI-совместимый эндпоинт /chat/completions)
const TEXT_MODELS = [
    'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-terra', 'claude-fable-5.1', 
    'claude-opus-5-5', 'kimi-k3', 'gemini-3.8-flash', 'qwen3.8-max', 
    'gemini-3.1-flash-lite-preview', 'minimax-m3', 
    'claude-sonnet-5', 'gpt-6-luna', 'qwen3.5-9b', 'deepseek-v3.2', 'seed-2.0-mini'
];

// Локальный кэш картинок из чата (живет 2 минуты для каждого чата/пользователя)
const recentImageCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 минуты

// Парсер соотношения сторон (поддерживает "9:16", "9х16", "--ar 16:9")
function parseAspectRatio(promptText) {
    if (!promptText) return null;
    const match = promptText.match(/(?:--ar|ar|aspect[:\s]*ratio)?\s*(\d+[:хx]\d+)/i);
    if (match && match[1]) {
        return match[1].replace(/[хx]/i, ':');
    }
    return null;
}

async function processRequest(params) {
    const { prompt, fileBuffer, fileBuffers, mimeType, modelKey, chatId, userId } = params || {};
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

    // Приводим ключ кэша строго к строке, чтобы кэш картинки не терялся
    const cacheKey = String(chatId || userId || 'default_user');

    // Собираем входящие файлы из текущего запроса
    let allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
    }

    let effectiveMimeType = mimeType || 'image/jpeg';

    // Если картинки переданы в текущем сообщении — сохраняем их в кэш
    if (allBuffers.length > 0) {
        recentImageCache.set(cacheKey, {
            buffers: allBuffers,
            mimeType: effectiveMimeType,
            timestamp: Date.now()
        });
        console.log(`📥 [Bratukha Cache] Сохранено ${allBuffers.length} изображений в кэш для чата: ${cacheKey}`);
    } else {
        // Если в текущем сообщении картинок нет, подтягиваем из кэша за последние 2 минуты
        const cached = recentImageCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
            allBuffers = cached.buffers;
            effectiveMimeType = cached.mimeType;
            console.log(`📤 [Bratukha Cache] Автоматически подтянуто ${allBuffers.length} изображений из недавнего кэша чата ${cacheKey}!`);
        }
    }

    // 1. Если это текстовая модель — отправляем в /chat/completions с поддержкой мультимодальности
    if (TEXT_MODELS.includes(toolSlug)) {
        console.log(`💬 [Bratukha Chat] Запрос к текстовой модели: ${toolSlug} (файлов: ${allBuffers.length})`);

        const userText = prompt || (allBuffers.length > 0 ? 'Опиши это изображение' : 'Привет');
        const messages = [{ role: 'user', content: userText }];

        if (allBuffers.length > 0) {
            const contentParts = [{ type: 'text', text: userText }];
            allBuffers.forEach(buf => {
                contentParts.push({
                    type: 'image_url',
                    image_url: { url: `data:${effectiveMimeType};base64,${buf.toString('base64')}` }
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

    // 2. Иначе — асинхронный эндпоинт операций (/operations) для генерации и редактирования картинок
    const finalPrompt = (prompt && prompt.trim()) 
        ? prompt.trim() 
        : (allBuffers.length > 0 ? 'Обработай изображение' : 'Сгенерируй изображение');

    const inputData = {
        prompt: finalPrompt
    };
        
    // Автовыделение соотношения сторон
    const aspectRatio = parseAspectRatio(finalPrompt);
    if (aspectRatio) {
        inputData.aspect_ratio = aspectRatio;
        inputData.ratio = aspectRatio;
        inputData.ar = aspectRatio;
    }

    // Упаковываем картинки во все стандартные имена полей
    if (allBuffers.length > 0) {
        const fileUrls = allBuffers.map(buf => `data:${effectiveMimeType};base64,${buf.toString('base64')}`);
        const primaryImage = fileUrls[0];
        
        // Мапим картинку во все возможные параметры, которые могут требовать разные инструменты
        inputData.image = primaryImage;
        inputData.image_url = primaryImage;
        inputData.input_image = primaryImage;
        inputData.init_image = primaryImage;
        inputData.source_image = primaryImage;
        inputData.images = fileUrls;
        
        if (fileUrls.length > 1) {
            inputData.image_url_1 = fileUrls[0];
            inputData.image_url_2 = fileUrls[1];
            inputData.second_image_url = fileUrls[1];
            inputData.target_image = fileUrls[1];
        }
        
        console.log(`🖼️ [Bratukha Operations] Передано изображений: ${fileUrls.length} с промптом: "${finalPrompt}"`);
    } else {
        console.log(`⚠️ [Bratukha Operations] Изображения не переданы. Промпт: "${finalPrompt}"`);
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

                    const imageUrl = result?.images?.[0] || result?.urls?.[0] || (result?.type === 'image' ? result?.url : null);
                    const videoUrl = result?.videos?.[0] || (result?.type === 'video' ? result?.url : null);
                    
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
                            text: typeof result === 'object' ? (result.caption || '') : String(result)
                        };
                    }
                } else if (opData.status === 'failed') {
                    throw new Error(opData.error_message || 'Выполнение завершилось ошибкой на стороне нейросети');
                }
            } catch (pollErr) {
                const retryAfter = Number(pollErr.response?.headers?.['retry-after']) || 2;
                if (pollErr.response?.status === 429 || pollErr.response?.status === 503) {
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