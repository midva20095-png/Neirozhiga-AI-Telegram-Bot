require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.BRATUKHA_API_BASE || 'https://api.bratukha.ru/v1';
const API_KEY = process.env.BRATUKHA_API_KEY;

/**
 * Загрузка файла через Presigned URL в S3/Cloudflare R2
 */
async function uploadFileToPresign(fileBuffer, mimeType = 'image/jpeg') {
    try {
        // Step 1: Запрос Presigned URL у API
        const presignRes = await axios.post(`${API_BASE}/uploads/presign`, {
            filename: `photo_${Date.now()}.jpg`,
            mime_type: mimeType
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const { upload_url, file_url, url, file_id } = presignRes.data;
        const targetUploadUrl = upload_url || url;
        const finalFileUrl = file_url || presignRes.data.public_url || targetUploadUrl.split('?')[0];

        // Step 2: Загружаем бинарные данные напрямую в S3
        // ⚠️ ВАЖНО: Без заголовка Authorization, так как подпись вшита в URL
        await axios.put(targetUploadUrl, fileBuffer, {
            headers: {
                'Content-Type': mimeType
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });

        return finalFileUrl || file_id;
    } catch (error) {
        console.error('❌ Ошибка при загрузке через Presign:', error.response?.data || error.message);
        throw new Error(`Ошибка загрузки изображения в S3: ${error.message}`);
    }
}

/**
 * Основная функция обработки запроса от ядра бота
 */
async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType = 'image/jpeg', modelKey }) {
    if (!API_KEY) {
        throw new Error('BRATUKHA_API_KEY не установлен в .env');
    }

    // Собираем все буферы файлов в единый массив
    const buffers = fileBuffers && fileBuffers.length > 0 
        ? fileBuffers 
        : (fileBuffer ? [fileBuffer] : []);

    // 🎨 1. РЕЖИМ ГЕНЕРАЦИИ ИЗОБРАЖЕНИЙ (gpt-image-2-5)
    if (modelKey === 'gpt-image-2-5') {
        const response = await axios.post(`${API_BASE}/images/generations`, {
            model: 'gpt-image-2-5',
            prompt: prompt || 'Красивое качественное изображение',
            n: 1,
            response_format: 'url'
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const imgData = response.data.data?.[0];
        let resultBuffer = null;

        if (imgData?.url) {
            const imgRes = await axios.get(imgData.url, { responseType: 'arraybuffer' });
            resultBuffer = Buffer.from(imgRes.data);
        } else if (imgData?.b64_json) {
            resultBuffer = Buffer.from(imgData.b64_json, 'base64');
        }

        return {
            type: 'image',
            buffer: resultBuffer,
            text: '🎨 Изображение сгенерировано!'
        };
    }

    // 🤖 2. ТЕКСТОВЫЕ И VISION МОДЕЛИ (DeepSeek V3.2, Qwen 3.5)
    let uploadedFileUrls = [];

    if (buffers.length > 0) {
        for (const buf of buffers) {
            const fileUrl = await uploadFileToPresign(buf, mimeType);
            if (fileUrl) uploadedFileUrls.push(fileUrl);
        }
    }

    let userContent = [];

    if (prompt) {
        userContent.push({ type: 'text', text: prompt });
    }

    uploadedFileUrls.forEach(url => {
        userContent.push({
            type: 'image_url',
            image_url: { url: url }
        });
    });

    const finalContent = userContent.length === 1 && userContent[0].type === 'text'
        ? prompt
        : (userContent.length > 0 ? userContent : prompt || 'Опиши эту картинку');

    const response = await axios.post(`${API_BASE}/chat/completions`, {
        model: modelKey,
        messages: [
            { role: 'user', content: finalContent }
        ]
    }, {
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    const replyText = response.data.choices?.[0]?.message?.content || 'Не удалось получить текст ответа.';

    return {
        type: 'text',
        text: replyText
    };
}

module.exports = { processRequest };