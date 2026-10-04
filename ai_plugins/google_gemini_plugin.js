const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL_MAPPING = {
    'flash': 'gemini-3.8-flash',
    'flash_25': 'gemini-3.8-flash',
    'pro': 'gemini-3.1-pro-preview',
    'nanobanana': 'gemini-3.1-flash-image',
    'nanobanana_pro': 'gemini-3-pro-image',
    'veo': 'veo-3.1-generate-preview'
};

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, mimeTypes, modelKey = 'flash', imageConfig }) {
    try {
        const resolvedModel = MODEL_MAPPING[modelKey] || MODEL_MAPPING['flash'];
        const safePrompt = prompt ? prompt.trim() : "";

        // 🎬 ОБРАБОТКА ГЕНЕРАЦИИ ВИДЕО ЧЕРЕЗ VEO 3.1
        if (modelKey === 'veo') {
            console.log(`🎬 Запуск генерации видео через Veo 3.1 (${resolvedModel})...`);
            
            let videoPayload = { model: resolvedModel };
            let targetBuffer = fileBuffer || (Array.isArray(fileBuffers) && fileBuffers.length > 0 ? fileBuffers[0] : null);

            if (targetBuffer && Buffer.isBuffer(targetBuffer)) {
                videoPayload.source = {
                    prompt: safePrompt || "Cinematic video generation with motion and sound",
                    image: {
                        imageBytes: targetBuffer.toString("base64"),
                        mimeType: mimeType || 'image/jpeg'
                    }
                };
            } else {
                videoPayload.prompt = safePrompt || "Cinematic video generation with sound and high detail";
            }

            let operation = await ai.models.generateVideos(videoPayload);
            console.log(`⏳ Задача генерации видео создана. Ожидаем готовности...`);

            let attempts = 0;
            const maxAttempts = 60;

            while (!operation.done && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                attempts++;
                
                try {
                    operation = await ai.operations.get({ operation: operation });
                    console.log(`⏱ Проверка статуса видео (попытка ${attempts}): done = ${operation.done}`);
                } catch (pollErr) {
                    console.warn(`⚠ Ошибка при опросе статуса операции Veo:`, pollErr.message);
                }
            }

            if (!operation.done) {
                throw new Error('Превышено время ожидания генерации видео Veo (таймаут)');
            }

            // УНИВЕРСАЛЬНЫЙ ПОИСК (поддерживает любые вариации библиотеки)
            const generatedVideo = 
                operation.response?.generatedVideos?.[0] || 
                operation.response?.generated_videos?.[0] || 
                operation.result?.generatedVideos?.[0] || 
                operation.result?.generated_videos?.[0] ||
                operation.generatedVideos?.[0] ||
                operation.generated_videos?.[0];

            if (!generatedVideo || !generatedVideo.video) {
                console.error("🔍 Структура ответа от сервера:", JSON.stringify(operation, null, 2));
                throw new Error('Не удалось получить сгенерированное видео от Veo');
            }

            let videoBuffer = null;
            try {
                const fileInfo = generatedVideo.video;
                const fileName = typeof fileInfo === 'string' ? fileInfo : (fileInfo.name || fileInfo.uri);
                const downloadedFile = await ai.files.download({ name: fileName });
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

        // Обработка текста и картинок
        let images = [];
        if (Array.isArray(fileBuffers) && fileBuffers.length > 0) {
            images = fileBuffers.map((buf, idx) => ({
                buffer: buf,
                mimeType: Array.isArray(mimeTypes) ? (mimeTypes[idx] || mimeType || 'image/jpeg') : (mimeType || 'image/jpeg')
            }));
        } else if (fileBuffer && Buffer.isBuffer(fileBuffer) && fileBuffer.length > 0) {
            images = [{ buffer: fileBuffer, mimeType: mimeType || 'image/jpeg' }];
        }

        let parts = [];
        for (const img of images) {
            parts.push({
                inlineData: {
                    data: img.buffer.toString("base64"),
                    mimeType: img.mimeType || 'application/octet-stream'
                }
            });
        }
        
        const finalPrompt = safePrompt || (images.length > 0 ? "Обработай эти изображения" : "Создай креативное изображение");
        parts.push({ text: finalPrompt });

        const generatePayload = {
            model: resolvedModel,
            contents: [{ role: 'user', parts: parts }]
        };

        if (imageConfig) generatePayload.config = imageConfig;

        const response = await ai.models.generateContent(generatePayload);

        let textOutput = '';
        let imageBuffer = null;

        if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.text) textOutput += (textOutput ? '\n' : '') + part.text;
                if (part.inlineData?.data) imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                if (part.inline_data?.data) imageBuffer = Buffer.from(part.inline_data.data, 'base64');
            }
        } else if (response.text) {
            textOutput = response.text;
        }

        if (imageBuffer) {
            return { type: 'image', buffer: imageBuffer, text: textOutput || '🎨 Изображение готово!' };
        }

        return { type: 'text', text: textOutput || "Готово!" };

    } catch (error) {
        console.error(`❌ Ошибка в плагине [модель: ${modelKey}]:`, error.message || error);
        throw new Error(error.message || 'Неизвестная ошибка связи с нейросетью');
    }
}

module.exports = { processRequest };