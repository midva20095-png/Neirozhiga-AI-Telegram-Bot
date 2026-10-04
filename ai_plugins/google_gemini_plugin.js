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

        // 🎬 ГЕНЕРАЦИЯ ВИДЕО ЧЕРЕЗ VEO
        if (modelKey === 'veo') {
            console.log(`🎬 Запуск генерации видео через Veo (${resolvedModel})...`);
            
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

            const generatedVideo = operation.response?.generatedVideos?.[0];
            if (!generatedVideo || !generatedVideo.video) {
                throw new Error('Не удалось получить сгенерированное видео от Veo');
            }

            const videoFileRef = generatedVideo.video;
            const fileUri = typeof videoFileRef === 'string' ? videoFileRef : (videoFileRef.uri || videoFileRef.name);

            let fileName = fileUri;
            const match = fileUri.match(/(files\/[a-zA-Z0-9_-]+)/);
            if (match) {
                fileName = match[1];
            }

            console.log(`📥 Скачивание файла через SDK Google: ${fileName}`);
            const downloadedFile = await ai.files.download({ name: fileName });
            
            let videoBuffer = null;
            if (Buffer.isBuffer(downloadedFile)) {
                videoBuffer = downloadedFile;
            } else if (downloadedFile && downloadedFile.data) {
                videoBuffer = Buffer.from(downloadedFile.data);
            } else if (downloadedFile) {
                videoBuffer = Buffer.from(downloadedFile);
            }

            if (!videoBuffer || videoBuffer.length === 0) {
                throw new Error('Не удалось загрузить бинарные данные сгенерированного видео');
            }

            return {
                type: 'video',
                buffer: videoBuffer,
                text: safePrompt || '🎬 Видео успешно создано с помощью Veo!'
            };
        }

        // 📝 ОБРАБОТКА ТЕКСТА И КАРТИНОК
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