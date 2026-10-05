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

    // Формируем input в зависимости от того, переданы ли файлы/картинки
    const inputData = {
        prompt: prompt || ''
    };

    // Если есть картинки (одна или несколько), конвертируем их в base64 и добавляем в массив images
    const allBuffers = [];
    if (fileBuffer) allBuffers.push(fileBuffer);
    if (fileBuffers && Array.isArray(fileBuffers)) {
        allBuffers.push(...fileBuffers);
    }

    if (allBuffers.length > 0) {
        inputData.images = allBuffers.map(buf => `data:${mimeType || 'image/jpeg'};base64,${buf.toString('base64')}`);
    }

    const payload = {
        tool: toolSlug,
        input: inputData
    };

    console.log(`🚀 [Bratukha] Запуск задачи для модели: ${toolSlug} (файлов: ${allBuffers.length})`);

    try {
        // 1. Создаем операцию
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

        console.log(`⏳ [Bratukha] Задача создана. ID: ${operationId}. Ожидание результата...`);

        // 2. Цикл опроса (polling) статуса
        const maxAttempts = 120; // Увеличили до 120 для видео
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
                console.log(`🔄 [Bratukha] Статус [${operationId}]: ${opData.status}`);

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
                    throw new Error(opData.error_message || 'Ошибка выполнения на стороне нейросети');
                }
            } catch (pollErr) {
                if (pollErr.response?.status === 429 || pollErr.response?.status === 503) {
                    continue;
                }
                if (attempt === maxAttempts - 1) {
                    throw pollErr;
                }
            }
        }

        throw new Error('⏱️ Превышено время ожидания ответа от нейросети (таймаут)');

    } catch (err) {
        if (err.response) {
            console.error(`🚨 [Bratukha API Error] Status: ${err.response.status}`, JSON.stringify(err.response.data));
        } else {
            console.error(`🚨 [Bratukha Error]:`, err.message);
        }
        throw err;
    }
}

module.exports = { processRequest };