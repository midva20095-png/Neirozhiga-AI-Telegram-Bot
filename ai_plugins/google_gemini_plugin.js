const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * СЛОВАРЬ МОДЕЛЕЙ И ВОЗМОЖНОСТЕЙ
 */
const MODEL_MAPPING = {
    'flash': 'gemini-3.8-flash',               
    'flash_25': 'gemini-2.5-flash',            
    'pro': 'gemini-3.1-pro-preview',                   
    'nanobanana': 'gemini-3.1-flash-image',    
    'nanobanana_pro': 'gemini-3.1-flash-image' 
};

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, mimeTypes, modelKey = 'flash', imageConfig }) {
    try {
        const resolvedModel = MODEL_MAPPING[modelKey] || MODEL_MAPPING['flash'];

        console.log(`⚙️ Вызов метода для ключа [${modelKey}], маппинг на модель: "${resolvedModel}"`);

        const safePrompt = prompt ? prompt.trim() : "";

        // Универсальный сбор всех картинок (поддерживаем fileBuffers, массивы в fileBuffer, или одиночный буфер)
        let images = [];
        
        if (Array.isArray(fileBuffers) && fileBuffers.length > 0) {
            images = fileBuffers.map((buf, idx) => ({
                buffer: buf,
                mimeType: Array.isArray(mimeTypes) ? (mimeTypes[idx] || mimeType || 'image/jpeg') : (mimeType || 'image/jpeg')
            }));
        } else if (Array.isArray(fileBuffer) && fileBuffer.length > 0) {
            images = fileBuffer.map((buf, idx) => ({
                buffer: buf,
                mimeType: Array.isArray(mimeType) ? (mimeType[idx] || 'image/jpeg') : (mimeType || 'image/jpeg')
            }));
        } else if (fileBuffer && Buffer.isBuffer(fileBuffer) && fileBuffer.length > 0) {
            images = [{ buffer: fileBuffer, mimeType: mimeType || 'image/jpeg' }];
        }

        console.log(`📸 Всего картинок распознано для запроса: ${images.length}`);

        // --- БЛОК 1: ГЕНЕРАЦИЯ И РЕДАКТИРОВАНИЕ ИЗОБРАЖЕНИЙ (interactions) ---
        if (modelKey === 'nanobanana' || modelKey === 'nanobanana_pro') {
            console.log(`🎨 Запуск генерации/обработки изображений через interactions с промптом: "${safePrompt}"`);
            
            let inputPayload = [];

            for (const img of images) {
                inputPayload.push({
                    type: "image",
                    data: img.buffer.toString("base64"),
                    mime_type: img.mimeType || "image/png"
                });
            }

            inputPayload.push({
                type: "text",
                text: safePrompt || "Создай креативное изображение высокого качества"
            });

            const interactionPayload = {
                model: resolvedModel,
                input: inputPayload.length === 1 ? inputPayload[0].text : inputPayload,
            };

            if (imageConfig) {
                interactionPayload.config = imageConfig;
            }

            const imageGenerationPromise = ai.interactions.create(interactionPayload);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Превышено время ожидания генерации изображения (120с)')), 120000)
            );

            const interaction = await Promise.race([imageGenerationPromise, timeoutPromise]);

            // Логируем ответ для полной прозрачности
            console.log("🔍 Ответ от Google API (interactions):", JSON.stringify(interaction, null, 2));

            if (interaction && interaction.output_image && interaction.output_image.data) {
                const base64Image = interaction.output_image.data;
                return {
                    type: 'image',
                    buffer: Buffer.from(base64Image, 'base64'),
                    text: '🎨 Изображение успешно создано!'
                };
            }
            
            throw new Error('Интерфейс Google не вернул данные изображения.');
        }

        // --- БЛОК 2: СТАНДАРТНЫЙ ТЕКСТ / МУЛЬТИМОДАЛ (Flash, Pro) ---
        let contents = [];

        for (const img of images) {
            contents.push({
                inlineData: {
                    data: img.buffer.toString("base64"),
                    mimeType: img.mimeType || 'application/octet-stream'
                }
            });
        }
        
        contents.push(safePrompt || "Опиши, что находится на этом изображении");

        console.log(`💬 Отправка запроса в модель: ${resolvedModel}...`);
        
        const generatePromise = ai.models.generateContent({
            model: resolvedModel,
            contents: contents,
        });

        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Превышено время ожидания ответа от Google AI')), 30000)
        );

        const response = await Promise.race([generatePromise, timeoutPromise]);

        return {
            type: 'text',
            text: response.text || "Готово!"
        };

    } catch (error) {
        console.error(`❌ Ошибка в плагине [модель: ${modelKey}]:`, error.message || error);
        throw new Error("⚠️ Ошибка связи с нейросетью Google: " + (error.message || 'Неизвестная ошибка'));
    }
}

module.exports = { processRequest };