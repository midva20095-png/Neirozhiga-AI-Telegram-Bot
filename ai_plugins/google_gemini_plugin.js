const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * СЛОВАРЬ МОДЕЛЕЙ И ВОЗМОЖНОСТЕЙ
 */
const MODEL_MAPPING = {
    'flash': 'gemini-3.8-flash',               // Gemini 3.8 Flash
    'flash_25': 'gemini-2.5-flash',            // Gemini 2.5 Flash
    'pro': 'gemini-3.1-pro-preview',           // Профессиональная текстовая модель
    'nanobanana': 'gemini-3.1-flash-image',    // Модель для генерации и редактирования изображений
    'nanobanana_pro': 'gemini-3.1-flash-image' // Версия Pro для продвинутой работы с графикой
};

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, mimeTypes, modelKey = 'flash', imageConfig }) {
    try {
        const resolvedModel = MODEL_MAPPING[modelKey] || MODEL_MAPPING['flash'];

        console.log(`⚙ Вызов метода для ключа [${modelKey}], маппинг на модель: "${resolvedModel}"`);

        const safePrompt = prompt ? prompt.trim() : "";

        // Универсальный сбор всех картинок (одиночный файл или альбом/пачка)
        let images = [];
        if (Array.isArray(fileBuffers) && fileBuffers.length > 0) {
            images = fileBuffers.map((buf, idx) => ({
                buffer: buf,
                mimeType: Array.isArray(mimeTypes) ? (mimeTypes[idx] || mimeType || 'image/jpeg') : (mimeType || 'image/jpeg')
            }));
        } else if (fileBuffer && Buffer.isBuffer(fileBuffer) && fileBuffer.length > 0) {
            images = [{ buffer: fileBuffer, mimeType: mimeType || 'image/jpeg' }];
        }

        console.log(`📸 Всего картинок передано в обработку: ${images.length}`);

        // Формируем части запроса для Google API (все картинки + текст)
        let parts = [];

        for (const img of images) {
            parts.push({
                inlineData: {
                    data: img.buffer.toString("base64"),
                    mimeType: img.mimeType || 'application/octet-stream'
                }
            });
        }
        
        const finalPrompt = safePrompt || (images.length > 0 ? "Обработай эти изображения (сшей, замени фон или выполни задачу)" : "Создай креативное изображение высокого качества");
        parts.push({ text: finalPrompt });

        console.log(`💬 Отправка запроса в модель: ${resolvedModel}...`);
        
        const generatePayload = {
            model: resolvedModel,
            contents: [
                {
                    role: 'user',
                    parts: parts
                }
            ],
        };

        if (imageConfig) {
            generatePayload.config = imageConfig;
        }

        const generatePromise = ai.models.generateContent(generatePayload);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Превышено время ожидания ответа от Google AI (120с)')), 120000)
        );

        const response = await Promise.race([generatePromise, timeoutPromise]);

        // Обработка ответа (текст или сгенерированная/измененная картинка)
        let textOutput = response.text || '';
        let imageBuffer = null;

        if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.text && !textOutput) {
                    textOutput += part.text;
                }
                if (part.inlineData && part.inlineData.data) {
                    imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                } else if (part.inline_data && part.inline_data.data) {
                    imageBuffer = Buffer.from(part.inline_data.data, 'base64');
                }
            }
        }

        if (imageBuffer) {
            return {
                type: 'image',
                buffer: imageBuffer,
                text: textOutput || '🎨 Изображение успешно создано!'
            };
        }

        return {
            type: 'text',
            text: textOutput || response.text || "Готово!"
        };

    } catch (error) {
        console.error(`❌ Ошибка в плагине [модель: ${modelKey}]:`, error.message || error);
        throw new Error(error.message || 'Неизвестная ошибка связи с нейросетью');
    }
}

module.exports = { processRequest };