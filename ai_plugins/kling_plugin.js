const axios = require('axios');

async function generateKlingVideo(prompt, imageUrl = null, options = {}) {
    const apiKey = process.env.KLING_API_KEY;
    const baseUrl = 'https://api-singapore.klingai.com';

    if (!apiKey) {
        throw new Error('KLING_API_KEY не задан в переменных окружения');
    }

    const duration = options.duration || '5';
    const resolution = options.resolution || '720p';

    // Раздельные эндпоинты согласно официальной документации Kling
    let endpoint = imageUrl ? '/v1/videos/image-to-video' : '/v1/videos/text-to-video';
    
    let payload = {
        model_name: 'kling-v1', // или kling-v3 в зависимости от вашего доступа
        prompt: prompt,
        duration: String(duration),
        resolution: resolution
    };

    // Если передана картинка, формируем правильную структуру contents с first_frame
    if (imageUrl) {
        payload.contents = [
            { type: 'text', text: prompt },
            { type: 'first_frame', image_url: imageUrl }
        ];
        payload.image = imageUrl;
        payload.first_frame = imageUrl;
    }

    const fullUrl = `${baseUrl}${endpoint}`;

    try {
        console.log(`🎬 Отправка запроса в Kling API (${fullUrl})...`);
        
        const createResp = await axios.post(fullUrl, payload, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const taskId = createResp.data?.data?.task_id || createResp.data?.task_id || createResp.data?.id;
        if (!taskId) {
            throw new Error(`Не удалось получить task_id от Kling: ${JSON.stringify(createResp.data)}`);
        }

        console.log(`⏳ Задача создана (Task ID: ${taskId}). Ждем готовности видео...`);

        let videoUrl = null;
        const maxAttempts = 40; 
        const interval = 5000; 

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, interval));

            try {
                const statusUrl = `${baseUrl}/v1/videos/tasks/${taskId}`;
                const statusResp = await axios.get(statusUrl, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    }
                });

                const taskData = statusResp.data?.data || statusResp.data;
                const status = taskData?.status || taskData?.state;

                console.log(`🔄 Статус задачи ${taskId}: ${status} (попытка ${attempt + 1}/${maxAttempts})`);

                if (status === 'completed' || status === 'SUCCESS' || status === 'succeeded') {
                    videoUrl = taskData?.work_result?.[0]?.resource_url || taskData?.video_url || taskData?.url;
                    break;
                } else if (status === 'failed' || status === 'FAILED' || status === 'error') {
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