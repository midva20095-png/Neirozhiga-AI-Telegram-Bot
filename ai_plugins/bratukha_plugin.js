const axios = require('axios');

const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, modelKey }) {
    const apiKey = process.env.BRATUKHA_API_KEY;
    if (!apiKey) {
        throw new Error('❌ BRATUKHA_API_KEY не задан в переменных окружения');
    }

    const toolSlug = modelKey;
    if (!toolSlug) {
        throw new Error('❌ Не указан slug модели для Братухи');
    }

    // Формируем input в соответствии с документацией Public API
    const inputData = {};
    if (prompt) {
        inputData.prompt = prompt;
    }

    // Собираем файлы, если они есть
    const allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
    }

    // Если модель принимает изображения, передаем их в формате внешних URL или base64 (если поддерживается схемой)
    // Согласно документации, Public API ожидает внешние URL или поддерживаемые форматы. 
    // Если бэкенд принимает data-URI в массиве images/image_url:
    if (allBuffers.length > 0) {
        const fileUrls = allBuffers.map(buf => `data:${mimeType || 'image/jpeg'};base64,${buf.toString('base64')}`);
        // Для универсальности пишем и в images, и в image_url в зависимости от требований инструмента
        inputData.images = fileUrls;
        inputData.image_url = fileUrls[0];
    }

    const payload = {
        tool: toolSlug,
        input: inputData
    };

    console.log(`🚀 [Bratukha] Создание операции для модели: ${toolSlug}`);

    try {
        // 1. Создание операции (POST /api/v1/operations)
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

        console.log(`⏳ [Bratukha] Операция создана. ID: ${operationId}. Статус: ${createRes.data.status}. Стоимость: ${createRes.data.cost} кр.`);

        // 2. Периодический опрос статуса (GET /api/v1/operations/{id}) с интервалом 3 секунды (согласно рекомендациям документации)
        const maxAttempts = 100;
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
                            text: `✨ Сгенерировано через ${toolSlug}`
                        };
                    } else if (result && result.videos && result.videos.length > 0) {
                        const mediaUrl = result.videos[0];
                        const mediaRes = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
                        return {
                            type: 'video',
                            buffer: Buffer.from(mediaRes.data),
                            text: `🎬 Сгенерировано через ${toolSlug}`
                        };
                    } else if (result && (result.text || typeof result === 'string')) {
                        return {
                            type: 'text',
                            text: typeof result === 'string' ? result : result.text
                        };
                    } else {
                        return {
                            type: 'text',
                            text: JSON.stringify(result, null, 2)
                        };
                    }
                } else if (opData.status === 'failed') {
                    throw new Error(opData.error_message || 'Выполнение завершилось ошибкой на стороне нейросети');
                }
            } catch (pollErr) {
                // Если словили 429 (слишком частый опрос) или 503 (временная база), продолжаем цикл или учитываем Retry-After
                if (pollErr.response?.status === 429 || pollErr.response?.status === 503) {
                    const retryAfter = pollErr.response.headers['retry-after'] || 2;
                    console.log(`⚠️ Предупреждение лимита/очереди (${pollErr.response.status}), ждем ${retryAfter} сек...`);
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