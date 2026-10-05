const axios = require('axios');

const BASE_URL = 'https://api-singapore.klingai.com';

// Вспомогательная функция для скачивания файла и конвертации в Base64
async function convertUrlToBase64(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const base64String = Buffer.from(response.data).toString('base64');
        return base64String;
    } catch (e) {
        throw new Error(`Не удалось скачать и конвертировать изображение: ${e.message}`);
    }
}

async function generateKlingVideo(prompt, imageUrl = null, options = {}) {
    const apiKey = process.env.KLING_API_KEY;
    if (!apiKey) {
        throw new Error('Ключ KLING_API_KEY не задан в переменных окружения (.env)');
    }

    try {
        let endpoint = `${BASE_URL}/image-to-video/kling-3.0`;
        let contents = [
            {
                type: 'prompt',
                text: prompt
            }
        ];

        // Если передана картинка (например, из Телеграма), конвертируем её в Base64
        if (imageUrl) {
            const base64Image = await convertUrlToBase64(imageUrl);
            contents.push({
                type: 'first_frame',
                url: base64Image // Передаем base64 строку, как требует Kling для защищенных ссылок
            });
        }

        const requestBody = {
            contents: contents,
            settings: {
                resolution: options.resolution || '720p',
                duration: options.duration || 5,
                audio: options.audio || 'off',
                multi_shot: false
            },
            options: {
                watermark_info: {
                    enabled: false
                }
            }
        };

        const response = await axios.post(endpoint, requestBody, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const taskId = response.data?.data?.id;
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

            const statusRes = await axios.get(`${BASE_URL}/tasks?task_ids=${taskId}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const taskData = statusRes.data?.data?.[0];
            if (!taskData) continue;

            if (taskData.status === 'succeeded' || taskData.status === 'completed') {
                const videoOutput = taskData.outputs?.find(o => o.type === 'video');
                videoUrl = videoOutput?.url;
                break;
            } else if (taskData.status === 'failed') {
                throw new Error(`Ошибка в Kling: ${taskData.message || 'Неизвестно'}`);
            }
        }

        if (!videoUrl) {
            throw new Error('Превышено время ожидания генерации видео');
        }

        return videoUrl;

    } catch (error) {
        console.error('Ошибка Kling API (полный ответ):', JSON.stringify(error.response?.data || error.message, null, 2));
        throw error;
    }
}

module.exports = { generateKlingVideo };