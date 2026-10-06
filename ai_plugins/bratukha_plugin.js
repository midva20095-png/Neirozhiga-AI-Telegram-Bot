const axios = require('axios');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Вспомогательная функция: скачивает картинку по URL и превращает ее в Buffer
 */
async function downloadImageToBuffer(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
    } catch (error) {
        console.error(`❌ Ошибка скачивания изображения по ссылке [${url}]:`, error.message);
        throw new Error('Не удалось загрузить сгенерированную картинку');
    }
}

/**
 * Вспомогательная функция: обрабатывает итоговый результат от API
 */
async function handleResult(resultData, modelKey) {
    // 1. Извлекаем URL картинки из любых возможных структур ответа
    let imageUrl = null;

    if (Array.isArray(resultData.urls) && resultData.urls.length > 0) {
        imageUrl = resultData.urls[0];
    } else if (typeof resultData.urls === 'string') {
        imageUrl = resultData.urls;
    } else if (resultData.url) {
        imageUrl = resultData.url;
    } else if (resultData.image_url) {
        imageUrl = resultData.image_url;
    }

    // 2. Если нашли URL или тип ответа — изображение, скачиваем его в Buffer
    if (imageUrl || resultData.type === 'image' || modelKey === 'gpt-image-2-5') {
        if (imageUrl) {
            console.log(`📥 Скачивание сгенерированного изображения: ${imageUrl}`);
            const buffer = await downloadImageToBuffer(imageUrl);

            return {
                type: 'image',
                buffer: buffer,
                text: resultData.caption || ''
            };
        }
    }

    // 3. Если ответ текстовый (DeepSeek, Qwen и др.)
    const textOutput = resultData.text || 
                        resultData.content || 
                        resultData.choices?.[0]?.message?.content || 
                        (typeof resultData === 'string' ? resultData : JSON.stringify(resultData));

    return {
        type: 'text',
        text: textOutput
    };
}

/**
 * Основной метод плагина
 */
async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, modelKey }) {
    try {
        const apiUrl = process.env.BRATUKHA_API_URL || 'https://api.bratukha.ai/v1';
        const headers = {
            'Authorization': `Bearer ${process.env.BRATUKHA_API_KEY || ''}`,
            'Content-Type': 'application/json'
        };

        const payload = {
            model: modelKey,
            prompt: prompt || ''
        };

        // Если передано фото (например, для редактирования/Inpainting)
        if (fileBuffer) {
            payload.image = `data:${mimeType || 'image/jpeg'};base64,${fileBuffer.toString('base64')}`;
        }

        // Создаем задачу в API
        const createRes = await axios.post(`${apiUrl}/generate`, payload, { headers });
        const responseData = createRes.data;

        // Если API отдал результат сразу без polling
        if (responseData.urls || responseData.url || responseData.text) {
            return await handleResult(responseData, modelKey);
        }

        const operationId = responseData.id || responseData.operation_id || responseData.taskId;
        if (!operationId) {
            throw new Error('API Братуха не вернул ID операции');
        }

        console.log(`⏳ [Bratukha] Операция создана. ID: ${operationId}. Статус: queued`);

        // Цикл ожидания готовности (Polling)
        let isCompleted = false;
        let finalResult = null;
        let attempts = 0;
        const maxAttempts = 60; // До 3 минут ожидания

        while (!isCompleted && attempts < maxAttempts) {
            await delay(3000);
            attempts++;

            const pollRes = await axios.get(`${apiUrl}/operations/${operationId}`, { headers });
            const status = pollRes.data.status;

            console.log(`🔄 [Bratukha] Опрос [${operationId}]: статус — ${status}`);

            if (status === 'completed' || status === 'SUCCESS' || status === 'succeeded') {
                isCompleted = true;
                finalResult = pollRes.data.result || pollRes.data;
            } else if (status === 'failed' || status === 'error') {
                throw new Error(`Ошибка генерации: ${pollRes.data.error || 'Неизвестная ошибка'}`);
            }
        }

        if (!isCompleted || !finalResult) {
            throw new Error('Превышено время ожидания ответа от сервера');
        }

        return await handleResult(finalResult, modelKey);

    } catch (error) {
        console.error('❌ Ошибка в bratukha_plugin:', error.response?.data || error.message);
        throw error;
    }
}

module.exports = { processRequest };