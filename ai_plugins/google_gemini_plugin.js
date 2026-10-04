const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * АКТУАЛЬНЫЙ СЛОВАРЬ МОДЕЛЕЙ
 */
const MODEL_MAPPING = {
    'flash': 'gemini-3.8-flash',               // Gemini 3.8 Flash (Текст)
    'flash_25': 'gemini-3.8-flash',            // Редирект старого flash_25 на 3.8
    'pro': 'gemini-3.1-pro-preview',           // Профессиональная текстовая модель
    'nanobanana': 'gemini-3.1-flash-image',    // Nano Banana 2 (Картинки)
    'nanobanana_pro': 'gemini-3-pro-image',    // Nano Banana Pro (HQ Картинки)
    'veo': 'veo-3.1-generate-preview'          // 🎬 Veo 3.1 Видео (VIP)
};

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, mimeTypes, modelKey = 'flash', imageConfig }) {
    try {
        const resolvedModel = MODEL_MAPPING[modelKey] || MODEL_MAPPING['flash'];

        console.log(`⚙ Вызов метода для ключа [${modelKey}], маппинг на модель: "${resolvedModel}"`);

        const safePrompt = prompt ? prompt.trim() : "";

        // 🎬 ОБРАБОТКА ГЕНЕРАЦИИ ВИДЕО ЧЕРЕЗ VEO 3.1
        if (modelKey === 'veo') {
            console.log(`🎬 Запуск генерации видео через Veo 3.1 (${resolvedModel})...`);
            
            let videoPayload = {
                model: resolvedModel
            };

            let targetBuffer = fileBuffer || (Array.isArray(fileBuffers) && fileBuffers.length > 0 ? fileBuffers[0] : null);

            // Если есть картинка для оживления, упаковываем её и промпт в source (без дублирования prompt на верхнем уровне)
            if (targetBuffer && Buffer.isBuffer(targetBuffer)) {
                videoPayload.source = {
                    prompt: safePrompt || "Cinematic video generation with motion and sound",
                    image: {
                        imageBytes: targetBuffer.toString("base64"),
                        mimeType: mimeType || 'image/jpeg'
                    }
                };
                console.log(`🖼 Veo запущен в режиме Image-to-Video через source`);
            } else {
                // Обычный Text-to-Video
                videoPayload.prompt = safePrompt || "Cinematic video generation with sound and high detail";
                console.log(`📝 Veo запущен в режиме Text-to-Video`);
            }

            let operation = await ai.models.generateVideos(videoPayload);
            console.log(`⏳ Задача генерации видео создана. Operation ID: ${operation.name || operation.id}. Ожидаем готовности...`);

            let attempts = 0;
            const maxAttempts = 60; // До 10 минут ожидания рендеринга

            while (!operation.done && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                attempts++;
                
                try {
                    const opName = operation.name || operation.id;
                    if (opName) {
                        operation = await ai.operations.get({ name: opName });
                    }
                    console.log(`⏱ Проверка статуса видео (попытка ${attempts}): done = ${operation.done}`);
                } catch (pollErr) {
                    console.warn(`⚠ Ошибка при опросе статуса операции Veo:`, pollErr.message);
                }
            }

            if (!operation.done) {
                throw new Error('Превышено время ожидания генерации видео Veo (таймаут)');
            }

            const generatedVideo = operation.response?.generated_videos?.[0] || operation.result?.generated_videos?.[0];
            if (!generatedVideo || !generatedVideo.video) {
                throw new Error('Не удалось получить сгенерированное видео от Veo');
            }

            let videoBuffer = null;
            try {
                const fileInfo = generatedVideo.video;
                const downloadedFile = await ai.files.download({ name: typeof fileInfo === 'string' ? fileInfo : fileInfo.name });
                if (Buffer.isBuffer(downloadedFile)) {
                    videoBuffer = downloadedFile;
                } else if (downloadedFile.data) {
                    videoBuffer = Buffer.from(downloadedFile.data);
                }
            } catch (downloadErr) {
                console.warn('⚠ Ошибка скачивания через ai.files.download, пробуем по URI:', downloadErr.message);
                if (generatedVideo.video.uri) {
                    const res = await axios.get(generatedVideo.video.uri, { responseType: 'arraybuffer' });
                    videoBuffer = Buffer.from(res.data);
                }
            }

            if (!videoBuffer) {
                throw new Error('Не удалось загрузить бинарные данные сгенерированного видео');
            }

            return {
                type: 'video',
                buffer: videoBuffer,
                text: safePrompt || '🎬 Видео успешно создано с помощью Veo 3.1!'
            };
        }

        // Универсальный сбор всех картинок для текстовых и графических моделей
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

        let textOutput = '';
        let imageBuffer = null;

        if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.text) {
                    textOutput += (textOutput ? '\n' : '') + part.text;
                }
                if (part.inlineData && part.inlineData.data) {
                    imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                } else if (part.inline_data && part.inline_data.data) {
                    imageBuffer = Buffer.from(part.inline_data.data, 'base64');
                }
            }
        } else if (response.text) {
            textOutput = response.text;
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
            text: textOutput || "Готово!"
        };

    } catch (error) {
        console.error(`❌ Ошибка в плагине [модель: ${modelKey}]:`, error.message || error);
        throw new Error(error.message || 'Неизвестная ошибка связи с нейросетью');
    }
}

module.exports = { processRequest };