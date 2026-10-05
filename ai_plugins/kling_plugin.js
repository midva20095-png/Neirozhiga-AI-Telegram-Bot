const axios = require('axios');

const BASE_URL = 'https://api.klingai.com';

async function generateKlingVideo(prompt, options = {}) {
    const apiKey = process.env.KLING_API_KEY;
    if (!apiKey) {
        throw new Error('Ключ KLING_API_KEY не задан в переменных окружения (.env)');
    }

    try {
        const response = await axios.post(`${BASE_URL}/v1/videos/text2video`, {
            prompt: prompt,
            model_name: options.model_name || 'kling-v1',
            duration: options.duration || '5',
            aspect_ratio: options.aspect_ratio || '16:9'
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const taskId = response.data?.data?.task_id;
        if (!taskId) {
            throw new Error('Не удалось получить ID задачи от Kling AI');
        }

        console.log(`[Kling Plugin] Задача создана. ID: ${taskId}. Ждем результат...`);

        let videoUrl = null;
        const maxAttempts = 60; 
        let attempts = 0;

        while (!videoUrl && attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 5000));

            const statusRes = await axios.get(`${BASE_URL}/v1/videos/text2video/${taskId}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            const taskData = statusRes.data?.data;
            if (!taskData) continue;

            if (taskData.status === 'completed' || taskData.status === 'succeed') {
                videoUrl = taskData.task_result?.videos?.[0]?.url;
                break;
            } else if (taskData.status === 'failed') {
                throw new Error(`Ошибка в Kling: ${taskData.fail_reason || 'Неизвестно'}`);
            }
        }

        if (!videoUrl) {
            throw new Error('Превышено время ожидания генерации видео');
        }

        return videoUrl;

    } catch (error) {
        console.error('Ошибка Kling API:', error.response?.data || error.message);
        throw error;
    }
}

module.exports = { generateKlingVideo };