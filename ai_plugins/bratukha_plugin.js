const axios = require('axios');

/**
 * Плагин для интеграции с API «Братуха»
 */
async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, modelKey }) {
    const apiKey = process.env.BRATUKHA_API_KEY || process.env.BRATUKHA_TOKEN;
    const baseUrl = process.env.BRATUKHA_API_URL || 'https://api.bratuha.ru/v1';

    // Формируем payload запроса
    const payload = {
        tool: modelKey
    };

    // 1. Исправление ошибки TTS: маппинг поля «Текст» для озвучки и музыки
    if (modelKey.includes('tts') || modelKey.includes('mureka') || modelKey.includes('suno') || modelKey.includes('udio')) {
        payload.text = prompt;
    } else {
        payload.prompt = prompt;
    }

    // 2. Исправление ошибки Image-to-Video / Upscale: маппинг изображения
    const images = [];
    if (fileBuffers && fileBuffers.length > 0) {
        fileBuffers.forEach(buf => images.push(`data:${mimeType || 'image/jpeg'};base64,${buf.toString('base64')}`));
    } else if (fileBuffer) {
        images.push(`data:${mimeType || 'image/jpeg'};base64,${fileBuffer.toString('base64')}`);
    }

    if (images.length > 0) {
        payload.image = images[0]; // Поле "Изображение"
        payload.images = images;
    }

    console.log(`🚀 [Bratukha Operations] Создание операции для инструмента: ${modelKey}`);

    // Отправка запроса на создание операции
    const response = await axios.post(`${baseUrl}/operations`, payload, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    });

    const operationId = response.data?.id || response.data?.operation_id;
    if (!operationId) {
        throw new Error('Не удалось получить ID операции от API');
    }

    console.log(`⏳ [Bratukha] Операция создана. ID: ${operationId}. Статус: ${response.data.status || 'queued'}`);

    // Опрос статуса операции (Polling)
    let status = response.data.status;
    let resultData = null;
    const maxPolls = 120; // до 6 минут ожидания
    let polls = 0;

    while (polls < maxPolls && status !== 'completed' && status !== 'failed') {
        await new Promise(res => setTimeout(res, 3000));
        polls++;

        const statusRes = await axios.get(`${baseUrl}/operations/${operationId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        status = statusRes.data.status;
        console.log(`🔄 [Bratukha] Опрос [${operationId}]: статус — ${status}`);

        if (status === 'completed') {
            resultData = statusRes.data.result || statusRes.data;
            break;
        } else if (status === 'failed') {
            throw new Error(statusRes.data.error?.message || 'Ошибка обработки запроса нейросетью');
        }
    }

    if (status !== 'completed') {
        throw new Error('Превышено время ожидания ответа от нейросети');
    }

    // Скачивание и возврат результата
    const urls = resultData.urls || resultData.files || [];
    const resultType = resultData.type || (urls[0]?.endsWith('.mp4') ? 'video' : urls[0]?.endsWith('.mp3') ? 'audio' : 'image');

    if (urls.length > 0) {
        const fileRes = await axios.get(urls[0], { responseType: 'arraybuffer' });
        return {
            type: resultType,
            buffer: Buffer.from(fileRes.data),
            text: resultData.text || ''
        };
    }

    return {
        type: 'text',
        text: resultData.text || 'Генерация завершена.'
    };
}

module.exports = { processRequest };