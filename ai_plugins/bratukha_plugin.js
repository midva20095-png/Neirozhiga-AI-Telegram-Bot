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

// Локальный кэш файлов (живет 2 минуты для каждого чата/пользователя)
const recentImageCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;

// Парсер соотношения сторон
function parseAspectRatio(promptText) {
    if (!promptText) return null;
    const match = promptText.match(/(?:--ar|ar|aspect[:\s]*ratio)?\s*(\d+[:хx]\d+)/i);
    if (match && match[1]) {
        return match[1].replace(/[хx]/i, ':');
    }
    return null;
}

// Загрузка медиа с автоматическим фоллбэком на base64
async function uploadMediaToBratukha(buffer, mimeType, apiKey) {
    let effectiveMime = mimeType || 'image/jpeg';
    if (effectiveMime === 'image/jpg') effectiveMime = 'image/jpeg';

    try {
        const form = new FormData();
        const ext = effectiveMime.split('/')[1] || 'jpeg';
        const filename = `upload_${Date.now()}.${ext}`;

        form.append('file', buffer, {
            filename: filename,
            contentType: effectiveMime
        });

        const res = await axios.post(`${BRATUKHA_API_URL}/uploads`, form, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                ...form.getHeaders()
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });

        const fileUrl = res.data?.url || res.data?.file_url || res.data?.link;
        if (fileUrl) {
            console.log(`✅ [Bratukha Upload] Успешно загружено на сервер: ${fileUrl}`);
            return fileUrl;
        }
    } catch (err) {
        const errMsg = err.response?.data?.error?.message || err.message;
        console.warn(`⚠️ [Bratukha Upload] Ошибка загрузки на /uploads (${errMsg}). Используем резервный Data URL...`);
    }

    // Резервный вариант: если /uploads ругается, передаем base64 data:URL
    return `data:${effectiveMime};base64,${buffer.toString('base64')}`;
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

    if (toolSlug === 'qwen-3-5-9b') toolSlug = 'qwen3.5-9b';
    if (toolSlug === 'deepseek-v3-2') toolSlug = 'deepseek-v3.2';

    const cacheKey = chatId || userId || 'default_user';

    let allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
    }

    let effectiveMimeType = mimeType || 'image/jpeg';

    if (allBuffers.length > 0) {
        recentImageCache.set(cacheKey, {
            buffers: allBuffers,
            mimeType: effectiveMimeType,
            timestamp: Date.now()
        });
        console.log(`📥 [Bratukha Cache] Сохранено ${allBuffers.length} файлов в кэш: ${cacheKey}`);
    } else {
        const cached = recentImageCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
            allBuffers = cached.buffers;
            effectiveMimeType = cached.mimeType;
            console.log(`📤 [Bratukha Cache] Подтянуто ${allBuffers.length} файлов из недавнего кэша!`);
        }
    }

    // 1. Текстовые модели (/chat/completions)
    if (TEXT_MODELS.includes(toolSlug)) {
        console.log(`💬 [Bratukha Chat] Запрос к текстовой модели: ${toolSlug} (файлов: ${allBuffers.length})`);

        const userText = prompt || (allBuffers.length > 0 ? 'Опиши это медиа' : 'Привет');
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

            return {
                type: 'text',
                text: chatRes.data?.choices?.[0]?.message?.content || 'Пустой ответ от модели'
            };
        } catch (err) {
            throw new Error(err.response?.data?.error?.message || `Ошибка чат-апи: статус ${err.response?.status}`);
        }
    }

    // 2. Операции (/operations)
    const finalPrompt = (prompt && prompt.trim()) 
        ? prompt.trim() 
        : (allBuffers.length > 0 ? 'Обработай изображение' : 'Сгенерируй изображение');

    const inputData = { prompt: finalPrompt };
        
    const aspectRatio = parseAspectRatio(finalPrompt);
    if (aspectRatio) {
        inputData.aspect_ratio = aspectRatio;
        inputData.ratio = aspectRatio;
        inputData.ar = aspectRatio;
    }

    if (allBuffers.length > 0) {
        console.log(`⏳ [Bratukha Upload] Подготовка ${allBuffers.length} файлов...`);
        const fileUrls = [];
        for (const buf of allBuffers) {
            const fileUrl = await uploadMediaToBratukha(buf, effectiveMimeType, apiKey);
            fileUrls.push(fileUrl);
        }
        
        inputData.images = fileUrls;
        inputData.image_url = fileUrls[0];
        inputData.source_image = fileUrls[0];
        inputData.video_url = fileUrls[0];
        
        if (fileUrls.length > 1) {
            inputData.image_url_1 = fileUrls[0];
            inputData.image_url_2 = fileUrls[1];
            inputData.second_image_url = fileUrls[1];
            inputData.target_image = fileUrls[1];
        }
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
        if (!operationId) throw new Error('❌ Не удалось получить ID операции');

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
                    } else {
                        const outText = typeof result === 'string' ? result : (result?.text || result?.caption || String(result));
                        return { type: 'text', text: outText };
                    }
                } else if (opData.status === 'failed') {
                    throw new Error(opData.error_message || 'Нейросеть завершила задачу с ошибкой');
                }
            } catch (pollErr) {
                const retryAfter = Number(pollErr.response?.headers?.['retry-after']) || 2;
                if (pollErr.response?.status === 429 || pollErr.response?.status === 503) {
                    await new Promise(r => setTimeout(r, retryAfter * 1000));
                    continue;
                }
                if (attempt === maxAttempts - 1) throw pollErr;
            }
        }

        throw new Error('⏱️ Превышено время ожидания ответа от нейросети (таймаут)');

    } catch (err) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        console.error(`🚨 [Bratukha API Error]:`, errorMsg);
        throw new Error(`Ошибка Братухи: ${errorMsg}`);
    }
}

module.exports = { processRequest };