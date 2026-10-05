const axios = require('axios');

const BRATUKHA_API_URL = 'https://bratuha.ru/api/v1';

async function processRequest({ prompt, fileBuffer, mimeType, modelKey }) {
    const apiKey = process.env.BRATUKHA_API_KEY;
    if (!apiKey) {
        throw new Error('❌ BRATUKHA_API_KEY не задан в переменных окружения');
    }

    const toolSlug = modelKey;
    if (!toolSlug) {
        throw new Error('❌ Не указан slug модели для Братухи');
    }

    const payload = {
        tool: toolSlug,
        input: {
            prompt: prompt
        }
    };

    console.log(`🚀 [Bratukha] Запуск задачи для модели: ${toolSlug}`);

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
        const maxAttempts = 90;
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
                            text: `🎬 Сгенерировано через ${toolslug}`
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
        // Выводим в лог подробности ответа сервера Братухи, если они есть
        if (err.response) {
            console.error(`🚨 [Bratukha API Error] Status: ${err.response.status}`, JSON.stringify(err.response.data));
        } else {
            console.error(`🚨 [Bratukha Error]:`, err.message);
        }
        throw err;
    }
}

module.exports = { processRequest };