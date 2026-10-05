const axios = require('axios');
const jwt = require('jsonwebtoken');

/**
 * Генерация временного JWT для Kling API (если используются AK/SK)
 */
function generateKlingJwt(accessKey, secretKey) {
    const payload = {
        iss: accessKey,
        exp: Math.floor(Date.now() / 1000) + 1800, // токен на 30 минут
        nbf: Math.floor(Date.now() / 1000) - 5
    };

    return jwt.sign(payload, secretKey, {
        algorithm: 'HS256',
        header: {
            alg: 'HS256',
            typ: 'JWT'
        }
    });
}

async function generateKlingVideo(prompt, imageUrl = null, options = {}) {
    const baseUrl = 'https://api-singapore.klingai.com';

    // Поддерживаем все варианты ключей, чтобы не было ошибок
    const apiKey = process.env.KLING_API_KEY;
    const accessKey = process.env.KLING_AK || process.env.KLING_ACCESS_KEY;
    const secretKey = process.env.KLING_SK || process.env.KLING_SECRET_KEY;

    if (!apiKey && (!accessKey || !secretKey)) {
        throw new Error('Не заданы ключи доступа (KLING_API_KEY или папка KLING_AK/KLING_SK) в переменных окружения');
    }

    const duration = options.duration || '5';
    const typePath = imageUrl ? 'image2video' : 'text2video';
    const endpoint = `/v1/videos/${typePath}`;

    let payload = {
        model_name: options.model_name || 'kling-v1.5', // Исправлено на актуальную модель v1.5
        prompt: prompt,
        duration: String(duration),
        mode: options.mode || 'std'
    };

    if (imageUrl) {
        payload.image = imageUrl;
    }

    const fullUrl = `${baseUrl}${endpoint}`;

    try {
        console.log(`🎬 Отправка запроса в Kling API (${fullUrl})...`);
        
        // Определяем тип авторизации (Bearer по API Key или JWT через AK/SK)
        let token;
        if (apiKey) {
            token = apiKey;
        } else {
            token = generateKlingJwt(accessKey, secretKey);
        }

        const createResp = await axios.post(fullUrl, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (createResp.data?.code !== 0) {
            throw new Error(`Ошибка Kling API [code ${createResp.data?.code}]: ${createResp.data?.message}`);
        }

        const taskId = createResp.data?.data?.task_id;
        if (!taskId) {
            throw new Error(`Не удалось получить task_id от Kling: ${JSON.stringify(createResp.data)}`);
        }

        console.log(`⏳ Задача создана (Task ID: ${taskId}). Ждем готовности видео...`);

        // 2. Опрос статуса задачи (Polling)
        let videoUrl = null;
        const maxAttempts = 50; 
        const interval = 6000; 

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, interval));

            try {
                const statusUrl = `${baseUrl}/v1/videos/${typePath}/${taskId}`;
                
                // Обновляем токен при необходимости
                let pollToken = apiKey ? apiKey : generateKlingJwt(accessKey, secretKey);

                const statusResp = await axios.get(statusUrl, {
                    headers: {
                        'Authorization': `Bearer ${pollToken}`
                    }
                });

                const taskData = statusResp.data?.data;
                const status = taskData?.task_status;

                console.log(`🔄 Статус задачи ${taskId}: ${status} (попытка ${attempt + 1}/${maxAttempts})`);

                if (status === 'succeeded') {
                    videoUrl = taskData?.task_result?.videos?.[0]?.url;
                    break;
                } else if (status === 'failed') {
                    throw new Error(`Kling генерация завершилась с ошибкой: ${taskData?.task_status_msg || 'Неизвестная ошибка'}`);
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
        const errDetails = error.response?.data || error.message;
        console.error('❌ Ошибка Kling API:', errDetails);
        throw new Error(`Ошибка Kling API: ${typeof errDetails === 'object' ? JSON.stringify(errDetails) : errDetails}`);
    }
}

module.exports = { generateKlingVideo };