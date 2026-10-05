const axios = require('axios');

async function generateKlingVideo(prompt, imageUrl = null, options = {}) {
    const apiKey = process.env.KLING_API_KEY;
    const baseUrl = process.env.KLING_API_URL || 'https://api.klingai.com'; // или ваш шлюз

    if (!apiKey) {
        throw new Error('KLING_API_KEY не задан в переменных окружения');
    }

    // Базовые параметры
    const duration = options.duration || 5;
    const resolution = options.resolution || '720p';

    let payload = {
        prompt: prompt,
        duration: String(duration),
        resolution: resolution
    };

    let endpoint = '/v1/videos/text-to-video';

    // Если передана картинка — переключаемся на Image-to-Video и добавляем first_frame
    if (imageUrl) {
        endpoint = '/v1/videos/image-to-video';
        payload.image = imageUrl; // или first_frame в зависимости от вашего API-шлюза
        // Если ваш провайдер требует именно first_frame, можно передать и так:
        // payload.first_frame = imageUrl;
    }

    try {
        console.log(`🎬 Отправка запроса в Kling (${imageUrl ? 'Image-to-Video' : 'Text-to-Video'})...`);
        
        // 1. Создаем задачу на генерацию
        const createResp = await axios.post(`${baseUrl}${endpoint}`, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const taskId = createResp.data?.data?.task_id || createResp.data?.task_id;
        if (!taskId) {
            throw new Error(`Не удалось получить task_id от Kling: ${JSON.stringify(createResp.data)}`);
        }

        console.log(`⏳ Задача создана (Task ID: ${taskId}). Ждем готовности видео...`);

        // 2. Опрашиваем статус задачи (polling) до готовности
        let videoUrl = null;
        const maxAttempts = 40; // ~3-4 минуты ожидания
        const interval = 5000; // каждые 5 секунд

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, interval));

            try {
                const statusResp = await axios.get(`${baseUrl}/v1/videos/tasks/${taskId}`, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    }
                });

                const taskData = statusResp.data?.data || statusResp.data;
                const status = taskData?.status;

                console.log(`🔄 Статус задачи ${taskId}: ${status} (попытка ${attempt + 1}/${maxAttempts})`);

                if (status === 'completed' || status === 'SUCCESS') {
                    videoUrl = taskData?.work_result?.[0]?.resource_url || taskData?.video_url;
                    break;
                } else if (status === 'failed' || status === 'FAILED') {
                    throw new Error(`Kling генерация завершилась с ошибкой: ${taskData?.message || 'Неизвестная ошибка'}`);
                }
            } catch (pollErr) {
                console.warn(`⚠ Ошибка при опросе статуса: ${pollErr.message}`);
            }
        }

        if (!videoUrl) {
            throw new Error('Превышено время ожидания генерации видео Kling (Timeout)');
        }

        return videoUrl;

    } catch (error) {
        console.error('❌ Ошибка Kling API:', error.response?.data || error.message);
        throw new Error(`Ошибка Kling API: ${JSON.stringify(error.response?.data || error.message)}`);
    }
}

module.exports = { generateKlingVideo };