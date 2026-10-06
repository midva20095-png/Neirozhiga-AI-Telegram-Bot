const axios = require('axios');

// Функция для скачивания изображения по ссылке в Buffer
async function downloadImage(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        throw new Error(`Некорректная ссылка на изображение: ${String(url)}`);
    }

    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024
    });

    const buffer = Buffer.from(response.data);

    if (!buffer.length) {
        throw new Error('Скачанное изображение пустое');
    }

    return buffer;
}

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, modelKey }) {
    // Здесь твоя логика отправки запроса в API Братухи и цикл опроса (polling) статуса
    // ...
    
    // Когда статус стал completed и пришел результат с картинкой:
    if (result?.images?.length > 0) {
        const imageItem = result.images[0];

        const imageUrl =
            typeof imageItem === 'string'
                ? imageItem
                : imageItem?.url || imageItem?.image_url;

        if (!imageUrl) {
            throw new Error('В ответе Братухи не найдена ссылка на изображение');
        }

        const imageBuffer = await downloadImage(imageUrl);

        return {
            type: 'image',
            buffer: imageBuffer
        };
    }

    // Для текстовых моделей (если DeepSeek / Qwen):
    return {
        type: 'text',
        text: result.text || 'Готово!'
    };
}

module.exports = { processRequest };