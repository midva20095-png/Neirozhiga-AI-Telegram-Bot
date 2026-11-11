const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL_MAPPING = {
    'flash': 'gemini-3.8-flash',
    'flash_25': 'gemini-3.8-flash',
    'pro': 'gemini-3.1-pro-preview',
    'nanobanana': 'gemini-3.1-flash-image',
    'nanobanana_pro': 'gemini-3-pro-image'
};

async function processRequest({ prompt, fileBuffer, fileBuffers, mimeType, mimeTypes, modelKey = 'flash', imageConfig, aspectRatio }) {
    try {
        const resolvedModel = MODEL_MAPPING[modelKey] || MODEL_MAPPING['flash'];
        let safePrompt = prompt ? prompt.trim() : "";
        if (aspectRatio && aspectRatio !== 'auto' && !safePrompt.includes(String(aspectRatio))) {
            safePrompt = safePrompt ? `${safePrompt}, aspect ratio ${aspectRatio}` : `aspect ratio ${aspectRatio}`;
        }
        if (!imageConfig && aspectRatio && aspectRatio !== 'auto') {
            imageConfig = { imageConfig: { aspectRatio: String(aspectRatio) } };
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